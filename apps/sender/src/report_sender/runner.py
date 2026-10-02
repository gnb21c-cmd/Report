"""보내기 한 번 = POS 자료 읽기 → PC 보관함 → 클라우드 보관함

- 읽는 날: 오늘 + 지난 catchUpDays 일 (늦은 취소·못 보낸 날). 바뀌지 않은 날은 다시 보내지 않음
- 한 번도 보낸 적 없는 날이 0행이면 보내지 않음 (잘못 읽어 기존 자료를 지우지 않게. 문 열기 전 아침에 켜도 안전)
- 인터넷이 끊기면 PC 보관함에 남겨 두고, 다음 보내기(또는 PC 켤 때)에 이어서 보냄
"""
from __future__ import annotations

import datetime as dt
import logging
import os
from dataclasses import dataclass, field

from . import VERSION
from .config import data_dir
from .normalize import rows_hash
from .outbox import Outbox
from .relay import FirebaseRelay, RelayError
from .sources import SourceError, make_source
from . import weather as wx

log = logging.getLogger("report_sender")


@dataclass
class Result:
    #: 읽은 날 (날짜, 상품 수, 실매출, 새로 보낼 것인지)
    read: list = field(default_factory=list)
    #: 클라우드에 올린 날 (날짜, 상품 수, 실매출)
    sent: list = field(default_factory=list)
    #: 아직 못 보내 PC 에 남은 날 수
    pending: int = 0
    #: 읽기 오류 (엑셀 잘림 등)
    warnings: list = field(default_factory=list)
    #: 멈춘 이유 (없으면 None)
    error: str | None = None
    #: 올린 날씨 날 수 · 날씨 오류 (매출 송부와 따로 — 날씨가 안 돼도 매출은 보냄)
    weather: int = 0
    weather_error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.pending == 0


def days_to_read(today: dt.date, catch_up: int) -> list:
    return [(today - dt.timedelta(days=i)).isoformat() for i in range(catch_up, -1, -1)]


class Sender:
    def __init__(self, conf: dict, outbox: Outbox | None = None, source=None, relay=None, today=None, kma=None, now=None):
        self.conf = conf
        self.pos = conf["pos"]
        self.outbox = outbox or Outbox(os.path.join(data_dir(), "outbox.db"))
        self.source = source if source is not None else make_source(conf.get("source") or {}, self.outbox)
        self.relay = relay or FirebaseRelay(conf.get("firebase") or {})
        self.today = today or dt.date.today
        self.now = now or dt.datetime.now
        key = ((conf.get("weather") or {}).get("serviceKey") or "").strip()
        self.kma = kma if kma is not None else (wx.Kma(conf["weather"]) if key else None)

    def collect(self, res: Result, force: bool = False):
        """POS 자료를 읽어 PC 보관함에 넣음"""
        try:
            items = self.source.poll(days_to_read(self.today(), int(self.conf.get("catchUpDays") or 0)))
        except SourceError as e:
            res.error = str(e)
            return
        res.warnings += list(getattr(self.source, "errors", []) or [])
        for it in items:
            net = sum(r["net"] for r in it.rows)
            if not it.rows and not self.outbox.ever_sent(it.date):
                it.queued()
                continue
            new = self.outbox.enqueue(it.date, it.rows, rows_hash(it.rows), it.source, force=force)
            it.queued()
            res.read.append((it.date, len(it.rows), net, new))

    def flush(self, res: Result):
        """PC 보관함 → 클라우드 (오래된 날부터)"""
        for item in self.outbox.due():
            try:
                self.relay.put_day(self.pos, item["date"], item["rows"], item["source"], VERSION)
            except RelayError as e:
                self.outbox.mark_failed(item, str(e))
                res.error = str(e)
                log.warning("보내기 실패 %s: %s", item["date"], e)
                break
            self.outbox.mark_sent(item)
            res.sent.append((item["date"], len(item["rows"]), sum(r["net"] for r in item["rows"])))
            log.info("보냄 %s %s행", item["date"], len(item["rows"]))
        res.pending = self.outbox.pending()

    def sync_weather(self, res: Result):
        """기상청 날씨 → 보관함 (관측: 아직 없는 날 ~ 어제, 처음이면 since 부터 / 오늘: 예보). 실패해도 매출과는 상관없음"""
        if not self.kma:
            return
        try:
            today = self.today()
            span = wx.days_to_fetch(today, self.outbox.weather_observed(), self.kma.conf.get("since") or "2025-01-01")
            days = self.kma.observed(*span) if span else []
            if self.outbox.weather_source(today.isoformat()) != "observed":
                days += [d for d in self.kma.forecast(self.now()) if d["date"] == today.isoformat()]
            for d in days:
                self.relay.put_weather(d)
                self.outbox.set_weather(d["date"], d["source"])
                res.weather += 1
        except (wx.WeatherError, RelayError) as e:
            res.weather_error = str(e)
            log.warning("날씨 실패: %s", e)

    def report_status(self, res: Result):
        """보고 앱 '송부 상태'용 (실패해도 넘어감)"""
        last = self.outbox.last_sent()
        try:
            self.relay.put_status(
                self.pos,
                {
                    "version": VERSION,
                    "source": self.source.describe(),
                    "pending": res.pending,
                    "lastError": (res.error or " / ".join(res.warnings))[:300],
                    "lastDate": last[0] if last else "",
                },
            )
        except RelayError:
            pass

    def run(self, force: bool = False) -> Result:
        res = Result()
        self.collect(res, force=force)
        source_error = res.error
        res.error = None
        self.flush(res)  # 읽기에 실패해도 남아 있던 것은 보냄
        res.error = source_error or res.error
        if not res.pending:
            self.sync_weather(res)
        self.report_status(res)
        return res

    def close(self):
        try:
            self.source.close()
        finally:
            self.outbox.close()
