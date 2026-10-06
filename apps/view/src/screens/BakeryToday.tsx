/* ============================================================
   오늘 베이커리 생산 — 작업지시 앱이 통계로 정하고 매니저가 확정한 오늘(한국 시간) 빵별 생산 수량
   - 첫 화면 카드: 오늘 날짜 · 총 개수 · 종류 수 (아침마다 그날 것으로 바뀜, 마감일과 상관없음)
   - 누르면 빵별 수량 · 확정/자동 (확정 = 매니저가 확정, 자동 = 마감까지 확정이 없어 앱 수량 그대로)
   ============================================================ */
import { count, nowKst, orderRows, shortLabel, type Board } from "@report/core";
import { useBakeryDoc } from "../data/bakery";
import { Chevron, type Open } from "./Home";

function useToday(board: Board) {
  const now = nowKst();
  const doc = useBakeryDoc(board, now.date);
  const rows = doc ? orderRows(doc.plan, doc.order, now).filter((r) => (r.qty || 0) > 0) : [];
  return { date: now.date, doc, rows, total: rows.reduce((a, r) => a + (r.qty || 0), 0) };
}

/** 첫 화면 카드 — 오늘 작업지시가 없으면 안 보임 */
export function TodayBreadCard({ board, open }: { board: Board; open: Open }) {
  const { date, rows, total } = useToday(board);
  if (!rows.length) return null;
  const auto = rows.filter((r) => r.state !== "확정").length;
  return (
    <button className="stat tap bread-today" onClick={() => open({ name: "bakeryToday" })} aria-label="오늘 베이커리 생산 자세히">
      <div className="stat-label">
        오늘({shortLabel(date)}) 베이커리 생산 <Chevron />
      </div>
      <div className="stat-value">{count(total, "개")}</div>
      <span className="note">
        {rows.length}종 · {auto ? `확정 ${rows.length - auto} · 자동 ${auto}` : "모두 매니저 확정"}
      </span>
    </button>
  );
}

/** 오늘 빵별 생산 수량 */
export function BakeryToday({ board, onBack }: { board: Board; onBack: () => void }) {
  const { date, doc, rows, total } = useToday(board);
  return (
    <>
      <header className="detail-head">
        <button className="icon-btn" onClick={onBack} aria-label="뒤로">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1>오늘 베이커리 생산</h1>
        <span />
      </header>
      <main className="content">
        <section className="card">
          <h2>
            {shortLabel(date)} 생산 확정 <small className="muted">총 {count(total, "개")} · {rows.length}종</small>
          </h2>
          {doc === undefined ? (
            <p className="empty">받는 중입니다…</p>
          ) : !rows.length ? (
            <p className="empty">오늘 작업지시 자료가 아직 없습니다.</p>
          ) : (
            <table className="bread-tbl">
              <thead>
                <tr>
                  <th>상품</th>
                  <th className="num">생산</th>
                  <th className="num">구분</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td className="num">{(r.qty || 0).toLocaleString("ko-KR")}</td>
                    <td className={`num${r.state === "확정" ? "" : " muted"}`}>{r.state}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>합계</td>
                  <td className="num">{total.toLocaleString("ko-KR")}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
          <p className="note muted">작업지시 앱이 지난 판매 · 날씨로 정한 수량을 매니저가 확정한 것입니다. 확정 = 매니저 확정, 자동 = 마감(3일 전 18시)까지 확정이 없어 앱 수량 그대로.</p>
        </section>
      </main>
    </>
  );
}
