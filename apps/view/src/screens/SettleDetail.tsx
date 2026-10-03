/* ============================================================
   OO년 (현금/신용) 정산완료 합계 — 1월 1일 ~ 마감일 통장에 들어온 매출 정산금 (사무실 A 의 자금 보고에서)
   - 종류별: 카드 · 네이버페이 · 배달앱 · 현금매출 (금액 · 비율)
   - 달마다 표
   - 무엇을 넣고 무엇을 빼는지 설명 (core cash.ts isSettlement)
   ============================================================ */
import { SETTLE_LABEL, settlements, won, type CashPart, type SettleKind } from "@report/core";
import { span } from "./Home";
import { DetailHeader, type Nav } from "./parts";

const KINDS = Object.keys(SETTLE_LABEL) as SettleKind[];
/** 만 원 단위 숫자 (표) */
const man = (v: number) => Math.round(v / 1e4).toLocaleString("ko-KR");
const pct = (v: number, t: number) => (t > 0 ? `${((v / t) * 100).toFixed(1)}%` : "—");

export function SettleDetail({ cashParts, ...nav }: { cashParts: CashPart[] } & Nav) {
  const { date } = nav;
  const y = date.slice(0, 4);
  const from = `${y}-01-01`;
  const s = settlements(cashParts, from, date);
  const months = Array.from({ length: Number(date.slice(5, 7)) }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    const last = new Date(Date.UTC(Number(y), i + 1, 0)).toISOString().slice(0, 10);
    return { m: i + 1, ...settlements(cashParts, `${y}-${m}-01`, last < date ? last : date) };
  });
  return (
    <>
      <DetailHeader title={`${y.slice(2)}년 정산완료 합계`} {...nav} />
      <main className="content">
        <section className="card settle-hero">
          <div className="stat-label">({span(from, date, true)})</div>
          <div className="sh-value">{s.days ? won(s.total) : "—"}</div>
          <span className="note">자금 보고 {s.days}일에서 셈</span>
        </section>

        <section className="card">
          <h2>종류별</h2>
          <table>
            <thead>
              <tr>
                <th />
                <th className="num">금액</th>
                <th className="num">비율</th>
              </tr>
            </thead>
            <tbody>
              {KINDS.map((k) => (
                <tr key={k}>
                  <td>{SETTLE_LABEL[k]}</td>
                  <td className="num">{won(s.by[k])}</td>
                  <td className="num">{pct(s.by[k], s.total)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>합계</b>
                </td>
                <td className="num">
                  <b>{won(s.total)}</b>
                </td>
                <td className="num">100%</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>달마다</h2>
          <div className="table-scroll">
            <table className="settle-month">
              <thead>
                <tr>
                  <th />
                  {KINDS.map((k) => (
                    <th key={k} className="num">
                      {SETTLE_LABEL[k] === "네이버페이" ? "네이버" : SETTLE_LABEL[k] === "현금매출" ? "현금" : SETTLE_LABEL[k]}
                    </th>
                  ))}
                  <th className="num">합계</th>
                </tr>
              </thead>
              <tbody>
                {months.map((x) => (
                  <tr key={x.m}>
                    <td>{x.m}월</td>
                    {KINDS.map((k) => (
                      <td key={k} className="num">
                        {x.days ? man(x.by[k]) : "—"}
                      </td>
                    ))}
                    <td className="num">{x.days ? man(x.total) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">금액 단위 만 원 · {Number(date.slice(5, 7))}월은 {Number(date.slice(8, 10))}일까지</p>
        </section>

        <section className="card">
          <h2>어떻게 세나요</h2>
          <ul className="plain">
            <li>
              <b>카드</b> — 통장에 '카드가맹점'으로 들어온 카드 대금 (카페 · 키즈 POS 카드 결제 + 자판기 · 인생네컷 · 주차정산기 카드 결제). 카드사 수수료가 빠진 금액이고, 결제한 날보다 1~4영업일 늦게 들어옵니다
            </li>
            <li>
              <b>네이버페이</b> — 네이버 예약(키즈 입장권 등) 정산금
            </li>
            <li>
              <b>배달앱</b> — 배달의민족 · 쿠팡이츠 · 요기요 정산금
            </li>
            <li>
              <b>현금매출</b> — 현금 계좌(금고)에 적요 '현금매출'로 넣은 돈
            </li>
            <li>계좌 사이 이체 · 임대료 · 지원금 · 이자 · 캐시백 · '(잔고 맞춤)' 줄은 매출 정산이 아니라 뺍니다</li>
            <li>입금이 늦게 들어오고 수수료가 빠진 돈이라 매출 합계와 날마다 딱 맞지는 않습니다 (연휴 · 주말 뒤에 한꺼번에 들어옴)</li>
          </ul>
        </section>
      </main>
    </>
  );
}
