"""시험 모드 — 클라우드 보관함(Firebase) 설정 전에 먼저 확인할 때

매장별 엑셀을 읽기만 하고 보내지 않습니다. 읽은 내용(날짜별 상품 수·실매출·상품 목록)을
C:\\PosReport\\시험결과\\매출보내기_시험결과_날짜.txt 하나로 남기고 바로 열어 보여 줍니다. 이 파일을 보내 주시면 분류를 맞춥니다.
카드번호·전화번호 같은 칸은 읽을 때 이미 버려서 파일에도 없습니다 (normalize.py).
"""
from __future__ import annotations

import datetime as dt
import os

from . import VERSION
from .config import POS_LABEL
from .normalize import totals, won
from .outbox import Outbox
from .runner import Result, days_to_read
from .sources import SourceError, make_source


RESULT_DIR = "C:\\PosReport\\시험결과"


def result_dir() -> str:
    """시험 결과는 늘 한 곳 — C:\\PosReport\\시험결과 (바탕화면 '매출 엑셀 폴더' 옆). 없으면 만듦"""
    d = RESULT_DIR if os.name == "nt" else os.path.join(os.path.expanduser("~"), "PosReport", "시험결과")
    try:
        os.makedirs(d, exist_ok=True)
        return d
    except OSError:
        return os.path.expanduser("~")


def open_file(path: str):
    """메모장으로 바로 열어 보여 줌 (Windows)"""
    try:
        if os.name == "nt":
            os.startfile(path)  # type: ignore[attr-defined]
    except OSError:
        pass


class TrialSender:
    """보내기 창이 쓰는 OfficeSender 와 같은 모양 (run → [(매장, Result)] · close)"""

    def __init__(self, conf: dict, out_dir: str | None = None, today=None, make=None):
        self.conf = conf
        self.out_dir = out_dir or result_dir()
        self.show = out_dir is None
        self.today = today or dt.date.today
        self.make = make or make_source
        self.store = Outbox(":memory:")  # 시험이라 '읽음' 표시를 남기지 않음 (나중에 실제로 보낼 때 다시 읽게)

    def run(self) -> list:
        lines = [f"매출 보내기 시험 결과 — 판 {VERSION} · {dt.datetime.now():%Y-%m-%d %H:%M}"]
        out = []
        path = os.path.join(self.out_dir, f"매출보내기_시험결과_{dt.datetime.now():%Y%m%d_%H%M}.txt")
        for pos, src_conf in (self.conf.get("stores") or {}).items():
            res = Result()
            res.trial_file = path
            lines += ["", f"======== {POS_LABEL.get(pos, pos)} ========"]
            try:
                src = self.make(src_conf, self.store)
                lines.append(f"읽는 방법: {src.describe()}")
                items = src.poll(days_to_read(self.today(), int(self.conf.get("catchUpDays") or 0)))
                for w in getattr(src, "errors", []) or []:
                    res.warnings.append(w)
                    lines.append("⚠ " + w)
            except SourceError as e:
                res.error = str(e)
                lines.append("✖ " + str(e))
                items = []
            for it in items:
                t = totals(it.rows)
                res.read.append((it.date, len(it.rows), t["net"], True))
                lines += ["", f"■ {it.date} · 상품 {len(it.rows)}개 · 수량 {t['qty']:,} · 총매출 {won(t['gross'])} · 할인 {won(t['discount'])} · 실매출 {won(t['net'])} ({it.source})"]
                for r in sorted(it.rows, key=lambda r: -r["net"]):
                    lines.append(f"   {r['cat1'] or '-':<8} {r['code']:<8} {r['name']}  × {r['qty']:,} = {won(r['net'])}")
            if not items and not res.error:
                lines.append("읽은 자료가 없습니다 (이 매장 폴더에 '상품별 (일자별)' 엑셀을 저장했는지 확인)")
            out.append((pos, res))
        with open(path, "w", encoding="utf-8-sig") as f:
            f.write("\n".join(lines) + "\n")
        if self.show:
            open_file(path)
        return out

    def close(self):
        self.store.close()
