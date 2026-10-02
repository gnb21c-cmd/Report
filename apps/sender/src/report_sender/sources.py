"""POS 자료를 읽는 방법 (config.json 의 "source") — 아스타나 apps/pos-sync 의 sources.py 를 가져와 다듬음

① folder — OK포스 백오피스 "상품별 (일자별)" 엑셀(.xls)을 저장하는 폴더를 읽음. DB 계정이 없어도 됨 (지금은 이것)
   { "type": "folder", "folder": "C:\\\\PosReport\\\\엑셀", "pattern": "*.xls" }
② firebird — OK포스 DB(C:\\_OKPOS\\DATA\\OKPOS.FDB)를 읽기 전용 트랜잭션으로. OK포스에서 계정을 받으면
   { "type": "firebird", "database": "C:\\\\_OKPOS\\\\DATA\\\\OKPOS.FDB", "user": "…", "password": "…",
     "dayQuery": "SELECT … AS \\"date\\", … AS code, … AS name, … AS qty, … AS gross, … AS discount, … AS net FROM … WHERE … = ?",
     "dateFormat": "%Y%m%d" }
③ none — 아직 정하지 않음

어느 방법이든 결과는 '하루 = 그날 상품별 전체' (DayRows). 같은 날을 다시 보내면 보고 앱에서 통째로 바뀜
"""
from __future__ import annotations

import datetime as dt
import fnmatch
import os
import re
import time

from .normalize import aggregate
from .xls_report import days_between, read_report


class SourceError(Exception):
    """POS 자료를 읽지 못함 (보내기 창에 그대로 보임)"""


class DayRows:
    """하루치 자료. done 은 보관함에 넣은 뒤 부름 (엑셀 파일을 '읽음'으로 표시)"""

    def __init__(self, date: str, rows: list, source: str, done=None):
        self.date, self.rows, self.source = date, rows, source
        self._done = done

    def queued(self):
        if self._done:
            self._done()


FORBIDDEN = re.compile(r"\b(insert|update|delete|merge|drop|alter|create|truncate|exec|execute|grant|revoke|into|backup|restore|shutdown)\b", re.I)


def check_read_only(sql: str) -> str:
    """POS DB 를 바꿀 수 있는 문장은 거부 (SELECT·WITH 로 시작하는 한 문장만)"""
    bare = re.sub(r"--[^\n]*|/\*.*?\*/", " ", sql, flags=re.S)
    bare = re.sub(r"'(?:[^']|'')*'", "''", bare)  # 따옴표 안 글자는 검사에서 뺌
    first = bare.strip().split(None, 1)[0].lower() if bare.strip() else ""
    if first not in ("select", "with"):
        raise SourceError("POS 쿼리는 SELECT 또는 WITH 로 시작해야 합니다 (읽기 전용).")
    if ";" in bare.strip().rstrip(";"):
        raise SourceError("POS 쿼리는 한 문장만 넣을 수 있습니다.")
    m = FORBIDDEN.search(bare)
    if m:
        raise SourceError(f"POS 쿼리에 쓸 수 없는 낱말이 있습니다: {m.group(0)} (읽기 전용)")
    return sql


class NoSource:
    type = "none"
    errors: list = []

    def poll(self, days):
        raise SourceError("POS 자료 읽는 방법이 아직 정해지지 않았습니다 (설정의 source).")

    def describe(self):
        return "아직 정하지 않음"

    def close(self):
        pass


