/* ============================================================
   맨 위 달력 — 날짜가 좌우로 이어진 띠. 손가락으로 밀어 넘기고, 날짜를 누르면 그날 보고
   - 위의 '2026년 10월 ▾' 를 누르면 몇 년 몇 월로 바로 이동
   - 점: 카페·키즈 자료 모두 받음(●) · 하나만 받음(◐) · 없음(빈칸)
   - 일요일·공휴일은 빨강, 토요일은 파랑. 오늘 뒤 날짜는 누를 수 없음
   ============================================================ */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, dayRange, holidayName, weekday, WEEKDAY_KO } from "@report/core";

const CELL = 52;

export interface StripProps {
  /** 띠의 첫날 · 마지막 날 */
  from: string;
  to: string;
  selected: string;
  /** 날짜 → 자료가 온 POS */
  present: Map<string, Set<string>>;
  /** 자료가 있는 가장 늦은 날 (최근 버튼) */
  latest: string | null;
  onSelect: (date: string) => void;
  onSettings: () => void;
}

export function CalendarStrip({ from, to, selected, present, latest, onSelect, onSettings }: StripProps) {
  const days = useMemo(() => dayRange(from, to), [from, to]);
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(selected.slice(0, 7));
  const [picker, setPicker] = useState(false);
  const first = useRef(true);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // 고른 날을 가운데로 (처음에는 바로, 그다음은 부드럽게). 양 끝에 반 화면 여백이 있어 첫날·마지막 날도 가운데로 옴
  useLayoutEffect(() => {
    const el = ref.current;
    const i = days.indexOf(selected);
    if (!el || i < 0) return;
    el.scrollTo({ left: i * CELL, behavior: first.current ? "auto" : "smooth" });
    first.current = false;
    setShown(selected.slice(0, 7));
  }, [selected, days]);

  // 밀어 넘길 때: 고른 날이 보이면 그 달, 안 보이면 가운데 날짜의 달을 위에 보여 줌
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const half = el.clientWidth / 2;
        const si = days.indexOf(selectedRef.current);
        const selX = si * CELL - el.scrollLeft; // 가운데에서 떨어진 거리
        if (si >= 0 && Math.abs(selX) < half - CELL / 2) {
          setShown(selectedRef.current.slice(0, 7));
          return;
        }
        const i = Math.round(el.scrollLeft / CELL);
        const d = days[Math.max(0, Math.min(days.length - 1, i))];
        if (d) setShown(d.slice(0, 7));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [days]);

  const [y, m] = shown.split("-").map(Number);

  return (
    <div className="strip-wrap">
      <div className="strip-head">
        <button className="month-btn" onClick={() => setPicker(true)} aria-haspopup="dialog">
          {y}년 {m}월 <span aria-hidden>▾</span>
        </button>
        <div className="row">
          {latest && selected !== latest && (
            <button className="chip" onClick={() => onSelect(latest)}>
              최근 마감
            </button>
          )}
          <button className="icon-btn" onClick={onSettings} aria-label="설정">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <path
                d="M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="strip" ref={ref} role="listbox" aria-label="날짜">
        <span className="strip-pad" aria-hidden />
        {days.map((d) => {
          const w = weekday(d);
          const hol = holidayName(d);
          const p = present.get(d);
          // 꽉 찬 점 = 카페 · 키즈 · 네이버 모두 입력, 빈 점 = 일부만
          const both = p?.has("cafe") && p?.has("kids") && p?.has("naver");
          const day = Number(d.slice(8));
          const cls = ["day", d === selected ? "sel" : "", w === 0 || hol ? "sun" : w === 6 ? "sat" : ""].join(" ");
          return (
            <button key={d} className={cls} role="option" aria-selected={d === selected} aria-label={`${d}${hol ? ` ${hol}` : ""}`} onClick={() => onSelect(d)}>
              <span className="mon">{day === 1 ? `${Number(d.slice(5, 7))}월` : ""}</span>
              <span className="wd">{WEEKDAY_KO[w]}</span>
              <span className="dn">{day}</span>
              <span className={`dot ${both ? "full" : p ? "half" : ""}`} aria-hidden />
            </button>
          );
        })}
        <span className="strip-pad" aria-hidden />
      </div>
      {picker && <MonthPicker current={shown} from={from} to={to} present={present} onClose={() => setPicker(false)} onPick={(d) => (setPicker(false), onSelect(d))} />}
    </div>
  );
}

/** 몇 년 몇 월로 바로 — 고른 달에서 자료가 있는 마지막 날(없으면 1일)로 */
function MonthPicker({ current, from, to, present, onClose, onPick }: { current: string; from: string; to: string; present: Map<string, Set<string>>; onClose: () => void; onPick: (d: string) => void }) {
  const [year, setYear] = useState(Number(current.slice(0, 4)));
  const minY = Number(from.slice(0, 4));
  const maxY = Number(to.slice(0, 4));
  const pick = (mo: number) => {
    const mm = `${year}-${String(mo).padStart(2, "0")}`;
    const inMonth = dayRange(`${mm}-01`, addDays(`${mo === 12 ? year + 1 : year}-${String((mo % 12) + 1).padStart(2, "0")}-01`, -1)).filter((d) => d >= from && d <= to);
    const withData = inMonth.filter((d) => present.has(d));
    onPick(withData[withData.length - 1] || inMonth[0]);
  };
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="년 월 고르기" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <button className="icon-btn" disabled={year <= minY} onClick={() => setYear(year - 1)} aria-label="이전 해">
            ‹
          </button>
          <b>{year}년</b>
          <button className="icon-btn" disabled={year >= maxY} onClick={() => setYear(year + 1)} aria-label="다음 해">
            ›
          </button>
        </div>
        <div className="months">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => {
            const mm = `${year}-${String(mo).padStart(2, "0")}`;
            const off = `${mm}-31` < from || `${mm}-01` > to;
            return (
              <button key={mo} className={mm === current ? "on" : ""} disabled={off} onClick={() => pick(mo)}>
                {mo}월
              </button>
            );
          })}
        </div>
        <button className="ghost wide" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
