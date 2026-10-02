"""여러 매장 함께 보내기 — 사무실 PC 한 대에서 카페 · 키즈 (config 의 stores)

매장마다 따로 읽고(폴더가 다름) 따로 보관함(outbox-{매장}.db)에 적어, 한 매장이 실패해도 다른 매장은 보냄.
날씨는 한 번만 (첫 매장 차례에).
"""
from __future__ import annotations

import os

from .config import POS_LABEL, data_dir
from .outbox import Outbox
from .relay import FirebaseRelay
from .runner import Result, Sender


class OfficeSender:
    def __init__(self, conf: dict, relay=None, make_source=None, today=None, now=None, kma=None, out_dir=None):
        self.conf = conf
        self.relay = relay or FirebaseRelay(conf.get("firebase") or {})
        self.senders = []
        for i, (pos, src) in enumerate((conf.get("stores") or {}).items()):
            one = {**conf, "pos": pos, "source": src}
            ob = Outbox(os.path.join(out_dir or data_dir(), f"outbox-{pos}.db"))
            kw = {"today": today, "now": now}
            if i > 0:
                kw["kma"] = False  # 날씨는 첫 매장 차례에 한 번만
            elif kma is not None:
                kw["kma"] = kma
            source = make_source(src, ob) if make_source else None
            self.senders.append((pos, Sender(one, outbox=ob, source=source, relay=self.relay, **kw)))

    def run(self) -> list:
        """[(매장, Result)]"""
        out = []
        for pos, s in self.senders:
            try:
                out.append((pos, s.run()))
            except Exception as e:  # 한 매장 문제로 다른 매장이 멈추지 않게
                r = Result()
                r.error = str(e)[:300]
                out.append((pos, r))
        return out

    def close(self):
        for _, s in self.senders:
            s.close()


def label(pos: str) -> str:
    return POS_LABEL.get(pos, pos)
