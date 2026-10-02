import datetime as dt
import json
import unittest

from report_office.server import Office
from report_office.store import Store
from report_office.weather import Kma, days_to_fetch, latest_forecast_base, parse_asos, parse_forecast, parse_precip


def fc(date, time, cat, val):
    return {"baseDate": "20261002", "baseTime": "0500", "category": cat, "fcstDate": date, "fcstTime": time, "fcstValue": val}


class ParseTest(unittest.TestCase):
    def test_asos(self):
        days = parse_asos(
            [
                {"tm": "2026-09-25", "stnId": "119", "maxTa": "23.8", "minTa": "17.3", "sumRn": "6.0", "avgTca": "8"},
                {"tm": "2026-09-26", "maxTa": "26.5", "minTa": "", "sumRn": "", "avgTca": "7.1"},
                {"tm": "2026-09-27", "maxTa": "28", "minTa": "16", "sumRn": "35", "avgTca": "9"},
                {"tm": "2026-01-10", "maxTa": "-1", "minTa": "-8", "sumRn": "0.5", "ddMefs": "2.1"},
                {"tm": "2026-09-29", "maxTa": "26.9", "minTa": "13.9", "avgTca": "2"},
            ]
        )
        self.assertEqual([(d["key"], d["icon"]) for d in days], [("rain", "🌧️"), ("cloudy", "☁️"), ("heavyrain", "⛈️"), ("snow", "❄️"), ("sunny", "☀️")])
        self.assertIsNone(days[1]["tempMin"])  # 빈 값은 0도가 아니라 없음
        self.assertEqual((days[0]["tempMax"], days[0]["source"]), (23.8, "observed"))

    def test_forecast(self):
        items = [fc("20261002", f"{h:02d}00", "TMP", str(10 + h // 2)) for h in range(24)]
        items += [fc("20261002", "0600", "TMN", "11.0"), fc("20261002", "1500", "TMX", "23.0")]
        items += [fc("20261002", f"{h:02d}00", "SKY", "1" if h < 15 else "4") for h in range(6, 22)]
        items += [fc("20261002", f"{h:02d}00", "PTY", "0") for h in range(6, 22)]
        items += [fc("20261002", "1200", "PCP", "강수없음"), fc("20261003", "0000", "TMP", "12")]
        [d] = parse_forecast(items)  # 10/3 은 자정 한 칸뿐이라 버림
        self.assertEqual((d["date"], d["key"], d["tempMax"], d["tempMin"], d["source"]), ("2026-10-02", "sunny", 23.0, 11.0, "forecast"))
        self.assertEqual([parse_precip(x) for x in ("강수없음", "1mm 미만", "30.0~50.0mm", "50.0mm 이상")], [0, 0.5, 30, 50])

    def test_base_and_span(self):
        self.assertEqual(latest_forecast_base(dt.datetime(2026, 10, 2, 5, 9)), ("20261002", "0200"))
        self.assertEqual(latest_forecast_base(dt.datetime(2026, 10, 2, 1, 0)), ("20261001", "2300"))
        today = dt.date(2026, 10, 2)
        self.assertEqual(days_to_fetch(today, set(), "2026-09-01"), ("2026-09-01", "2026-10-01"))
        have = {(dt.date(2026, 9, 1) + dt.timedelta(days=i)).isoformat() for i in range(25)}
        self.assertEqual(days_to_fetch(today, have, "2026-09-01"), ("2026-09-26", "2026-10-01"))
        have |= {"2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"}
        self.assertIsNone(days_to_fetch(today, have, "2026-09-01"))

    def test_kma_errors_readable(self):
        k = Kma({"serviceKey": "x"}, opener=lambda url: "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>")
        with self.assertRaisesRegex(Exception, "등록되지 않은 인증키"):
            k.observed("2026-10-01", "2026-10-01")


class FakeKma:
    conf = {"since": "2026-09-29"}

    def __init__(self):
        self.asked = []

    def observed(self, a, b):
        self.asked.append((a, b))
        days = []
        d = dt.date.fromisoformat(a)
        while d <= dt.date.fromisoformat(b):
            days.append({"date": d.isoformat(), "key": "sunny", "label": "맑음", "icon": "☀️", "tempMax": 20.0, "tempMin": 10.0, "rainMm": 0, "source": "observed", "basis": "119"})
            d += dt.timedelta(days=1)
        return days

    def forecast(self, now):
        return [{"date": "2026-10-01", "key": "rain", "label": "비", "icon": "🌧️", "tempMax": 18.0, "tempMin": 12.0, "rainMm": 3, "source": "forecast", "basis": "202610010500"}]


class WeatherRelay:
    def __init__(self):
        self.weather = []
        self.reports = []

    def put_weather(self, d):
        self.weather.append((d["date"], d["source"]))

    def put_report(self, r, version):
        self.reports.append(r["date"])

    def put_status(self, s):
        pass


CONF = {"name": "시험", "port": 8770, "officePin": "", "firebase": {"apiKey": "k", "projectId": "p", "email": "e@x", "password": "pw", "board": "b" * 20}, "weather": {"serviceKey": "x"}}


class OfficeWeatherTest(unittest.TestCase):
    def test_backfill_then_only_new(self):
        store, kma, relay = Store(":memory:"), FakeKma(), WeatherRelay()
        o = Office(CONF, store, relay=relay, kma=kma, now=lambda: dt.datetime(2026, 10, 1, 22, 10))
        o.tick()
        self.assertEqual(relay.weather, [("2026-09-29", "observed"), ("2026-09-30", "observed"), ("2026-10-01", "forecast")])
        # 다음 날: 어제(10/1) 관측값만 받아 예보를 바꿈 (관측은 예보를 바꾸고, 예보는 관측을 못 바꿈)
        relay.weather.clear()
        o.now = lambda: dt.datetime(2026, 10, 2, 9, 0)
        o.weather_due = True
        o.tick()
        self.assertEqual(kma.asked[-1], ("2026-10-01", "2026-10-01"))
        self.assertEqual(relay.weather, [("2026-10-01", "observed")])
        self.assertFalse(store.put_weather({"date": "2026-10-01", "source": "forecast", "key": "rain"}))
        self.assertEqual(store.weather("2026-10-01")["source"], "observed")


if __name__ == "__main__":
    unittest.main()
