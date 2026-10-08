/* 오늘 마감 전 영업정보 — 오늘(현재일)은 다음 날 확정
   - 고른 날이 오늘이고 마감 전 숫자가 있으면 맨 위에 "마감 전 영업정보 · HH:MM 기준" (매시 15분 · 45분에 POS 메인 PC 가 받음)
   - 다음 날 아침 10시(확정) 전에는 어제가 "확정 전" — 작은 글만
   - 하루가 다 안 끝난(또는 확정 전) 숫자를 작년 · 지난주 하루 전체와 견주면 틀린 비교라, 이때 비교(▲▼)는 숨김 */
import { createContext, useContext } from "react";
import { LIVE_LABEL, LIVE_FROM, LIVE_STALE_MIN } from "@report/core";

export interface LiveState {
  /** 고른 날이 오늘이라 마감 전 */
  today: boolean;
  /** 마감 전 숫자가 들어간 칸 (확정 전) */
  provisional: ("cafe" | "kids")[];
  at: string | null;
  stale: boolean;
  problems: string[];
}

export const LiveCtx = createContext<LiveState | null>(null);
export const useLive = () => useContext(LiveCtx);
/** 비교(▲▼)를 숨길지 — 오늘(마감 전)이거나 아직 확정 전인 날 */
export const useNoCompare = () => !!useLive();

const hm = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
const KIND: Record<string, string> = { cafe: "카페", kids: "키즈" };

export function LiveBanner() {
  const l = useLive();
  if (!l) return null;
  return (
    <div className={`live-banner${l.today ? "" : " past"}`} role="status">
      {l.today ? (
        <>
          <div className="live-title">
            <span className="live-dot" aria-hidden /> {LIVE_LABEL}
            {l.at && <span className="live-at"> · {hm(l.at)} 기준</span>}
          </div>
          <div className="live-sub">카페 · 키즈 POS 영수증만 매시 15분 · 45분에 받습니다. 자판기 · 네컷 · 주차 · 네이버 · 현금은 다음 날 아침 확정 때 들어옵니다.</div>
          <div className="live-sub">하루가 끝나지 않은 숫자라 작년 · 지난주 비교는 숨기고, 누계는 어제까지입니다.</div>
          {!l.provisional.length && !l.problems.length && <div className="live-sub">아직 받은 숫자가 없습니다 (첫 수집 {LIVE_FROM}).</div>}
        </>
      ) : (
        <div className="live-sub">
          확정 전 숫자 — 아침 10시에 확정됩니다{l.provisional.length > 0 && ` (마감 전 칸: ${l.provisional.map((k) => KIND[k]).join(" · ")})`}. 비교는 확정 뒤에 보입니다.
        </div>
      )}
      {l.stale && <div className="live-warn">⚠ {LIVE_STALE_MIN}분 넘게 새 숫자가 오지 않았습니다 (POS 메인 PC 가 켜져 있는지 확인)</div>}
      {l.problems.map((p) => (
        <div key={p} className="live-warn">
          ⚠ 확인 필요 (보이지 않게 뺌) — {p}
        </div>
      ))}
    </div>
  );
}
