import datetime as dt
import json
import os
import socket
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from report_office import server as srv
from report_office.server import Office, private_client, serve
from report_office.store import BadInput, Store

HOURS = 12


def store_part(kind, date, basis="receipt", barista=100000, file="영수증별 매출 상세현황 (27).xls"):
    p = {
        "v": 1,
        "store": kind,
        "date": date,
        "basis": basis,
        "file": file,
        "sheetNet": barista,
        "posNet": barista,
        "voucher": 0,
        "sectors": {"바리스타": barista if kind == "cafe" else 0, "베이커리": 0, "키친": 0, "기타": 0},
        "cups": 10,
        "teams": 5,
        "teamSizes": [0, 1, 2, 1, 1, 0],
        "hourly": None if basis == "daily" else {"sectors": {s: [0] * HOURS for s in ("바리스타", "베이커리", "키친", "기타")}, "cups": [0] * HOURS, "teams": [0] * HOURS},
        "products": [["[ICE] 아메리카노", "바리스타", 10, barista]],
        "refunds": {"receipts": 0, "lines": 0, "unmatched": 0, "amount": 0},
        "kids": {"issued": 20, "walkIn": 4, "walkInNet": 48000, "eventFree": 2, "other": 0, "hourly": None} if kind == "kids" else None,
    }
    return p


def naver(date, n=3):
    return {"v": 1, "date": date, "tickets": [n] + [0] * 19, "newVisitors": [1] + [0] * 19}


CONF = {"name": "시험 C", "port": 8770, "officePin": "", "firebase": {"apiKey": "k", "projectId": "p", "email": "e@x", "password": "pw", "board": "b" * 20}, "weather": {"serviceKey": ""}}
TRIAL = {**CONF, "firebase": {"apiKey": "", "projectId": "", "email": "", "password": "", "board": ""}}


class FakeRelay:
    def __init__(self, fail=False):
        self.fail = fail
        self.reports = []
        self.weather = []
        self.status = []

    def put_report(self, r, version):
        if self.fail:
            raise RuntimeError("인터넷에 연결하지 못했습니다")
        self.reports.append(r)

    def put_weather(self, d):
        self.weather.append(d["date"])

    def put_status(self, s):
        self.status.append(s)


class StoreTest(unittest.TestCase):
    def test_parts_merge_by_date_and_replace(self):
        s = Store(":memory:")
        r1 = s.submit("2026-10-01", "김사무", {"naver": naver("2026-10-01")})
        self.assertEqual(set(r1) - {"meta", "at", "date"}, {"naver"})
        r2 = s.submit("2026-10-01", "박매니저", {"cafe": store_part("cafe", "2026-10-01")}, lines={"cafe": [{"pos": "01"}]}, products={"여름사냥": "바리스타", "이상": "모름"})
        self.assertEqual(set(r2) - {"meta", "at", "date"}, {"naver", "cafe"})
        self.assertEqual(r2["meta"]["naver"]["by"], "김사무")
        self.assertEqual(r2["meta"]["cafe"]["by"], "박매니저")
        self.assertEqual(r2["meta"]["cafe"]["file"], "영수증별 매출 상세현황 (27).xls")
        # 같은 조각이 다시 오면 바꿈 (두 번 더하지 않음)
        r3 = s.submit("2026-10-01", "박매니저", {"cafe": store_part("cafe", "2026-10-01", barista=200000)})
        self.assertEqual(r3["cafe"]["sectors"]["바리스타"], 200000)
        self.assertEqual(s.products(), {"여름사냥": "바리스타"})
        reports, last = s.reports_after(None)
        self.assertEqual([r["date"] for r in reports], ["2026-10-01"])
        self.assertEqual(s.reports_after(last)[0], [])
        self.assertEqual(s.last_date(), "2026-10-01")

    def test_rejects_bad_parts(self):
        s = Store(":memory:")
        with self.assertRaisesRegex(BadInput, "날짜"):
            s.submit("2026-10-01", "x", {"cafe": store_part("cafe", "2026-10-02")})
        with self.assertRaisesRegex(BadInput, "매장"):
            s.submit("2026-10-01", "x", {"cafe": store_part("kids", "2026-10-01")})
        with self.assertRaisesRegex(BadInput, "20칸"):
            s.submit("2026-10-01", "x", {"naver": {**naver("2026-10-01"), "tickets": [1, 2]}})
        with self.assertRaises(BadInput):
            s.submit("2026-10-01", "x", {})
        self.assertIsNone(s.report("2026-10-01"))

    def test_daily_import_does_not_override_receipt(self):
        s = Store(":memory:")
        s.submit("2025-10-02", "x", {"cafe": store_part("cafe", "2025-10-02")})
        saved, skipped = s.import_daily("x", [store_part("cafe", "2025-10-01", basis="daily"), store_part("cafe", "2025-10-02", basis="daily", barista=1)])
        self.assertEqual((saved, skipped), (1, 1))
        self.assertEqual(s.report("2025-10-02")["cafe"]["basis"], "receipt")
        self.assertEqual(s.report("2025-10-01")["cafe"]["basis"], "daily")


