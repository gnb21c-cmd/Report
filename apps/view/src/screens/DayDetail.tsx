/* ============================================================
   마감일 비교 — 홈의 '마감일 총 매출' 상자를 누르면
   마감일 ↔ 작년 같은 주 · 같은 요일 (364일 전)
   ① 두 날 총 매출 + 날씨
   ② 섹터별 · 방문인원 · 객단가 · 키즈 입장 비교 표
   ③ 시간대별 총 매출 막대 (회색 = 작년 · 빨강 = 마감일)
   ============================================================ */
import { changePct, count, dayHourly, hourLabel, HOURS, lyDay, pct, shortLabel, BOXES, won, wonShort, type Board, type WeatherMap } from "@report/core";
import { BarChart } from "../charts/BarChart";
import { ChartCard, Legend } from "../charts/common";
import { HeroBox } from "../ui/WeatherPanel";
import { BOX_LABEL, Delta } from "./Home";
import { DetailHeader, md, type Nav } from "./parts";

const LY = "var(--ly)";
const CUR = "var(--cur)";
const xs = HOURS.map(String);
const xTick = (i: number) => (i % 2 === 0 ? hourLabel(HOURS[i]) : null);
/** 표 안 금액 — 좁은 폰에서도 다섯 칸이 들어가게 '원' 없이 (제목에 단위) */
const num = (v: number) => v.toLocaleString("ko-KR");
const tip = (i: number) => `${HOURS[i]}시 ~ ${HOURS[i] + 1}시`;

function Row({ label, now, before, ok, fmt }: { label: string; now: number | null; before: number | null; ok: boolean; fmt: (v: number) => string }) {
  const p = ok ? changePct(now, before) : null;
  const d = now != null && before != null ? now - before : null;
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{now == null ? "—" : fmt(now)}</td>
      <td className="num">{!ok ? "자료 없음" : before == null ? "—" : fmt(before)}</td>
      <td className={`num ${ok && d != null && d > 0 ? "up-text" : ok && d != null && d < 0 ? "down-text" : ""}`}>{ok && d != null ? `${d > 0 ? "+" : ""}${fmt(d)}` : "—"}</td>
      <td className={`num ${p != null && p > 0 ? "up-text" : p != null && p < 0 ? "down-text" : ""}`}>{p == null ? "—" : pct(p)}</td>
    </tr>
  );
}

function HourTable({ a, b }: { a: number[] | null; b: number[] | null }) {
  return (
    <table>
      <thead>
        <tr>
          <th>시간</th>
          <th className="num">작년</th>
          <th className="num">마감일</th>
        </tr>
      </thead>
      <tbody>
        {HOURS.map((h, i) => (
          <tr key={h}>
            <td>{tip(i)}</td>
            <td className="num">{a ? won(a[i]) : "—"}</td>
            <td className="num">{b ? won(b[i]) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DayDetail(props: { board: Board; weather: WeatherMap } & Nav) {
  const { board, date, weather } = props;
  const ly = lyDay(date);
  const day = board.day(date);
  const last = board.day(ly);
  const ok = last.has.cafe + last.has.kids > 0;
  const has = day.has.cafe + day.has.kids > 0;
  const hNow = dayHourly(board, date);
  const hLy = dayHourly(board, ly);
  const none = HOURS.map(() => null);

  return (
    <>
      <DetailHeader title="마감일 비교" {...props} />
      <main className="content">
        {!has && <div className="banner">{shortLabel(date)} 자료가 없습니다.</div>}
        <HeroBox label={<>마감일 · {shortLabel(date)}</>} value={has ? won(day.total) : "—"} date={date} w={weather[date]}>
          <Delta now={has ? day.total : null} before={ok ? last.total : null} label={`작년 ${md(ly)}`} missing={`작년 ${md(ly)} 자료 없음`} />
        </HeroBox>
        <HeroBox label={<>작년 같은 요일 · {shortLabel(ly)}</>} value={ok ? won(last.total) : "자료 없음"} date={ly} w={weather[ly]}>
          <span className="delta muted">364일 전 = 같은 주 · 같은 요일</span>
        </HeroBox>

        <section className="card">
          <h2>
            항목별 비교 <small className="muted">금액 단위 원</small>
          </h2>
          <table className="day-cmp">
            <thead>
              <tr>
                <th />
                <th className="num">마감일</th>
                <th className="num">작년</th>
                <th className="num">증감</th>
                <th className="num">증감률</th>
              </tr>
            </thead>
            <tbody>
              <Row label="총 매출" now={day.total} before={last.total} ok={ok} fmt={num} />
              {BOXES.map((b) => (
                <Row key={b} label={BOX_LABEL[b]} now={day.box[b]} before={last.box[b]} ok={ok} fmt={num} />
              ))}
              <Row label="방문인원" now={day.visitors} before={last.visitors} ok={ok} fmt={(v) => count(v, "명")} />
              <Row label="객단가" now={day.avgSpend} before={last.avgSpend} ok={ok && last.avgSpend != null} fmt={num} />
              <Row label="네이버 입장" now={day.naver} before={last.naver} ok={ok} fmt={(v) => count(v, "장")} />
              <Row label="현장 입장" now={day.walkIn} before={last.walkIn} ok={ok} fmt={(v) => count(v, "장")} />
              <Row label="이벤트 무료" now={day.eventFree} before={last.eventFree} ok={ok} fmt={(v) => count(v, "장")} />
            </tbody>
          </table>
        </section>

        <ChartCard
          title={`시간대별 총 매출 · ${shortLabel(date)}`}
          sub={`회색 = 작년 ${md(ly)} · 빨강 = 마감일 ${md(date)}`}
          legend={<Legend items={[{ label: `작년 ${md(ly)}`, color: LY, key: "rect" }, { label: `마감일 ${md(date)}`, color: CUR, key: "rect" }]} />}
          table={<HourTable a={hLy} b={hNow} />}
        >
          {!hNow && !hLy ? (
            <p className="empty">두 날 모두 시간대 자료(영수증별 엑셀)가 없습니다.</p>
          ) : (
            <BarChart
              xs={xs}
              series={[
                { label: `작년 ${md(ly)}`, color: LY, values: hLy || none },
                { label: `마감일 ${md(date)}`, color: CUR, values: hNow || none },
              ]}
              xTick={xTick}
              tipTitle={tip}
              fmt={won}
              axisFmt={wonShort}
              label="시간대별 총 매출 비교"
            />
          )}
        </ChartCard>
        {(!hNow || !hLy) && (hNow || hLy) && <p className="note center-note">{!hNow ? "마감일" : `작년 ${md(ly)}`} 시간대 자료가 없어 한쪽만 보입니다.</p>}
      </main>
    </>
  );
}
