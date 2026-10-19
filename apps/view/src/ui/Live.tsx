/* 오늘 마감 전 영업정보 — 오늘(현재일)은 다음 날 확정
   - 고른 날이 오늘(마감 전)이면 날짜 띠 오른쪽 빈자리(마지막 날 뒤)에 다섯 줄 안내 — 글자 크기 같게, 줄 바꿈 · 잘림 없이
   - 다음 날 아침 확정 전에는 어제가 마지막 날 — 같은 자리에 '확정 전 정보'
   - 하루가 다 안 끝난(또는 확정 전) 숫자를 작년 · 지난주 하루 전체와 견주면 틀린 비교라, 이때 비교(▲▼)는 숨김
   - 문제(네이버 빠짐 · 오래 안 옴 · 확인 필요)가 있을 때만 맨 위에 경고 */
import { createContext, useContext, useRef } from "react";
import { LIVE_STALE_MIN, REPORT_OPEN_HOUR, type LiveKind } from "@report/core";
import { useFit } from "./fit";

export interface LiveState {
  /** 고른 날이 오늘이라 마감 전 */
  today: boolean;
  /** 마감 전 숫자가 들어간 칸 (확정 전) */
  provisional: LiveKind[];
  /** 오늘인데 네이버 숫자가 아직 없음 → 키즈 입장료에 네이버가 빠짐 */
  naverMissing?: boolean;
  at: string | null;
  stale: boolean;
  problems: string[];
}

export const LiveCtx = createContext<LiveState | null>(null);
export const useLive = () => useContext(LiveCtx);
/** 비교(▲▼)를 숨길지 — 오늘(마감 전)이거나 아직 확정 전인 날 */
export const useNoCompare = () => !!useLive();

/** 받은 시각 → "14시 57분" (한국 시각) */
export function hourMin(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${t.getUTCHours()}시 ${String(t.getUTCMinutes()).padStart(2, "0")}분`;
}

/** 날짜 띠 오른쪽 다섯 줄 — 마지막 날(오늘 · 확정 전 어제)을 골랐을 때만 */
export function LiveNote() {
  const l = useLive();
  const ref = useRef<HTMLDivElement>(null);
  // 확정 전 어제인데 마감 전 숫자가 아닌(아침 확정 수집이 이미 온) 경우는 받은 시각 없이
  const first = l?.today
    ? `${l.at ? `${hourMin(l.at)} 기준` : "아직 받기 전"}, 마감 전 정보`
    : l?.at && l.provisional.length
      ? `${hourMin(l.at)} 기준, 확정 전 정보`
      : `확정 전 정보 (아침 ${REPORT_OPEN_HOUR}시 확정)`;
  useFit(ref, [first], { height: true });
  if (!l) return null;
  return (
    <div className="strip-note" ref={ref} role="note">
      <div data-fit className="sn-first">
        {first}
      </div>
      <div data-fit>카페,키즈 영수 정보는</div>
      <div data-fit>15분마다(매시 0·15·30·45분) 받습니다.</div>
      <div data-fit>자판기, 주차, 네컷, 현금은</div>
      <div data-fit>다음(근무일)날 포함 됩니다.</div>
    </div>
  );
}

/** 문제가 있을 때만 — 네이버 빠짐 · 오래 안 옴 · 확인 필요 */
export function LiveWarn() {
  const l = useLive();
  if (!l || !(l.naverMissing || l.stale || l.problems.length)) return null;
  return (
    <div className="live-banner" role="alert">
      {l.naverMissing && <div className="live-warn">⚠ 네이버 예약 숫자를 아직 받지 못해 키즈 입장료에 네이버가 빠져 있습니다</div>}
      {l.stale && <div className="live-warn">⚠ {LIVE_STALE_MIN}분 넘게 새 숫자가 오지 않았습니다 (POS 메인 PC 가 켜져 있는지 확인)</div>}
      {l.problems.map((p) => (
        <div key={p} className="live-warn">
          ⚠ 확인 필요 (보이지 않게 뺌) — {p}
        </div>
      ))}
    </div>
  );
}
