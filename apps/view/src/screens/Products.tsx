/* 상품 — 기간을 골라 상품별 수량·실매출 (상품명 기준, VAN 변경 전후를 이어서) */
import { useMemo, useState } from "react";
import { addDays, addMonths, count, daysInMonth, monthOf, monthStart, POS_LABEL, won, type PosId, type SalesIndex } from "@report/core";

type Range = "day" | "7" | "month" | "prev" | "90";
const RANGES: [Range, string][] = [
  ["day", "어제"],
  ["7", "7일"],
  ["month", "이달"],
  ["prev", "지난달"],
  ["90", "90일"],
];

function span(r: Range, date: string): [string, string] {
  if (r === "day") return [date, date];
  if (r === "7") return [addDays(date, -6), date];
  if (r === "90") return [addDays(date, -89), date];
  if (r === "month") return [monthStart(date), date];
  const pm = addMonths(monthOf(date), -1);
  return [`${pm}-01`, `${pm}-${String(daysInMonth(`${pm}-01`)).padStart(2, "0")}`];
}

export function Products({ idx, date }: { idx: SalesIndex; date: string }) {
  const [range, setRange] = useState<Range>("month");
  const [pos, setPos] = useState<PosId | "all">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"net" | "qty">("net");
  const [from, to] = span(range, date);
  const all = useMemo(() => idx.products(from, to), [idx, from, to]);
  const rows = all
    .filter((p) => (pos === "all" || p.pos === pos) && (!q.trim() || p.name.includes(q.trim())))
    .sort((a, b) => (sort === "net" ? b.net - a.net : b.qty - a.qty));
  const total = rows.reduce((s, p) => s + p.net, 0);

  return (
    <>
      <div className="filters">
        <div className="seg">
          {RANGES.map(([v, l]) => (
            <button key={v} className={range === v ? "on" : ""} aria-pressed={range === v} onClick={() => setRange(v)}>
              {l}
            </button>
          ))}
        </div>
        <div className="row">
          <select value={pos} onChange={(e) => setPos(e.target.value as PosId | "all")} aria-label="POS">
            <option value="all">카페 + 키즈</option>
            <option value="cafe">카페</option>
            <option value="kids">키즈</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as "net" | "qty")} aria-label="정렬">
            <option value="net">실매출 순</option>
            <option value="qty">수량 순</option>
          </select>
          <input type="search" placeholder="상품 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>상품별 매출</h2>
            <p className="sub">
              {from === to ? from : `${from} ~ ${to}`} · {rows.length}개 · 합계 {won(total)}
            </p>
          </div>
        </div>
        <div className="table-wrap">
          {rows.length ? (
            <table>
              <thead>
                <tr>
                  <th>상품</th>
                  <th className="num">수량</th>
                  <th className="num">실매출</th>
                  <th className="num">비중</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.pos + p.name}>
                    <td>
                      {p.name}
                      <div className="note">
                        {POS_LABEL[p.pos]} · {p.team}
                        {p.codes.length > 1 ? ` · 코드 ${p.codes.length}개` : ""}
                      </div>
                    </td>
                    <td className="num">{count(p.qty)}</td>
                    <td className="num">{won(p.net)}</td>
                    <td className="num">{total > 0 ? `${((p.net / total) * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty">이 기간에 판매 자료가 없습니다.</p>
          )}
        </div>
        <p className="note">2026년 7월 VAN 변경으로 상품코드가 모두 바뀌어, 상품명이 같으면 같은 상품으로 합쳐 보여 드립니다.</p>
      </section>
    </>
  );
}
