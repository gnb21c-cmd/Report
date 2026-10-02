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
