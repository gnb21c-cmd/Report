"""POS 에서 읽은 행 → 보고 앱(B)으로 보낼 모양 (packages/core/src/types.ts SaleLine 과 같은 칸)

아스타나 apps/pos-sync 의 normalize.py 를 그대로 가져옴

- 보내는 칸은 date·code·name·cat1·cat2·cat3·qty·gross·discount·net 뿐. 다른 칸(카드번호 등)은 여기서 버림
- 같은 날·상품코드·상품명은 더해서 한 행으로 (쿼리가 영수증 줄 단위로 줘도 됨)
- 상품명은 앞뒤 공백을 떼고 가운데 공백은 하나로 (VAN 이 바뀌어 코드가 달라도 이름으로 같은 상품을 알아봄)
"""
from __future__ import annotations

import datetime as dt
import decimal
import hashlib
import json
import re

FIELDS = ("date", "code", "name", "cat1", "cat2", "cat3", "qty", "gross", "discount", "net")
NUMS = ("qty", "gross", "discount", "net")
LIMIT = 2_000_000_000


class RowError(ValueError):
    pass


def day_text(v) -> str:
    """2026-09-29 · 20260929 · 2026/9/29 · 날짜 값 → 2026-09-29"""
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    s = str(v if v is not None else "").strip()
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", s) or re.match(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})", s)
    if m:
        try:
            return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        except ValueError:
            pass
    raise RowError(f"날짜를 알아볼 수 없어요: {v!r}")


def product_name(v) -> str:
    return re.sub(r"\s+", " ", str(v if v is not None else "")).strip()[:100]


def _text(v, n: int) -> str:
    return str(v if v is not None else "").strip()[:n]


def _num(v, field: str) -> int:
    if v is None or v == "":
        return 0
    try:
        if isinstance(v, str):
            v = v.replace(",", "").strip() or "0"
        n = int(decimal.Decimal(str(v)).to_integral_value(rounding=decimal.ROUND_HALF_UP))
    except (decimal.InvalidOperation, ValueError):
        raise RowError(f"{field} 값이 숫자가 아니에요: {v!r}")
    if abs(n) > LIMIT:
        raise RowError(f"{field} 값이 너무 커요: {v!r}")
    return n


def normalize_row(raw: dict) -> dict | None:
    """한 행 정리. 상품명이 없는 행은 None (버림)"""
    low = {str(k).strip().lower(): v for k, v in raw.items()}
    name = product_name(low.get("name"))
    if not name:
        return None
    return {
        "date": day_text(low.get("date")),
        "code": _text(low.get("code"), 40) or "-",
        "name": name,
        "cat1": _text(low.get("cat1"), 40),
        "cat2": _text(low.get("cat2"), 40),
        "cat3": _text(low.get("cat3"), 40),
        **{k: _num(low.get(k), k) for k in NUMS},
    }


def aggregate(raw_rows) -> list:
    """정리 + 같은 날·코드·상품명 합치기. 수량·금액이 모두 0 인 행은 뺌 (같은 날 팔고 모두 취소)"""
    out: dict = {}
    for raw in raw_rows:
        r = normalize_row(raw)
        if r is None:
            continue
        key = (r["date"], r["code"], r["name"])
        cur = out.get(key)
        if cur is None:
            out[key] = r
            continue
        for k in NUMS:
            cur[k] += r[k]
        for k in ("cat1", "cat2", "cat3"):
            cur[k] = r[k] or cur[k]
    return [r for _, r in sorted(out.items()) if any(r[k] for k in NUMS)]


def rows_hash(rows) -> str:
    """같은 내용이면 같은 값 — 바뀐 것이 없으면 다시 보내지 않으려고"""
    body = json.dumps(sorted(rows, key=lambda r: (r["date"], r["code"], r["name"])), ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def totals(rows) -> dict:
    return {k: sum(r[k] for r in rows) for k in NUMS}


def won(n: int) -> str:
    return f"{n:,}원"
