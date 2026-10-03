/* 설정 — 최근 입력 현황(누가 언제) · 자료 받기 · 계산 기준 · 폰 설치 방법 */
import { addDays, KIDS_PRICES, shortLabel, VISITOR_FACTOR, won, type Board, type PartMeta } from "@report/core";
import type { OfficeStatus } from "../data/source";

const time = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

function Who({ m, has }: { m?: PartMeta; has: boolean }) {
  if (!has) return <span className="muted">—</span>;
  return (
    <span>
      ✓<div className="note">{m ? `${m.by || ""} ${time(m.at)}` : ""}</div>
    </span>
  );
}

export function Settings(props: { board: Board; status: OfficeStatus | null; source: "cloud" | "demo"; latest: string | null; syncedAt: string | null; syncing: boolean; onSync: () => void; onReload: () => void; onBack: () => void }) {
  const price = KIDS_PRICES[KIDS_PRICES.length - 1];
  const end = props.latest || addDays(new Date().toISOString().slice(0, 10), -1);
  const recent = Array.from({ length: 7 }, (_, i) => addDays(end, -i));
  return (
    <>
      <header className="detail-head">
        <button className="icon-btn" onClick={props.onBack} aria-label="뒤로">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1>설정</h1>
        <span />
      </header>
      <main className="content">
        <section className="card">
          <h2>최근 입력 현황</h2>
          <p className="sub">사무실에서 A(입력 화면)로 넣은 것 — 이름 · 시각</p>
          <table>
            <thead>
              <tr>
                <th>마감일</th>
                <th>카페</th>
                <th>키즈</th>
                <th>네이버</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((d) => {
                const r = props.board.report(d);
                return (
                  <tr key={d}>
                    <td>{shortLabel(d)}</td>
                    <td>
                      <Who m={r?.meta?.cafe} has={!!r?.cafe} />
                    </td>
                    <td>
                      <Who m={r?.meta?.kids} has={!!r?.kids} />
                    </td>
                    <td>
                      <Who m={r?.meta?.naver} has={!!r?.naver} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>자료 받기</h2>
          {props.source === "demo" ? (
            <p className="note">체험판입니다. 숫자는 모두 가짜 자료입니다 (날씨는 기상청 실제 값).</p>
          ) : (
            <div className="row">
              <button onClick={props.onSync} disabled={props.syncing}>
                {props.syncing ? "확인 중…" : "새 자료 확인"}
              </button>
              <button className="ghost" onClick={props.onReload} disabled={props.syncing}>
                처음부터 다시 받기
              </button>
            </div>
          )}
          <p className="note">
            마지막 확인 {time(props.syncedAt)}
          </p>
        </section>

        <section className="card">
          <h2>계산 기준</h2>
          <table>
            <tbody>
              <tr>
                <td>키즈 입장료 단가</td>
                <td className="num">
                  평일 {won(price.weekday)}
                  <div className="note">토·일·공휴일·대체공휴일 {won(price.holiday)}</div>
                </td>
              </tr>
              <tr>
                <td>키즈 입장료</td>
                <td className="num">
                  (네이버 + 현장 입장권) × 단가
                  <div className="note">26년 3월까지는 카페 교환권 방식이라 키즈 매출 없음 · 인원만</div>
                </td>
              </tr>
              <tr>
                <td>네이버 입장권</td>
                <td className="num">
                  A 에 넣은 시간대별 판매 입장권 합
                  <div className="note">넣기 전에는 키즈 POS 입장 발행 − 현장으로 추정</div>
                </td>
              </tr>
              <tr>
                <td>팀</td>
                <td className="num">같은 포스번호 + 같은 영수증번호</td>
              </tr>
              <tr>
                <td>카페아스타나 방문인원</td>
                <td className="num">음료·맥주 잔 수 × {VISITOR_FACTOR}</td>
              </tr>
              <tr>
                <td>1인 평균소비</td>
                <td className="num">총 매출 ÷ 방문인원</td>
              </tr>
              <tr>
                <td>반품</td>
                <td className="num">앞서 판 영수증에서 찾아 지움</td>
              </tr>
              <tr>
                <td>상품권·교환권 결제</td>
                <td className="num">결제 수단 — 매출에서 빼지 않음</td>
              </tr>
              <tr>
                <td>기타</td>
                <td className="num">카페 기타 + 키즈 입장권 외 (추가 인원 등)</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>폰에 설치하기</h2>
          <ul className="steps">
            <li>
              <b>아이폰</b>: 받은 주소를 Safari 로 열기 → 아래 공유 버튼 → <b>홈 화면에 추가</b>
            </li>
            <li>
              <b>안드로이드</b>: Chrome 으로 열기 → 오른쪽 위 ⋮ → <b>앱 설치</b> (또는 홈 화면에 추가)
            </li>
            <li>로그인은 없습니다. 이 주소로 설치한 폰은 누구나 볼 수 있으니 주소를 회사 밖에 보내지 마세요.</li>
            <li>받은 자료는 폰에 저장되어 인터넷이 없어도 지난 보고를 볼 수 있습니다.</li>
          </ul>
        </section>
      </main>
    </>
  );
}
