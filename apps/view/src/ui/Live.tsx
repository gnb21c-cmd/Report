/* 마감 전 영업정보 — 오늘(현재일)은 다음 날 확정
   - 고른 날이 오늘이고 마감 전 숫자가 있으면 맨 위에 "마감 전 영업정보 · HH:MM 기준"
   - 다음 날이 되면 그 글자는 사라지고, 확정 수집(아침 09시대) 전이면 "확정 수집 전" 작은 글만
   - 하루가 다 안 끝난 숫자를 작년 · 지난주 하루 전체와 견주면 틀린 비교라, 이때 비교(▲▼)는 숨김 */
import { createContext, useContext } from "react";
import { LIVE_LABEL } from "@report/core";

export interface LiveState {
  /** 고른 날이 오늘이라 마감 전 */
  today: boolean;
  /** 마감 전 숫자가 들어간 칸 (확정 전) */
  provisional: ("cafe" | "kids" | "naver")[];
  at: string | null;
  stale: boolean;
  problems: string[];
  /** 통합데스크 현장 장수 · POS 현장 장수 (다르면 알림) */
  onsite?: { desk: number; pos: number } | null;
}

export const LiveCtx = createContext<LiveState | null>(null);
export const useLive = () => useContext(LiveCtx);
/** 비교(▲▼)를 숨길지 — 오늘이거나 확정 전 칸이 있으면 */
export const useNoCompare = () => {
  const l = useLive();
  return !!l && (l.today || l.provisional.length > 0);
};

const hm = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
const KIND: Record<string, string> = { cafe: "카페", kids: "키즈", naver: "네이버(통합데스크)" };

export function LiveBanner() {
  const l = useLive();
  if (!l || (!l.today && !l.provisional.length && !l.problems.length)) return null;
  return (
    <div className={`live-banner${l.today ? "" : " past"}`} role="status">
      {l.today ? (
        <div className="live-title">
          <span className="live-dot" aria-hidden /> {LIVE_LABEL}
          {l.at && <span className="live-at"> · {hm(l.at)} 기준</span>}
        </div>
      ) : (
        l.provisional.length > 0 && (
          <div className="live-sub">확정 수집 전 숫자 — 아침 09시대 확정 수집 뒤 바뀝니다</div>
        )
      )}
      {l.today && (
        <div className="live-sub">
          하루가 끝나지 않은 숫자입니다. 작년 · 지난주 비교는 마감(다음 날) 뒤에 보입니다.
        </div>
      )}
      {l.today && !l.provisional.length && !l.problems.length && (
        <div className="live-sub">아직 받은 숫자가 없습니다.</div>
      )}
      {l.provisional.length > 0 && (
        <div className="live-sub">마감 전 칸: {l.provisional.map((k) => KIND[k]).join(" · ")}</div>
      )}
      {l.stale && l.today && (
        <div className="live-warn">⚠ 30분 넘게 새 숫자가 오지 않았습니다 (POS 전송기 · 통합데스크 확인)</div>
      )}
      {l.onsite && l.onsite.desk !== l.onsite.pos && (
        <div className="live-warn">
          ⚠ 현장 구매 장수가 다릅니다 — 통합데스크 {l.onsite.desk}장 · POS {l.onsite.pos}장
        </div>
      )}
      {l.problems.map((p) => (
        <div key={p} className="live-warn">
          ⚠ 확인 필요 (보이지 않게 뺌) — {p}
        </div>
      ))}
    </div>
  );
}