class OfficeTest(unittest.TestCase):
    def test_submit_publishes_and_retries(self):
        relay = FakeRelay(fail=True)
        o = Office(CONF, Store(":memory:"), relay=relay, now=lambda: dt.datetime(2026, 10, 2, 9, 0))
        r = o.submit({"date": "2026-10-01", "by": "김사무", "parts": {"naver": naver("2026-10-01")}})
        self.assertFalse(r["publish"]["ok"])
        self.assertIn("다시 올립니다", r["publish"]["message"])
        self.assertEqual(o.store.pending(), 1)
        self.assertEqual(o.info()["publish"]["pending"], 1)
        relay.fail = False
        o.tick()
        self.assertEqual([x["date"] for x in relay.reports], ["2026-10-01"])
        self.assertEqual(o.store.pending(), 0)
        self.assertEqual(relay.status[-1]["lastDate"], "")  # 매출(카페·키즈) 자료는 아직 없음
        r2 = o.submit({"date": "2026-10-01", "by": "박", "parts": {"kids": store_part("kids", "2026-10-01")}})
        self.assertTrue(r2["publish"]["ok"])
        self.assertEqual(set(relay.reports[-1]) & {"naver", "kids"}, {"naver", "kids"})

    def test_trial_mode_keeps_in_c(self):
        o = Office(TRIAL, Store(":memory:"))
        r = o.submit({"date": "2026-10-01", "by": "김", "parts": {"naver": naver("2026-10-01")}})
        self.assertFalse(r["publish"]["ok"])
        self.assertIn("시험 모드", r["publish"]["message"])
        self.assertTrue(o.info()["trial"])

    def test_private_only(self):
        self.assertEqual([private_client(a) for a in ("192.168.0.12", "10.1.2.3", "127.0.0.1", "::1", "8.8.8.8", "::ffff:192.168.1.5")], [True, True, True, True, False, True])


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class HttpTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        with open(os.path.join(self.tmp, "entry.html"), "w", encoding="utf-8") as f:
            f.write("<title>매출 보고 입력</title>")
        self._web = srv.web_dir
        srv.web_dir = lambda: self.tmp
        self.port = free_port()
        self.office = Office({**TRIAL, "officePin": "1234"}, Store(":memory:"))
        self.stop = threading.Event()
        self.httpd = serve(self.office, self.port, stop=self.stop, host="127.0.0.1", udp=False)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.stop.set()
        self.httpd.shutdown()
        self.httpd.server_close()
        srv.web_dir = self._web

    def req(self, path, body=None, pin="1234"):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, method="POST" if data else "GET", headers={"Content-Type": "application/json", "X-Office-Pin": pin})
        try:
            with urllib.request.urlopen(r, timeout=5) as res:
                raw = res.read().decode("utf-8")
                return res.status, json.loads(raw) if path.startswith("/api") else raw
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8"))

    def test_pages_and_api(self):
        code, page = self.req("/")
        self.assertEqual(code, 200)
        self.assertIn("매출 보고 입력", page)
        code, page = self.req("/b/")
        self.assertIn("화면 파일(report.html)이 없습니다", page)
        self.assertEqual(self.req("/api/info")[1]["pin"], True)
        # 비밀번호가 틀리면 쓰기 안 됨
        code, body = self.req("/api/submit", {"date": "2026-10-01", "by": "김", "parts": {"naver": naver("2026-10-01")}}, pin="0000")
        self.assertEqual(code, 401)
        code, body = self.req("/api/submit", {"date": "2026-10-01", "by": "김", "parts": {"naver": naver("2026-10-01")}})
        self.assertEqual(code, 200)
        self.assertEqual(body["report"]["naver"]["tickets"][0], 3)
        code, body = self.req("/api/submit", {"date": "2026-10-01", "by": "김", "parts": {"cafe": store_part("cafe", "2026-09-30")}})
        self.assertEqual(code, 400)
        self.assertIn("날짜", body["error"])
        self.assertEqual(self.req("/api/day?date=2026-10-01")[1]["report"]["meta"]["naver"]["by"], "김")
        self.assertEqual([r["date"] for r in self.req("/api/reports")[1]["reports"]], ["2026-10-01"])
        code, body = self.req("/api/import", {"by": "김", "parts": [store_part("kids", "2025-10-01", basis="daily")]})
        self.assertEqual((code, body["saved"]), (200, 1))
        self.assertEqual(self.req("/api/products")[1], {"products": {}})


class DiscoveryTest(unittest.TestCase):
    def test_answers_name_and_port(self):
        stop = threading.Event()
        port = free_port()
        t = threading.Thread(target=srv.discovery, args=(8770, stop, port), daemon=True)
        t.start()
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(3)
        for _ in range(20):
            s.sendto(b"POSREPORT-C?", ("127.0.0.1", port))
            try:
                data, _ = s.recvfrom(256)
                break
            except socket.timeout:
                continue
        stop.set()
        s.close()
        j = json.loads(data.decode("utf-8"))
        self.assertEqual((j["app"], j["port"], j["name"]), ("posreport-c", 8770, socket.gethostname()))


if __name__ == "__main__":
    unittest.main()