class FirebirdSource:
    """OK포스 Firebird DB — 정해진 날들을 하루씩 읽음 (firebird.py, 읽기 전용 트랜잭션)"""

    type = "firebird"

    def __init__(self, conf: dict, db=None):
        self.query = check_read_only(str(conf.get("dayQuery") or ""))
        self.date_format = conf.get("dateFormat") or "%Y%m%d"
        self.errors: list = []
        if db is None:
            from .firebird import FirebirdDb

            db = FirebirdDb(conf)
        self.db = db

    def day_rows(self, day: str) -> list:
        from .firebird import FirebirdError

        params = [dt.date.fromisoformat(day).strftime(self.date_format)] * self.query.count("?")
        try:
            cols, rows = self.db.query(self.query, params)
        except FirebirdError as e:
            raise SourceError(str(e))
        except ImportError:
            raise SourceError("이 판에는 Firebird 읽기 부품(fdb)이 없습니다. 새 판을 설치해 주세요.")
        # Firebird 는 DATE 가 예약어라 AS "date" 로 쓰거나 ymd 로 이름 붙여도 됨
        cols = [{"ymd": "date", "sale_day": "date"}.get(str(c).lower(), str(c).lower()) for c in cols]
        missing = [c for c in ("date", "name", "qty", "net") if c not in cols]
        if missing:
            raise SourceError(f"POS 쿼리 결과에 {', '.join(missing)} 칸이 없습니다 (AS 이름을 확인해 주세요).")
        return [dict(zip(cols, r)) for r in rows]

    def poll(self, days):
        out = []
        for d in days:
            rows = aggregate(self.day_rows(d))
            wrong = sorted({r["date"] for r in rows} - {d})
            if wrong:
                raise SourceError(f"{d} 자료를 읽었는데 다른 날짜({', '.join(wrong[:3])})가 섞여 있습니다 — 쿼리의 날짜 조건을 확인해 주세요.")
            out.append(DayRows(d, rows, "DB"))
        return out

    def describe(self):
        return f"POS DB 직접 읽기 (Firebird · {self.db.database})"

    def close(self):
        self.db.close()


class FolderSource:
    """엑셀 폴더 — 아직 읽지 않은(또는 바뀐) 파일만. 파일 안의 조회일자 기간을 하루씩 나눠 통째로 보냄"""

    type = "folder"

    def __init__(self, conf: dict, store):
        self.folder = str(conf.get("folder") or "")
        self.pattern = conf.get("pattern") or "*.xls"
        self.store = store
        self.errors: list = []
        if not self.folder:
            raise SourceError("엑셀을 저장하는 폴더(folder)가 비어 있습니다.")

    def files(self):
        if not os.path.isdir(self.folder):
            raise SourceError(f"엑셀 폴더가 없습니다: {self.folder}")
        out = []
        for name in os.listdir(self.folder):
            path = os.path.join(self.folder, name)
            if os.path.isfile(path) and fnmatch.fnmatch(name.lower(), self.pattern.lower()):
                st = os.stat(path)
                out.append((st.st_mtime, name, path, f"{st.st_size}:{int(st.st_mtime)}"))
        return sorted(out)

    def poll(self, days=None):
        out, self.errors = [], []
        for mtime, name, path, sig in self.files():
            if self.store.file_sig(name) == sig or time.time() - mtime < 3:  # 이미 보냈거나 아직 저장 중
                continue
            try:
                rep = read_report(path)
            except Exception as e:  # ReportError · 망가진 파일
                self.errors.append(f"{name}: {str(e)[:200]}")
                continue
            if rep["truncated"]:
                self.errors.append(f"{name}: 조회줄수 제한에 걸려 잘린 파일입니다 — 조회줄수를 늘리거나 기간을 줄여 다시 저장해 주세요.")
                continue
            if not rep["total_ok"]:
                self.errors.append(f"{name}: 합계 행과 상품 합이 맞지 않습니다 — 다시 저장해 주세요.")
                continue
            span = days_between(rep["start"], rep["end"])
            rows = aggregate(rep["rows"])
            by_day = {d: [] for d in span}
            for r in rows:
                if r["date"] in by_day:
                    by_day[r["date"]].append(r)
            last = len(span) - 1
            for i, d in enumerate(span):
                # 파일의 마지막 날을 보관함에 넣은 뒤 '읽음' 표시
                done = (lambda n=name, s=sig: self.store.set_file_sig(n, s)) if i == last else None
                out.append(DayRows(d, by_day[d], "엑셀:" + name, done=done))
        return out

    def describe(self):
        return f"엑셀 폴더 ({self.folder})"

    def close(self):
        pass


def make_source(conf: dict, store):
    t = (conf.get("type") or "none").lower()
    if t == "firebird":
        return FirebirdSource(conf)
    if t == "folder":
        return FolderSource(conf, store)
    if t == "none":
        return NoSource()
    raise SourceError(f"알 수 없는 읽는 방법입니다: {t} (folder · firebird · none)")
