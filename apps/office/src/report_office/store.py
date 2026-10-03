"""C 의 보관함 (office.db, SQLite) — A 가 보낸 조각을 날짜별로 보관하고 합침

- parts: 날짜 × 조각(cafe · kids · naver) 마지막으로 받은 것 하나씩 (같은 조각이 다시 오면 바꿈 → 두 번 더해지지 않음)
  지난 자료(basis = daily, 상품별 일자별)는 영수증별 자료(basis = receipt)를 덮지 않음
- reports: 조각을 합친 그날 보고 자료 (B 가 읽는 모양 = packages/core/src/part.ts DayReport)
- lines: 반품을 지운 영수증 줄 (규칙이 바뀌면 다시 계산할 수 있게 보관 — 폰으로는 안 감)
- products: 상품 분류표 (상품명 → 바리스타 · 베이커리 · 키친 · 기타)
- weather: 기상청 날씨 (관측이 예보를 바꿈, 예보는 관측을 못 바꿈)
- outbox: 클라우드에 아직 못 올린 것 (인터넷이 끊겨도 남아 있다가 다시 올림)
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import sqlite3
import threading

SCHEMA = """
CREATE TABLE IF NOT EXISTS parts (date TEXT, kind TEXT, body TEXT NOT NULL, by TEXT, at TEXT, file TEXT, PRIMARY KEY (date, kind));
CREATE TABLE IF NOT EXISTS lines (date TEXT, store TEXT, body TEXT NOT NULL, at TEXT, PRIMARY KEY (date, store));
CREATE TABLE IF NOT EXISTS reports (date TEXT PRIMARY KEY, body TEXT NOT NULL, hash TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS reports_at ON reports (at);
CREATE TABLE IF NOT EXISTS products (name TEXT PRIMARY KEY, sector TEXT NOT NULL, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS weather (date TEXT PRIMARY KEY, body TEXT NOT NULL, source TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS weather_at ON weather (at);
CREATE TABLE IF NOT EXISTS outbox (kind TEXT, key TEXT, tries INTEGER NOT NULL DEFAULT 0, last_error TEXT, at TEXT, PRIMARY KEY (kind, key));
CREATE TABLE IF NOT EXISTS log (at TEXT, by TEXT, action TEXT, detail TEXT);
"""

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SECTORS = ("바리스타", "베이커리", "키친", "기타")
KINDS = ("cafe", "kids", "naver")


class BadInput(ValueError):
    """A 가 보낸 것이 이상함 (사람이 읽을 안내)"""


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) < 1e12


def _nums(xs, n: int | None = None) -> bool:
    return isinstance(xs, list) and (n is None or len(xs) == n) and all(_num(x) for x in xs)


def check_part(kind: str, part: dict, date: str) -> None:
    """조각 모양 확인 — 계산은 A 가 했지만 C 는 모양 · 날짜 · 매장이 맞는지 봄"""
    if not isinstance(part, dict):
        raise BadInput(f"{kind} 자료 모양이 이상합니다.")
    if part.get("date") != date:
        raise BadInput(f"{kind} 자료의 날짜({part.get('date')})가 입력 날짜({date})와 다릅니다.")
    if kind == "naver":
        if not (_nums(part.get("tickets"), 20) and _nums(part.get("newVisitors"), 20)):
            raise BadInput("네이버 표는 20칸(10:00~19:30)이어야 합니다.")
        if any(x < 0 or x > 5000 for x in part["tickets"] + part["newVisitors"]):
            raise BadInput("네이버 표 숫자가 이상합니다 (0~5000).")
        return
    if part.get("store") != kind:
        raise BadInput(f"매장이 바뀌었습니다 ({part.get('store')} 자료를 {kind} 칸에).")
    if part.get("basis") not in ("receipt", "daily"):
        raise BadInput("자료 종류(basis)가 이상합니다.")
    sectors = part.get("sectors") or {}
    if not all(_num(sectors.get(s)) for s in SECTORS):
        raise BadInput("분류별 매출 칸이 이상합니다.")
    for k in ("posNet", "voucher", "cups", "teams"):
        if not _num(part.get(k)):
            raise BadInput(f"{k} 값이 이상합니다.")
    if not isinstance(part.get("products"), list) or len(part["products"]) > 5000:
        raise BadInput("상품 목록이 이상합니다.")
    hourly = part.get("hourly")
    if hourly is not None and not (isinstance(hourly, dict) and all(_nums((hourly.get("sectors") or {}).get(s), 12) for s in SECTORS) and _nums(hourly.get("cups"), 12)):
        raise BadInput("시간대 칸이 이상합니다 (12칸).")
    if kind == "kids" and not isinstance(part.get("kids"), dict):
        raise BadInput("키즈 입장권 칸이 없습니다.")


def report_hash(report: dict) -> str:
    body = {k: v for k, v in report.items() if k != "at"}
    return hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


class Store:
    def __init__(self, path: str):
        self.db = sqlite3.connect(path, timeout=15, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        self.lock = threading.RLock()

    def close(self):
        self.db.close()

    def _log(self, by: str, action: str, detail: str):
        self.db.execute("INSERT INTO log (at, by, action, detail) VALUES (?, ?, ?, ?)", (now_iso(), by, action, detail[:500]))

    # ---------- 조각 받기 ----------

    def submit(self, date: str, by: str, parts: dict, lines: dict | None = None, products: dict | None = None) -> dict:
        """A 의 '입력완료' — 조각을 바꿔 넣고 그날 보고를 다시 합침 → 합친 보고"""
        if not isinstance(date, str) or not DATE.match(date):
            raise BadInput("날짜 모양이 이상합니다 (YYYY-MM-DD).")
        if not isinstance(parts, dict) or not any(parts.get(k) for k in KINDS):
            raise BadInput("보낼 조각(네이버 · 카페 · 키즈)이 없습니다.")
        for k in parts:
            if k not in KINDS:
                raise BadInput(f"모르는 조각: {k}")
        for k in KINDS:
            if parts.get(k):
                check_part(k, parts[k], date)
        by = str(by or "")[:20]
        at = now_iso()
        with self.lock, self.db:
            for k in KINDS:
                p = parts.get(k)
                if not p:
                    continue
                self.db.execute(
                    "INSERT OR REPLACE INTO parts (date, kind, body, by, at, file) VALUES (?, ?, ?, ?, ?, ?)",
                    (date, k, json.dumps(p, ensure_ascii=False), by, at, str(p.get("file") or "")[:120] if k != "naver" else ""),
                )
                if k != "naver" and lines and isinstance(lines.get(k), list):
                    self.db.execute("INSERT OR REPLACE INTO lines (date, store, body, at) VALUES (?, ?, ?, ?)", (date, k, json.dumps(lines[k], ensure_ascii=False), at))
            self._set_products(products, by)
            self._log(by, "submit", f"{date} {','.join(k for k in KINDS if parts.get(k))}")
            return self._rebuild(date, at)

    def import_daily(self, by: str, parts: list, products: dict | None = None) -> tuple:
        """지난 자료 여러 날 → (넣은 것, 건너뛴 것)
        - 상품별(일자별) 하루 합계: 영수증별로 이미 올린 날은 건너뜀
        - 영수증별 여러 날: 그날 그 매장을 바꿈
        - 네이버 정리표: 이미 네이버를 넣은 날은 건너뜀"""
        if not isinstance(parts, list) or len(parts) > 1200:
            raise BadInput("지난 자료가 너무 많습니다 (한 번에 1,200개까지 — 나눠서 올려 주세요).")
        by = str(by or "")[:20]
        at = now_iso()
        saved = skipped = 0
        with self.lock, self.db:
            for p in parts:
                if not isinstance(p, dict):
                    raise BadInput("지난 자료 모양이 이상합니다.")
                date = str(p.get("date") or "")
                if not DATE.match(date):
                    raise BadInput("지난 자료 날짜가 이상합니다.")
                if "tickets" in p:  # 네이버 지난 자료 (캡처 정리표) — A 에 이미 넣은 날은 그대로
                    kind = "naver"
                    check_part(kind, p, date)
                    if self.db.execute("SELECT 1 FROM parts WHERE date=? AND kind='naver'", (date,)).fetchone():
                        skipped += 1
                        continue
                else:  # 상품별(일자별) 하루 합계 · 영수증별 여러 날
                    if p.get("basis") not in ("daily", "receipt") or p.get("store") not in ("cafe", "kids"):
                        raise BadInput("지난 자료 모양이 이상합니다.")
                    kind = p["store"]
                    check_part(kind, p, date)
                    old = self.db.execute("SELECT body FROM parts WHERE date=? AND kind=?", (date, kind)).fetchone()
                    if p["basis"] == "daily" and old and json.loads(old[0]).get("basis") == "receipt":
                        skipped += 1
                        continue
                self.db.execute(
                    "INSERT OR REPLACE INTO parts (date, kind, body, by, at, file) VALUES (?, ?, ?, ?, ?, ?)",
                    (date, kind, json.dumps(p, ensure_ascii=False), by, at, str(p.get("file") or "")[:120] if kind != "naver" else ""),
                )
                self._rebuild(date, at)
                saved += 1
            self._set_products(products, by)
            self._log(by, "import", f"넣음 {saved} · 건너뜀 {skipped}")
        return saved, skipped

    def _rebuild(self, date: str, at: str) -> dict:
        report: dict = {"date": date, "meta": {}}
        for kind, body, by, pat, file in self.db.execute("SELECT kind, body, by, at, file FROM parts WHERE date=?", (date,)):
            report[kind] = json.loads(body)
            report["meta"][kind] = {"by": by or "", "at": pat or "", **({"file": file} if file else {})}
        h = report_hash(report)
        old = self.db.execute("SELECT hash FROM reports WHERE date=?", (date,)).fetchone()
        if old and old[0] == h:
            row = self.db.execute("SELECT body FROM reports WHERE date=?", (date,)).fetchone()
            return json.loads(row[0])
        report["at"] = at
        self.db.execute("INSERT OR REPLACE INTO reports (date, body, hash, at) VALUES (?, ?, ?, ?)", (date, json.dumps(report, ensure_ascii=False), h, at))
        self._queue("report", date)
        return report

    # ---------- 읽기 ----------

    def report(self, date: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT body FROM reports WHERE date=?", (date,)).fetchone()
        return json.loads(row[0]) if row else None

    def reports_after(self, after: str | None, limit: int = 2000) -> tuple:
        """B(사무실에서 바로 보기)용 — at 이 after 뒤인 보고들, 다음 표시"""
        with self.lock:
            rows = self.db.execute("SELECT body, at FROM reports WHERE at > ? ORDER BY at LIMIT ?", (after or "", limit)).fetchall()
        return [json.loads(b) for b, _ in rows], (rows[-1][1] if rows else after)

    def last_date(self) -> str | None:
        with self.lock:
            row = self.db.execute("SELECT max(date) FROM parts WHERE kind IN ('cafe','kids')").fetchone()
        return row[0] if row else None

    # ---------- 상품 분류표 ----------

    def _set_products(self, products: dict | None, by: str):
        if not products:
            return
        if not isinstance(products, dict) or len(products) > 5000:
            raise BadInput("상품 분류가 이상합니다.")
        at = now_iso()
        for name, sector in products.items():
            if sector in SECTORS and isinstance(name, str) and 0 < len(name) <= 100:
                self.db.execute("INSERT OR REPLACE INTO products (name, sector, by, at) VALUES (?, ?, ?, ?)", (name, sector, by, at))

    def products(self) -> dict:
        with self.lock:
            return {n: s for n, s in self.db.execute("SELECT name, sector FROM products")}

    # ---------- 날씨 ----------

    def put_weather(self, day: dict) -> bool:
        """날씨 하루 넣기 — 바뀌었으면 True (관측은 예보를 바꾸고, 예보는 관측을 못 바꿈)"""
        date = day.get("date")
        if not isinstance(date, str) or not DATE.match(date):
            return False
        body = json.dumps(day, ensure_ascii=False, sort_keys=True)
        with self.lock, self.db:
            old = self.db.execute("SELECT body, source FROM weather WHERE date=?", (date,)).fetchone()
            if old and (old[0] == body or (old[1] == "observed" and day.get("source") != "observed")):
                return False
            self.db.execute("INSERT OR REPLACE INTO weather (date, body, source, at) VALUES (?, ?, ?, ?)", (date, body, day.get("source") or "", now_iso()))
            self._queue("weather", date)
        return True

    def weather(self, date: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT body FROM weather WHERE date=?", (date,)).fetchone()
        return json.loads(row[0]) if row else None

    def weather_after(self, after: str | None) -> tuple:
        with self.lock:
            rows = self.db.execute("SELECT body, at FROM weather WHERE at > ? ORDER BY at", (after or "",)).fetchall()
        return [json.loads(b) for b, _ in rows], (rows[-1][1] if rows else after)

    def weather_observed(self) -> set:
        with self.lock:
            return {r[0] for r in self.db.execute("SELECT date FROM weather WHERE source='observed'")}

    # ---------- 클라우드에 올릴 것 ----------

    def _queue(self, kind: str, key: str):
        self.db.execute("INSERT OR REPLACE INTO outbox (kind, key, tries, last_error, at) VALUES (?, ?, 0, NULL, ?)", (kind, key, now_iso()))

    def due(self, limit: int = 200) -> list:
        with self.lock:
            return self.db.execute("SELECT kind, key, tries, at FROM outbox ORDER BY kind DESC, key LIMIT ?", (limit,)).fetchall()

    def pushed(self, kind: str, key: str, queued_at: str):
        """올렸음 — 올리는 사이에 새로 바뀌어 다시 들어온 것(queued_at 이 다름)은 남겨 둠"""
        with self.lock, self.db:
            self.db.execute("DELETE FROM outbox WHERE kind=? AND key=? AND at=?", (kind, key, queued_at))

    def push_failed(self, kind: str, key: str, error: str):
        with self.lock, self.db:
            self.db.execute("UPDATE outbox SET tries=tries+1, last_error=? WHERE kind=? AND key=?", (error[:300], kind, key))

    def pending(self) -> int:
        with self.lock:
            return self.db.execute("SELECT count(*) FROM outbox WHERE kind='report'").fetchone()[0]

    def requeue_all(self):
        """클라우드를 새로 정했을 때 — 모든 보고 · 날씨를 다시 올림"""
        with self.lock, self.db:
            for (d,) in self.db.execute("SELECT date FROM reports").fetchall():
                self._queue("report", d)
            for (d,) in self.db.execute("SELECT date FROM weather").fetchall():
                self._queue("weather", d)
