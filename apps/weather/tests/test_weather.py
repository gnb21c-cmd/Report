import datetime as dt
import json
import unittest

from report_weather.weather import Kma, days_to_fetch, latest_forecast_base, parse_asos, parse_forecast, parse_precip


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


class FakeRelay:
    def __init__(self, have=None):
        self.have = dict(have or {})
        self.put = []

    def weather_sources(self):
        return dict(self.have)

    def put_weather(self, d):
        self.put.append((d["date"], d["source"]))
        self.have[d["date"]] = d["source"]


class RunTest(unittest.TestCase):
    def run_once(self, relay, kma, now, errors=None):
        import importlib.util, pathlib, sys
        # __main__ 은 불러오면 main() 을 돌리므로 run 만 꺼내 씀
        src = pathlib.Path(__file__).resolve().parents[1] / "src" / "report_weather" / "__main__.py"
        code = src.read_text(encoding="utf-8").replace("sys.exit(main())", "")
        ns = {"__name__": "report_weather._t", "__package__": "report_weather"}
        exec(compile(code, str(src), "exec"), ns)
        return ns["run"](relay, kma, now, errors)

    def test_backfill_then_only_new(self):
        relay, kma = FakeRelay(), FakeKma()
        done = self.run_once(relay, kma, dt.datetime(2026, 10, 1, 22, 10))
        self.assertEqual(done, [("2026-09-29", "observed"), ("2026-09-30", "observed"), ("2026-10-01", "forecast")])
        # 다음 날: 어제(10/1) 관측만 받아 예보를 바꿈
        done = self.run_once(relay, kma, dt.datetime(2026, 10, 2, 9, 0))
        self.assertEqual(kma.asked[-1], ("2026-10-01", "2026-10-01"))
        self.assertEqual(done, [("2026-10-01", "observed")])  # 가짜 예보는 10/1 것뿐이고 10/1 은 이미 관측이라 건너뜀

    def test_long_backfill_is_split(self):
        relay, kma = FakeRelay(), FakeKma()
        kma.conf = {"since": "2026-01-01"}
        self.run_once(relay, kma, dt.datetime(2026, 10, 1, 9, 0))
        self.assertEqual(kma.asked[0], ("2026-01-01", "2026-03-01"))  # 60일씩
        self.assertEqual(kma.asked[-1][1], "2026-09-30")
        self.assertTrue(all((dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days < 60 for a, b in kma.asked))

    def test_observed_failure_keeps_forecast(self):
        from report_weather.weather import WeatherError

        class SlowKma(FakeKma):
            def observed(self, a, b):
                raise WeatherError("기상청 서버에 연결하지 못했습니다", retry=True)

        relay, errors = FakeRelay(), []
        done = self.run_once(relay, SlowKma(), dt.datetime(2026, 10, 1, 9, 0), errors)
        self.assertEqual(done, [("2026-10-01", "forecast")])  # 관측이 안 돼도 예보는 올라감
        self.assertEqual(len(errors), 1)


if __name__ == "__main__":
    unittest.main()
