import datetime as dt
import decimal
import unittest

from report_sender.normalize import RowError, aggregate, day_text, normalize_row, rows_hash, totals


class NormalizeTest(unittest.TestCase):
    def test_day_text(self):
        self.assertEqual(day_text("20260929"), "2026-09-29")
        self.assertEqual(day_text("2026/9/3"), "2026-09-03")
        self.assertEqual(day_text("2026-09-29 13:10:00"), "2026-09-29")
        self.assertEqual(day_text(dt.datetime(2026, 9, 29, 23, 59)), "2026-09-29")
        self.assertEqual(day_text(dt.date(2026, 1, 2)), "2026-01-02")
        for bad in ("", None, "20261340", "어제"):
            with self.assertRaises(RowError):
                day_text(bad)

    def test_only_sale_fields_are_kept(self):
        r = normalize_row({"DATE": "20260929", "Code": " 000040 ", "name": " [HOT]   카페라떼 ", "qty": decimal.Decimal("2"), "gross": "13,000", "discount": 0, "net": 13000.4, "card_no": "9410-1234-5678-9012", "tel": "010-1234-5678"})
        self.assertEqual(
            r,
            {"date": "2026-09-29", "code": "000040", "name": "[HOT] 카페라떼", "cat1": "", "cat2": "", "cat3": "", "qty": 2, "gross": 13000, "discount": 0, "net": 13000},
        )
        self.assertIsNone(normalize_row({"date": "20260929", "code": "1", "name": "  "}))
        self.assertEqual(normalize_row({"date": "20260929", "name": "코드없음", "qty": 1})["code"], "-")
        with self.assertRaises(RowError):
            normalize_row({"date": "20260929", "name": "x", "qty": "많이"})

    def test_aggregate_sums_receipt_lines_and_drops_zero(self):
        lines = [
            {"date": "20260929", "code": "A1", "name": "아메리카노", "cat1": "바리스타", "qty": 1, "gross": 5000, "net": 5000},
            {"date": "20260929", "code": "A1", "name": "아메리카노 ", "qty": 2, "gross": 10000, "discount": 1000, "net": 9000},
            {"date": "20260929", "code": "B1", "name": "맥주", "qty": 1, "gross": 7000, "net": 7000},
            {"date": "20260929", "code": "B1", "name": "맥주", "qty": -1, "gross": -7000, "net": -7000},  # 같은 날 반품
            {"date": "20260929", "code": "C1", "name": "쿠폰", "qty": -1, "gross": 0, "net": -3000},  # 음수는 그대로
        ]
        rows = aggregate(lines)
        self.assertEqual([(r["code"], r["qty"], r["net"]) for r in rows], [("A1", 3, 14000), ("C1", -1, -3000)])
        self.assertEqual(rows[0]["cat1"], "바리스타")
        self.assertEqual(totals(rows)["net"], 11000)

    def test_hash_ignores_order(self):
        a = aggregate([{"date": "20260929", "code": "1", "name": "가", "qty": 1, "net": 1}, {"date": "20260929", "code": "2", "name": "나", "qty": 1, "net": 1}])
        self.assertEqual(rows_hash(a), rows_hash(list(reversed(a))))
        b = [dict(a[0], qty=2), a[1]]
        self.assertNotEqual(rows_hash(a), rows_hash(b))


if __name__ == "__main__":
    unittest.main()
