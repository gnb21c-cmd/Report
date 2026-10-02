import datetime as dt
import os
import tempfile
import unittest

import report_sender.sources as s
from report_sender.outbox import Outbox
from report_sender.sources import FirebirdSource, FolderSource, SourceError, check_read_only, make_source
from report_sender.xls_report import parse_cells


def report(start, end, lines, limit=5000, total=None):
    cells = [["상품별 (일자별)"], [""], [f"조회일자 : {start} ~ {end}   조회줄수 : {limit}"], ["대분류", "중분류", "소분류", "상품코드", "상품명", "일자", "수량", "총매출액", "총할인액", "실매출액"]]
    cells += [["바리스타", "음료류", "커피류", code, name, day, q, g, 0, g] for code, name, day, q, g in lines]
    if total is not None:
        cells.append(["합계", "", "", "", "", "", *total])
    return cells


class ReadOnlyTest(unittest.TestCase):
    def test_accepts_select_and_with(self):
        check_read_only("SELECT 1 FROM RDB$DATABASE")
        check_read_only("with t as (select 1 a from x) select a from t;")
        check_read_only("SELECT name FROM P WHERE name = 'update 메뉴'")  # 따옴표 안은 괜찮음

    def test_rejects_writes(self):
        for bad in ("DELETE FROM SALE", "SELECT 1; DROP TABLE X", "update x set a=1", "SELECT * INTO y FROM x", ""):
            with self.assertRaises(SourceError):
                check_read_only(bad)


class FakeDb:
    database = "C:\\_OKPOS\\DATA\\OKPOS.FDB"

    def __init__(self, rows):
        self.rows, self.calls = rows, []

    def query(self, sql, params):
        self.calls.append(params)
        return ["YMD", "CODE", "NAME", "QTY", "GROSS", "DISCOUNT", "NET"], self.rows

    def close(self):
        pass


class FirebirdSourceTest(unittest.TestCase):
    def test_reads_day_and_aggregates(self):
        db = FakeDb([("20261001", "A1", "라떼", 1, 5500, 0, 5500), ("20261001", "A1", "라떼 ", 2, 11000, 500, 10500)])
        src = FirebirdSource({"dayQuery": "SELECT ... WHERE D = ? OR D2 = ?"}, db=db)
        [day] = src.poll(["2026-10-01"])
        self.assertEqual(db.calls, [["20261001", "20261001"]])
        self.assertEqual((day.date, day.source, [(r["name"], r["qty"], r["net"]) for r in day.rows]), ("2026-10-01", "DB", [("라떼", 3, 16000)]))

    def test_wrong_date_is_error(self):
        src = FirebirdSource({"dayQuery": "SELECT 1"}, db=FakeDb([("20260930", "A1", "라떼", 1, 1, 0, 1)]))
        with self.assertRaisesRegex(SourceError, "다른 날짜"):
            src.poll(["2026-10-01"])

    def test_make_source(self):
        self.assertEqual(make_source({"type": "none"}, None).type, "none")
        with self.assertRaises(SourceError):
            make_source({"type": "odbc"}, None)
        with self.assertRaises(SourceError):
            make_source({"type": "folder"}, None)


class XlsReportTest(unittest.TestCase):
    def test_parse(self):
        rep = parse_cells(report("2026-09-01", "2026-09-02", [("A1", "라떼", "2026-09-01", 2, 13000)], total=[2, 13000, 0, 13000]), str)
        self.assertEqual((rep["start"], rep["end"], rep["truncated"], rep["total_ok"], len(rep["rows"])), (dt.date(2026, 9, 1), dt.date(2026, 9, 2), False, True, 1))
        self.assertTrue(parse_cells(report("2026-09-01", "2026-09-01", [("A1", "라떼", "2026-09-01", 1, 1)], limit=1), str)["truncated"])
        with self.assertRaises(ValueError):
            parse_cells([["다른 보고서"]], str)


class FolderSourceTest(unittest.TestCase):
    def test_new_files_split_per_day_once_and_bad_files_skipped(self):
        d = tempfile.mkdtemp()
        store = Outbox(":memory:")
        for n in ("10월1일.xls", "잘림.xls", "합계틀림.xls", "메모.txt"):
            with open(os.path.join(d, n), "w", encoding="utf-8") as f:
                f.write(n)
            os.utime(os.path.join(d, n), (1, 1))
        reports = {
            "10월1일.xls": parse_cells(report("2026-09-30", "2026-10-01", [("A1", "라떼", "2026-10-01", 2, 13000)]), str),
            "잘림.xls": parse_cells(report("2026-08-01", "2026-08-31", [("A1", "라떼", "2026-08-01", 1, 1)], limit=1), str),
            "합계틀림.xls": parse_cells(report("2026-08-01", "2026-08-01", [("A1", "라떼", "2026-08-01", 1, 1)], total=[9, 9, 0, 9]), str),
        }
        old = s.read_report
        s.read_report = lambda p: reports[os.path.basename(p)]
        try:
            src = FolderSource({"folder": d}, store)
            days = src.poll()
            # 9/30 은 판매 없음(빈 하루), 10/1 은 1행 — 기간 전체를 하루씩
            self.assertEqual([(x.date, len(x.rows), x.source) for x in days], [("2026-09-30", 0, "엑셀:10월1일.xls"), ("2026-10-01", 1, "엑셀:10월1일.xls")])
            self.assertEqual(len(src.errors), 2)
            for x in days:
                x.queued()
            self.assertEqual(src.poll(), [])  # 이미 읽은 파일은 다시 안 읽음
        finally:
            s.read_report = old


if __name__ == "__main__":
    unittest.main()
