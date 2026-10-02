/* 설정 — POS 송부 상태 · 계산 기준 · 폰 설치 방법 */
import { KIDS_PRICES, posStatus, POS_IDS, POS_LABEL, shortLabel, VISITOR_FACTOR, won, type DayBatch } from "@report/core";
import type { DeviceStatus } from "../data/firebase";

const time = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function Settings(props: { batches: DayBatch[]; devices: DeviceStatus[]; demo: boolean; syncedAt: string | null; syncing: boolean; onSync: () => void; onReload: () => void; onBack: () => void }) {
  const st = posStatus(props.batches);
  const price = KIDS_PRICES[KIDS_PRICES.length - 1];
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
          <h2>POS 마감 송부</h2>
          <table>
            <tbody>
              {POS_IDS.map((pos) => {
                const s = st.find((x) => x.pos === pos)!;
                const d = props.devices.find((x) => x.pos === pos);
                return (
                  <tr key={pos}>
                    <td>
                      <b>{POS_LABEL[pos]} POS</b>
                      <div className="note">{d?.source || "아직 연결 기록 없음"}</div>
                      {d?.lastError && <div className="note bad">⚠ {d.lastError}</div>}
                      {!!d?.pending && <div className="note bad">⚠ PC 에 못 보낸 날 {d.pending}일</div>}
                    </td>
                    <td className="num">
                      {s.lastDate ? shortLabel(s.lastDate) : "자료 없음"}
                      <div className="note">보낸 시각 {time(s.lastSentAt)}</div>
                      <div className="note">받은 날 {s.days.toLocaleString("ko-KR")}일</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {props.demo ? (
            <p className="note">체험판입니다. 숫자는 모두 가짜 자료이고, 네이버 입장권을 고친 값은 이 폰에만 저장됩니다.</p>
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
          <p className="note">마지막 확인 {time(props.syncedAt)}</p>
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
                <td className="num">(네이버 + 현장 입장권) × 단가</td>
              </tr>
              <tr>
                <td>네이버 입장권</td>
                <td className="num">키즈 POS 0원 입장권 수 (고친 값 우선)</td>
              </tr>
              <tr>
                <td>추정 방문자</td>
                <td className="num">음료·맥주 잔 수 × {VISITOR_FACTOR}</td>
              </tr>
              <tr>
                <td>1인 평균 소비</td>
                <td className="num">총 매출 ÷ 추정 방문자</td>
              </tr>
              <tr>
                <td>기타</td>
                <td className="num">카페 기타 + 키즈 POS 입장권 외 (추가 인원·간식 등)</td>
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
