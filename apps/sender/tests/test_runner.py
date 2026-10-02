import datetime as dt
import json
import unittest

from report_sender.gui import result_lines
from report_sender.outbox import Outbox
from report_sender.relay import FirebaseRelay, RelayError, day_doc, fields
from report_sender.runner import Sender, days_to_read
from report_sender.sources import DayRows, SourceError

CONF = {"pos": "kids", "catchUpDays": 2, "firebase": {}, "source": {"type": "none"}}


def row(name, net, qty=1, date="2026-10-01"):
    return {"date": date, "code": "1", "name": name, "cat1": "", "cat2": "", "cat3": "", "qty": qty, "gross": net, "discount": 0, "net": net}


class FakeSource:
    type = "fake"

    def __init__(self, days):
        self.days, self.asked, self.errors = days, None, []

    def poll(self, days):
        self.asked = days
        return [DayRows(d, rows, "DB") for d, rows in self.days.items() if d in days]

    def describe(self):
        return "가짜"

    def close(self):
        pass


class FakeRelay:
    def __init__(self, fail=None):
        self.days, self.status, self.fail = [], [], fail

    def put_day(self, pos, date, rows, source, version):
        if self.fail:
            raise self.fail
        self.days.append((pos, date, len(rows)))

    def put_status(self, pos, status):
        self.status.append(status)


def sender(days, relay=None, outbox=None):
    return Sender(CONF, outbox=outbox or Outbox(":memory:"), source=FakeSource(days), relay=relay or FakeRelay(), today=lambda: dt.date(2026, 10, 1))


class RunnerTest(unittest.TestCase):
    def test_reads_today_and_catch_up_days(self):
        self.assertEqual(days_to_read(dt.date(2026, 10, 1), 2), ["2026-09-29", "2026-09-30", "2026-10-01"])

    def test_sends_changed_days_only_and_skips_empty_unsent(self):
        days = {"2026-09-29": [], "2026-09-30": [row("자유입장권", 15000, date="2026-09-30")], "2026-10-01": [row("자유입장권", 30000, 2)]}
        relay, ob = FakeRelay(), Outbox(":memory:")
        res = sender(days, relay, ob).run()
        self.assertEqual(relay.days, [("kids", "2026-09-30", 1), ("kids", "2026-10-01", 1)])  # 9/29 는 빈 날이라 안 보냄
        self.assertTrue(res.ok)
        self.assertEqual(relay.status[-1]["lastDate"], "2026-10-01")
        # 다시 눌러도 바뀐 것이 없으면 안 보냄
        relay2 = FakeRelay()
        res2 = sender(days, relay2, ob).run()
        self.assertEqual(relay2.days, [])
        self.assertIn("바뀐 것이 없어", result_lines(res2)[0])
        # 한 번 보낸 날의 결제가 모두 취소되면 빈 하루를 보내 비움
        days["2026-10-01"] = []
        relay3 = FakeRelay()
        sender(days, relay3, ob).run()
        self.assertEqual(relay3.days, [("kids", "2026-10-01", 0)])

    def test_offline_keeps_and_sends_later(self):
        ob = Outbox(":memory:")
        days = {"2026-10-01": [row("자유입장권", 15000)]}
        res = sender(days, FakeRelay(fail=RelayError("인터넷에 연결하지 못했습니다")), ob).run()
        self.assertEqual((res.pending, res.ok), (1, False))
        self.assertTrue(any("못 보낸 날 1일" in ln for ln in result_lines(res)))
        relay = FakeRelay()
        res = sender({}, relay, ob).run()  # 다음 보내기 때 남은 것을 보냄
        self.assertEqual((relay.days, res.pending), ([("kids", "2026-10-01", 1)], 0))

    def test_source_error_still_flushes_waiting(self):
        ob = Outbox(":memory:")
        ob.enqueue("2026-09-30", [row("a", 1, date="2026-09-30")], "h", "DB")

        class Broken(FakeSource):
            def poll(self, days):
                raise SourceError("POS DB 로그인 실패")

        relay = FakeRelay()
        s = Sender(CONF, outbox=ob, source=Broken({}), relay=relay, today=lambda: dt.date(2026, 10, 1))
        res = s.run()
        self.assertEqual(relay.days, [("kids", "2026-09-30", 1)])
        self.assertEqual(res.error, "POS DB 로그인 실패")


