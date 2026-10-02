"""시험 모드 — 클라우드 보관함(Firebase) 설정 전에 매장에서 먼저 확인할 때

POS 자료를 읽기만 하고 보내지 않습니다. 읽은 내용(날짜별 상품 수·실매출·많이 팔린 상품)을
바탕화면 '매출보내기_시험결과_날짜.txt' 로 남깁니다. 이 파일을 보내 주시면 읽는 방법·분류를 맞춥니다.
카드번호·전화번호 같은 칸은 읽을 때 이미 버려서 파일에도 없습니다 (normalize.py).
"""
from __future__ import annotations

import datetime as dt
import os

from . import VERSION
from .config import pos_label
from .normalize import totals, won
from .outbox import Outbox
from .runner import Result, days_to_read
from .sources import SourceError, make_source


def desktop() -> str:
    home = os.path.expanduser("~")
    for p in (os.path.join(home, "OneDrive", "바탕 화면"), os.path.join(home, "OneDrive", "Desktop"), os.path.join(home, "Desktop"), os.path.join(home, "바탕 화면")):
        if os.path.isdir(p):
            return p
    return home


class TrialSender:
    """보내기 창이 쓰는 Sender 와 같은 모양 (run · close)"""

    def __init__(self, conf: dict, out_dir: str | None = None, today=None):
        self.conf = conf
        self.out_dir = out_dir or desktop()
        self.today = today or dt.date.today
        self.store = Outbox(":memory:")  # 시험이라 '읽음' 표시를 남기지 않음 (나중에 실제로 보낼 때 다시 읽게)

    def run(self) -> Result:
        res = Result()
        lines = [f"매출 보내기 시험 결과 — {pos_label(self.conf)} POS · 판 {VERSION} · {dt.datetime.now():%Y-%m-%d %H:%M}", ""]
        try:
            src = make_source(self.conf.get("source") or {}, self.store)
            lines.append(f"읽는 방법: {src.describe()}")
            items = src.poll(days_to_read(self.today(), int(self.conf.get("catchUpDays") or 0)))
            for w in getattr(src, "errors", []) or []:
                res.warnings.append(w)
                lines.append("⚠ " + w)
        except SourceError as e:
            res.error = str(e)
            lines += ["", "✖ " + str(e)]
            items = []
        for it in items:
            t = totals(it.rows)
            res.read.append((it.date, len(it.rows), t["net"], True))
            lines += ["", f"■ {it.date} · 상품 {len(it.rows)}개 · 수량 {t['qty']:,} · 총매출 {won(t['gross'])} · 할인 {won(t['discount'])} · 실매출 {won(t['net'])} ({it.source})"]
            for r in sorted(it.rows, key=lambda r: -r["net"]):
                lines.append(f"   {r['cat1'] or '-':<8} {r['code']:<8} {r['name']}  × {r['qty']:,} = {won(r['net'])}")
        if not items and not res.error:
            lines += ["", "읽은 자료가 없습니다 (엑셀 방식이면 폴더에 오늘 '상품별 (일자별)' 엑셀을 저장했는지 확인)"]
        path = os.path.join(self.out_dir, f"매출보내기_시험결과_{dt.datetime.now():%Y%m%d_%H%M}.txt")
        with open(path, "w", encoding="utf-8-sig") as f:
            f.write("\n".join(lines) + "\n")
        res.trial_file = path
        return res

    def close(self):
        self.store.close()
