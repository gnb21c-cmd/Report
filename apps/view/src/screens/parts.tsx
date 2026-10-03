/* 상세 화면 공통 — 머리(뒤로 · 제목 · 날짜 넘기기) · 칸 고르기 */
import type { ReactNode } from "react";
import { addDays, shortLabel } from "@report/core";

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} role="tab" aria-selected={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export interface Nav {
  date: string;
  minDate: string;
  maxDate: string;
  onDate: (d: string) => void;
  onBack: () => void;
}

export function DetailHeader({ title, date, onBack, onDate, minDate, maxDate }: { title: string } & Nav) {
  return (
    <header className="detail-head">
      <button className="icon-btn" onClick={onBack} aria-label="뒤로">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <h1>{title}</h1>
      <div className="detail-date">
        <button className="icon-btn" disabled={date <= minDate} onClick={() => onDate(addDays(date, -1))} aria-label="전날">
          ‹
        </button>
        <span>{shortLabel(date)}</span>
        <button className="icon-btn" disabled={date >= maxDate} onClick={() => onDate(addDays(date, 1))} aria-label="다음날">
          ›
        </button>
      </div>
    </header>
  );
}

/** 숫자 칸 하나 (이름 · 값 · 아래 한 줄) */
export function Stat({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note != null && <span className="note">{note}</span>}
    </div>
  );
}

export const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 그 달의 마지막 날 (n 달 옮긴) */
function monthEnd(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m + n, 0)).toISOString().slice(0, 10);
}

/** 달 단위로 움직이는 머리 (당월누계 · 올해누계) — ‹ › 한 달씩. 고른 날 = 그 달 마지막 날 (마감일이 든 달은 마감일) */
export function MonthHeader({ title, date, onBack, onDate, minDate, maxDate }: { title: string } & Nav) {
  const go = (n: number) => {
    const d = monthEnd(date, n);
    onDate(d > maxDate ? maxDate : d);
  };
  return (
    <header className="detail-head">
      <button className="icon-btn" onClick={onBack} aria-label="뒤로">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <h1>{title}</h1>
      <div className="detail-date">
        <button className="icon-btn" disabled={monthEnd(date, -1) < minDate} onClick={() => go(-1)} aria-label="지난달">
          ‹
        </button>
        <span>
          {date.slice(0, 4)}년 {Number(date.slice(5, 7))}월
        </span>
        <button className="icon-btn" disabled={date.slice(0, 7) >= maxDate.slice(0, 7)} onClick={() => go(1)} aria-label="다음 달">
          ›
        </button>
      </div>
    </header>
  );
}
