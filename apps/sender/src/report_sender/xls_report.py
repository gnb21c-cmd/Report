"""OK포스 "상품별 (일자별)" 엑셀 보고서(.xls) 읽기 — 내보내기 폴더 방식(source.type = "folder")에서 씀

아스타나 apps/pos-sync 의 xls_report.py 를 그대로 가져옴 (머리글·조회일자·조회줄수·합계 행)
"""
from __future__ import annotations

import datetime as dt
import re

HEADER = ["대분류", "중분류", "소분류", "상품코드", "상품명", "일자", "수량", "총매출액", "총할인액", "실매출액"]


class ReportError(ValueError):
    pass


def parse_cells(cells, to_date) -> dict:
    """cells: 시트의 행 목록(각 행은 칸 값 목록), to_date: 엑셀 날짜 칸 → date"""
    cell = lambda r, c: cells[r][c] if r < len(cells) and c < len(cells[r]) else ""
    info = " ".join(str(cell(r, c)) for r in range(min(6, len(cells))) for c in range(min(10, len(cells[r]))))
    m = re.search(r"조회일자\s*:\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})", info)
    if not m:
        raise ReportError("조회일자를 찾지 못했습니다 — '상품별 (일자별)' 보고서가 맞는지 확인해 주세요.")
    start, end = dt.date.fromisoformat(m.group(1)), dt.date.fromisoformat(m.group(2))
    lim = re.search(r"조회줄수\s*:\s*(\d+)", info)
    limit = int(lim.group(1)) if lim else None
    hdr = next((r for r in range(len(cells)) if [str(cell(r, c)).strip() for c in range(10)] == HEADER), None)
    if hdr is None:
        raise ReportError(f"머리글({', '.join(HEADER)})이 없습니다 — '상품별 (일자별)' 보고서가 맞는지 확인해 주세요.")
    rows, total = [], None
    for r in range(hdr + 1, len(cells)):
        v = [cell(r, c) for c in range(10)]
        if str(v[0]).strip() == "합계":
            total = v
            continue
        if not str(v[3]).strip():
            continue
        rows.append(
            {
                "date": to_date(v[5]),
                "cat1": v[0], "cat2": v[1], "cat3": v[2],
                "code": v[3], "name": v[4],
                "qty": v[6], "gross": v[7], "discount": v[8], "net": v[9],
            }
        )
    num = lambda x: int(round(float(x or 0)))
    sums = [sum(num(x[k]) for x in rows) for k in ("qty", "gross", "discount", "net")]
    return {
        "start": start,
        "end": end,
        "rows": rows,
        # 조회줄수 제한에 걸려 잘린 파일은 보내지 않음 (그날 자료가 모자람)
        "truncated": limit is not None and len(rows) >= limit,
        "total_ok": total is None or [num(t) for t in total[6:10]] == sums,
    }


def read_report(path: str) -> dict:
    import xlrd  # 내보내기 폴더 방식에서만 필요

    book = xlrd.open_workbook(path)
    sh = book.sheet_by_index(0)
    cells = [sh.row_values(r) for r in range(sh.nrows)]

    def to_date(v):
        if isinstance(v, float):
            return dt.datetime(*xlrd.xldate_as_tuple(v, book.datemode)).date()
        return str(v).strip()[:10]

    return parse_cells(cells, to_date)


def days_between(start: dt.date, end: dt.date) -> list:
    out, d = [], start
    while d <= end:
        out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out