class RelayTest(unittest.TestCase):
    def test_day_doc_fields(self):
        doc = day_doc("cafe", "2026-10-01", [row("라떼", 5500)], "DB", "cafe-pos@x", "0.1.0", dt.datetime(2026, 10, 1, 13, 0, tzinfo=dt.timezone.utc))
        f = fields(doc)["fields"]
        self.assertEqual(f["count"], {"integerValue": "1"})
        self.assertEqual(f["net"], {"integerValue": "5500"})
        self.assertEqual(f["sentAt"], {"timestampValue": "2026-10-01T13:00:00.000000Z"})
        self.assertEqual(json.loads(f["rows"]["stringValue"])[0]["name"], "라떼")

    def test_login_once_then_patch_document(self):
        calls = []

        def post(url, body, token=None, method="POST"):
            calls.append((url.split("?")[0].split("/documents/")[-1] if "/documents/" in url else url.split("?")[0].rsplit("/", 1)[-1], method, token))
            return {"idToken": "T", "expiresIn": "3600"} if "signInWithPassword" in url else {}

        r = FirebaseRelay({"apiKey": "k", "projectId": "p", "email": "e", "password": "w", "board": "B0ard"}, clock=lambda: 0, post=post)
        r.put_day("cafe", "2026-10-01", [], "DB", "0.1.0")
        r.put_day("cafe", "2026-10-02", [], "DB", "0.1.0")
        self.assertEqual(calls, [("accounts:signInWithPassword", "POST", None), ("boards/B0ard/days/cafe_2026-10-01", "PATCH", "T"), ("boards/B0ard/days/cafe_2026-10-02", "PATCH", "T")])


if __name__ == "__main__":
    unittest.main()


class TrialTest(unittest.TestCase):
    def test_trial_reads_all_stores_into_one_file_without_sending(self):
        import os
        import tempfile

        from report_sender.config import trial_mode
        from report_sender.gui import office_lines
        from report_sender.trial import TrialSender

        conf = {"stores": {"cafe": {"type": "folder"}, "kids": {"type": "folder"}}, "catchUpDays": 0, "firebase": {}}
        self.assertTrue(trial_mode(conf))
        d = tempfile.mkdtemp()
        data = {"cafe": {"2026-10-01": [row("[ICE] 아메리카노", 5000, 1)]}, "kids": {"2026-10-01": [row("자유입장권", 12000, 1)]}}
        t = TrialSender(conf, out_dir=d, today=lambda: dt.date(2026, 10, 1), make=lambda c, s, it=iter(["cafe", "kids"]): FakeSource(data[next(it)]))
        results = t.run()
        self.assertEqual([(p, r.read) for p, r in results], [("cafe", [("2026-10-01", 1, 5000, True)]), ("kids", [("2026-10-01", 1, 12000, True)])])
        text = open(results[0][1].trial_file, encoding="utf-8-sig").read()
        self.assertIn("======== 카페 ========", text)
        self.assertIn("자유입장권", text)
        lines = "\n".join(office_lines(results))
        self.assertIn("[카페]", lines)
        self.assertIn("시험 모드라 보내지 않았습니다", lines)
        self.assertEqual(len(os.listdir(d)), 1)


class OfficeTest(unittest.TestCase):
    def test_both_stores_sent_from_one_pc_weather_once(self):
        import tempfile

        from report_sender.office import OfficeSender

        relay = FakeRelay()
        conf = {"stores": {"cafe": {"type": "folder"}, "kids": {"type": "folder"}}, "catchUpDays": 0, "firebase": {}, "weather": {}}
        data = {"cafe": {"2026-10-01": [row("[ICE] 아메리카노", 5000, 1)]}, "kids": {"2026-10-01": [row("자유입장권", 12000, 1)]}}
        names = iter(["cafe", "kids"])
        o = OfficeSender(conf, relay=relay, make_source=lambda c, ob: FakeSource(data[next(names)]), today=lambda: dt.date(2026, 10, 1), out_dir=tempfile.mkdtemp())
        self.assertIsNone(o.senders[1][1].kma)
        results = o.run()
        o.close()
        self.assertEqual(relay.days, [("cafe", "2026-10-01", 1), ("kids", "2026-10-01", 1)])
        self.assertTrue(all(r.ok for _, r in results))

    def test_config_reads_old_single_store_shape(self):
        import json
        import os
        import tempfile

        from report_sender.config import load, office_stores, pos_label

        p = os.path.join(tempfile.mkdtemp(), "c.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump({"pos": "kids", "source": {"type": "folder", "folder": "X"}}, f)
        c = load(p)
        self.assertEqual(c["stores"], {"kids": {"type": "folder", "folder": "X"}})
        self.assertEqual(pos_label(c), "키즈")
        st = office_stores("C:\\PosReport\\엑셀")
        self.assertEqual(st["cafe"]["folder"], "C:\\PosReport\\엑셀\\카페")
        self.assertEqual(pos_label({"stores": st}), "카페 · 키즈")


if __name__ == "__main__":
    unittest.main()
