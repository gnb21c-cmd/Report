/* ============================================================
   자금 현황 — 사무실 A 가 올린 '자금요약' · '자금 변동 내역'을 폰 크기로
   - 맨 위: 잔액 합계(증권계좌 빼고) · 증권계좌 · 대출 제외 자금
   - 계좌별 금일 잔고 (움직인 계좌는 전일 · 입금 · 출금도)
   - 보고 시점 환율 (직전 보고 대비)
   - 그날 입출금 내역 (거래처 · 적요 · 금액)
   전일 잔고는 앞 자금 보고의 금일 잔고로 이어서 계산 (core cashBook)
   ============================================================ */
import { CASH_GROUP_LABEL, money, shortLabel, type CashGroup, type CashPart, type CashSummary, type PartMeta } from "@report/core";
import { DetailHeader, type Nav } from "./parts";

const GROUPS: { g: CashGroup; mark?: string }[] = [
  { g: "cash", mark: "ⓐ" },
  { g: "deposit", mark: "ⓑ" },
  { g: "securities", mark: "ⓒ" },
  { g: "minus", mark: "ⓓ" },
  { g: "usd" },
  { g: "jpy" },
];

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const krw = (v: number) => `${money(v, "KRW", false)}원`;

export function CashDetail({ sum, part, meta, earlier, ...nav }: { sum?: CashSummary; part?: CashPart; meta?: PartMeta; earlier: string | null } & Nav) {
  return (
    <>
      <DetailHeader title="자금 현황" {...nav} />
      <main className="content cash-detail">
        {!sum || !part ? (
          <div className="card">
            <p className="empty">{shortLabel(nav.date)} 자금 보고가 아직 없습니다.</p>
            {earlier && (
              <button className="chip" onClick={() => nav.onDate(earlier)}>
                가장 가까운 보고 {shortLabel(earlier)} 보기
              </button>
            )}
          </div>
        ) : (
          <Body sum={sum} part={part} meta={meta} />
        )}
      </main>
    </>
  );
}

function Body({ sum, part, meta }: { sum: CashSummary; part: CashPart; meta?: PartMeta }) {
  const moves = sum.lines.filter((l) => (part.rows[l.account.id] || []).length);
  return (
    <>
      <section className="card cash-hero">
        <div className="ch-row">
          <span className="ch-label">잔액 합계</span>
          <span className="ch-value">{krw(sum.total)}</span>
        </div>
        <div className="ch-sub">
          원화 {krw(sum.krw.close - sum.securities)}
          {sum.usdKrw ? ` · 달러 환산 ${krw(sum.usdKrw)}` : ""}
          {sum.jpyKrw ? ` · 엔화 환산 ${krw(sum.jpyKrw)}` : ""}
        </div>
        <div className="ch-row sec">
          <span className="ch-label">법인 증권계좌 (별도)</span>
          <span className="ch-value small">{krw(sum.securities)}</span>
        </div>
        <div className="ch-row net">
          <span className="ch-label">
            대출 제외 자금 <small className="muted">잔액 + 증권 − 대출</small>
          </span>
          <span className={`ch-value small ${sum.net < 0 ? "minus" : ""}`}>{sum.net < 0 ? `(${money(-sum.net, "KRW", false)})원` : krw(sum.net)}</span>
        </div>
        {part.loans.length > 0 && (
          <div className="ch-sub">
            {part.loans.map((l) => (
              <div key={l.label}>
                {l.label} {krw(l.amount)}
              </div>
            ))}
          </div>
        )}
        <div className="ch-sub">
          그날 원화 입금 <b className="in">+{money(sum.krw.in, "KRW", false)}</b> · 출금 <b className="out">−{money(sum.krw.out, "KRW", false)}</b>
        </div>
      </section>

      <section className="card">
        <h2>계좌별 잔고</h2>
        {GROUPS.map(({ g, mark }) => {
          const lines = sum.lines.filter((l) => l.account.group === g);
          const cur = lines[0].currency;
          const tot = sum.group[g];
          const shown = lines.filter((l) => l.open || l.close || l.in || l.out);
          return (
            <div key={g} className="cash-group">
              <div className="cg-head">
                <span>
                  {CASH_GROUP_LABEL[g]} {mark || ""}
                </span>
                <b>{money(tot.close, cur, false)}</b>
              </div>
              {lines.length > 1 &&
                (shown.length ? shown : []).map((l) => (
                  <div key={l.account.id} className="cg-line">
                    <div className="cg-main">
                      <span>{l.account.name}</span>
                      <b>{money(l.close, cur)}</b>
                    </div>
                    {(l.in > 0 || l.out > 0) && (
                      <div className="cg-move">
                        전일 {money(l.open, cur, false)}
                        {l.in > 0 && <span className="in"> +{money(l.in, cur)}</span>}
                        {l.out > 0 && <span className="out"> −{money(l.out, cur)}</span>}
                      </div>
                    )}
                  </div>
                ))}
              {lines.length === 1 && (tot.in > 0 || tot.out > 0) && (
                <div className="cg-move">
                  전일 {money(tot.open, cur, false)}
                  {tot.in > 0 && <span className="in"> +{money(tot.in, cur)}</span>}
                  {tot.out > 0 && <span className="out"> −{money(tot.out, cur)}</span>}
                </div>
              )}
              {(g === "usd" || g === "jpy") && (
                <div className="cg-rate">
                  {g === "usd" ? "USD 환율" : "JPY 환율 (100엔)"} {sum.rates[g].toLocaleString("ko-KR", { minimumFractionDigits: 2 })}원
                  {sum.rateChange[g] != null && (
                    <span className={sum.rateChange[g]! > 0 ? "out" : sum.rateChange[g]! < 0 ? "in" : ""}>
                      {" "}
                      ({sum.rateChange[g]! > 0 ? "+" : ""}
                      {sum.rateChange[g]!.toFixed(2)})
                    </span>
                  )}
                  {" → "}원화 {krw(g === "usd" ? sum.usdKrw : sum.jpyKrw)}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2>그날 입출금 내역</h2>
        {moves.length === 0 && <p className="empty">입출금이 없었습니다.</p>}
        {moves.map((l) => (
          <div key={l.account.id} className="cash-moves">
            <div className="cm-head">{l.account.group === "cash" ? `현금 · ${l.account.name}` : l.account.name}</div>
            {part.rows[l.account.id].map((r, i) => (
              <div key={i}>
                {r.inAmt !== 0 || r.inWho || r.inMemo ? (
                  <div className="cm-line">
                    <span>
                      {r.inWho || "입금"}
                      {r.inMemo && <small> · {r.inMemo}</small>}
                    </span>
                    <b className="in">+{money(r.inAmt, l.currency, false)}</b>
                  </div>
                ) : null}
                {r.outAmt !== 0 || r.outWho || r.outMemo ? (
                  <div className="cm-line">
                    <span>
                      {r.outWho || "출금"}
                      {r.outMemo && <small> · {r.outMemo}</small>}
                    </span>
                    <b className="out">−{money(r.outAmt, l.currency, false)}</b>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </section>
      <p className="note center-note">
        전일 잔고 = {sum.openFrom ? `${shortLabel(sum.openFrom)} 마감 잔고` : "처음 넣은 값"} · 원화 기준, 외화는 보고일 환율 환산 · 퇴직급여 예치금 제외
        {meta ? ` · 입력 ${meta.by} ${when(meta.at)}` : ""}
      </p>
    </>
  );
}
