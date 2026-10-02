/* 설정 — POS 송부 상태 · 내 계정 · 앱 설치 안내 */
import { posStatus, POS_IDS, POS_LABEL, shortLabel, type DayBatch } from "@report/core";
import type { DeviceStatus } from "../data/firebase";

const time = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function Status(props: {
  batches: DayBatch[];
  devices: DeviceStatus[];
  email: string | null;
  demo: boolean;
  syncedAt: string | null;
  onSync: () => void;
  onReload: () => void;
  onSignOut: () => void;
}) {
  const st = posStatus(props.batches);
  return (
    <>
      <section className="card">
        <h2>POS 송부 상태</h2>
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
      </section>

      <section className="card">
        <h2>자료</h2>
        <p className="sub">마지막 확인 {time(props.syncedAt)}</p>
        {!props.demo && (
          <div className="row">
            <button onClick={props.onSync}>새 자료 확인</button>
            <button className="ghost" onClick={props.onReload}>
              처음부터 다시 받기
            </button>
          </div>
        )}
        {props.demo && <p className="note">체험판입니다. 숫자는 모두 가짜 자료입니다.</p>}
      </section>

      <section className="card">
        <h2>폰에 설치하기</h2>
        <ul className="steps">
          <li>
            <b>아이폰</b>: Safari 로 이 주소 열기 → 아래 공유 버튼 → <b>홈 화면에 추가</b>
          </li>
          <li>
            <b>안드로이드</b>: Chrome 으로 열기 → 오른쪽 위 ⋮ → <b>앱 설치</b> (또는 홈 화면에 추가)
          </li>
          <li>설치하면 앱처럼 열리고, 받은 자료는 폰에 저장되어 인터넷이 없어도 지난 보고를 볼 수 있습니다.</li>
        </ul>
      </section>

      {!props.demo && (
        <section className="card">
          <h2>내 계정</h2>
          <p className="sub">{props.email}</p>
          <button className="ghost" onClick={props.onSignOut}>
            로그아웃 (폰에 저장된 자료도 지움)
          </button>
        </section>
      )}
    </>
  );
}
