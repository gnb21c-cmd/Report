/* ============================================================
   키즈 실시간 (2026-10-16 사장님) — 첫 화면 '입장권 판매 총 수량' 칸을 누르면
   키즈 POS 통합데스크가 1분마다 · 바뀌면 바로 클라우드 deskLive/now 에 올리는 지금 현황 (astanakiz docs/LIVE.md · docs/KIDS_LIVE.md)
   - 열 때 · 아래로 당겼다 놓을 때 · [새로고침] · 앱으로 돌아올 때 다시 읽음
   - 위에서 아래로: 기준 시각 → 오늘 입장(총 = 네이버 + 현장) → 열쇠 45칸 → 입장료 매출 → 네이버 예약(시간 칸) (열쇠를 오늘 입장 바로 밑으로 — 사장님 10/16)
   - 열쇠는 번호 · 색(반납 조건)만, 번호를 누르면 손님 이름 · 전화번호 그대로 (열쇠 미반납 때 관리자가 전화 — 사장님 지시)
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from "react";
import { count, deskLiveAgeMin, deskLiveSales, deskLiveSlotNow, DESK_LIVE_STALE_MIN, todayKst, won, type DeskHolder, type DeskLive } from "@report/core";
import { deskLiveNow } from "../data/firebase";

const KIND: Record<DeskHolder["kind"], string> = { n: "네이버", w: "현장", s: "서비스 키" };
const COLOR = { in: "이용 중", pink: "반납 시간 (10분 안)", red: "반납 시간 넘음" } as const;
const phoneText = (p: string) => (p.length === 11 ? `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}` : p || "—");
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 당겨서 새로고침 — 이만큼(px) 넘게 당겼다 놓으면 */
const PULL = 70;

export function KidsLive({ onBack }: { onBack: () => void }) {
  const [live, setLive] = useState<DeskLive | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none" | "bad" | "error">("loading");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pull, setPull] = useState(0);
  const [all, setAll] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await deskLiveNow();
      setLive(r.live);
      setState(r.live ? "ok" : r.bad ? "bad" : "none");
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState((s) => (s === "loading" ? "error" : s));
    } finally {
      setBusy(false);
      setNow(new Date());
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // 앱으로 돌아오면 다시 · '몇 분 전'은 30초마다
  useEffect(() => {
    const vis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", vis);
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      clearInterval(t);
    };
  }, [load]);
  // 아래로 당겨 새로고침 (맨 위에서 · 손님 창이 닫혀 있을 때)
  const y0 = useRef<number | null>(null);
  const dist = useRef(0);
  useEffect(() => {
    const start = (e: TouchEvent) => {
      y0.current = window.scrollY <= 0 && pick == null ? e.touches[0].clientY : null;
      dist.current = 0;
    };
    const move = (e: TouchEvent) => {
      if (y0.current == null) return;
      dist.current = Math.max(0, Math.min(110, e.touches[0].clientY - y0.current));
      setPull(dist.current);
    };
    const end = () => {
      if (y0.current == null) return;
      y0.current = null;
      if (dist.current > PULL) load();
      dist.current = 0;
      setPull(0);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
    };
  }, [load, pick]);

  const today = todayKst(now);
  const age = live ? deskLiveAgeMin(live, now) : 0;
  const pullText = busy ? "통합데스크 현황을 가져오는 중…" : pull > PULL ? "놓으면 새로고침" : "아래로 당기면 새로고침";

  return (
    <>
      <header className="detail-head">
        <button className="icon-btn" onClick={onBack} aria-label="뒤로">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1>키즈 실시간</h1>
        <button className="ghost small" onClick={load} disabled={busy}>
          {busy ? "받는 중" : "새로고침"}
        </button>
      </header>
      <div className={`klive-pull${busy || pull > 0 ? " on" : ""}`} style={pull > 0 ? { height: Math.min(56, pull) } : undefined} aria-live="polite">
        {busy && <span className="klive-spin" aria-hidden />}
        {pullText}
      </div>
      <main className="content klive">
        {live && (
          <div className="klive-stamp">
            통합데스크 <b className="num">{md(live.day)} {live.at.slice(11, 19)}</b> 기준 <span className="chip">{age < 1 ? "방금" : `${count(age)}분 전`}</span>
          </div>
        )}
        {err && <div className="banner">{err}</div>}
        {live && live.day !== today && <div className="banner">오늘 현황이 아직 없어요 — 마지막 현황은 {md(live.day)} {live.at.slice(11, 16)} (키즈 POS 통합데스크가 켜지면 바로 보여요)</div>}
        {live && live.day === today && age > DESK_LIVE_STALE_MIN && <div className="banner">통합데스크 소식이 {count(age)}분째 없어요 — 키즈 POS 가 꺼졌거나 인터넷이 끊겼을 수 있어요</div>}
        {state === "loading" && <p className="empty">통합데스크 현황을 받는 중입니다…</p>}
        {state === "none" && (
          <section className="card">
            <h2>통합데스크 현황이 아직 없어요</h2>
            <p className="sub">키즈 POS 통합데스크 → 운영 설정 → 설문조사 탭에서 보고 열쇠와 '폰 실시간 현황 켜짐'을 확인해 주세요. 켜져 있으면 1분 안에 올라와요.</p>
          </section>
        )}
        {state === "bad" && (
          <section className="card">
            <h2>현황 모양이 맞지 않아요</h2>
            <p className="sub">틀린 숫자를 보여 드리지 않으려고 숨겼어요. 키즈 POS 통합데스크를 새 판으로 바꿔 주세요.</p>
          </section>
        )}
        {live && <Body live={live} now={now} all={all} onAll={() => setAll(!all)} onPick={setPick} />}
      </main>
      {live && pick != null && live.keys.map[pick] && <KeySheet live={live} no={pick} onClose={() => setPick(null)} />}
    </>
  );
}

function Body({ live, now, all, onAll, onPick }: { live: DeskLive; now: Date; all: boolean; onAll: () => void; onPick: (k: number) => void }) {
  const { people: p, naver: n, keys: k } = live;
  const s = deskLiveSales(live);
  const nowHm = live.day === todayKst(now) ? new Date(now.getTime() + 9 * 3600e3).toISOString().slice(11, 16) : live.at.slice(11, 16);
  const cur = deskLiveSlotNow(live, nowHm);
  const busySlots = n.slots.filter((x) => x.done || x.conf || x.t === cur);
  const slots = all ? n.slots : busySlots;
  return (
    <>
      <section className="card klive-card">
        <h2>
          오늘 입장 <span className="note">{live.dayKind}{live.golden ? ` · 골든벨 ${live.golden}~` : ""}</span>
        </h2>
        <div className="klive-big">
          <span className="num">{count(p.total)}</span>
          <small>장</small>
          <span className="note">총 판매수 = 네이버 이용완료 + 현장</span>
        </div>
        <div className="klive-split">
          <div>
            <span>네이버</span>
            <b className="num">{count(p.naver)}</b>
          </div>
          <div>
            <span>현장{live.walk.extra ? ` (+1타임 ${live.walk.extra})` : ""}</span>
            <b className="num">{count(p.walk)}</b>
          </div>
          <div>
            <span>서비스 키</span>
            <b className="num">{count(live.walk.service)}</b>
          </div>
        </div>
        <p className="note">서비스 키는 판매가 아니라 총 판매수에 안 들어가요{n.test ? ` · 시험 기록 ${n.test}장 뺌` : ""}</p>
      </section>

      <section className="card klive-card">
        <h2>
          열쇠 운용 <span className="note">번호를 누르면 손님 · 전화</span>
        </h2>
        <div className="klive-ksum">
          <span>
            사용 <b className="num">{k.used}</b>/{k.total}
          </span>
          <span>
            빈 열쇠 <b className="num">{k.free}</b>
          </span>
          <span>
            현장 판매 가능 <b className="num">{k.walkable}</b>
            {k.flex ? ` +유동 ${k.flex}` : ""}
          </span>
        </div>
        <div className="klive-keys">
          {Array.from({ length: k.total }, (_, i) => {
            const no = i + 1;
            const m = k.map[no];
            if (!m)
              return (
                <button key={no} className="klive-key num" disabled aria-label={`${no}번 빈 열쇠`}>
                  {no}
                </button>
              );
            const h = k.holders[m.h];
            return (
              <button key={no} className={`klive-key num ${m.c}${h.kind === "s" ? " svc" : ""}`} onClick={() => onPick(no)} aria-label={`${no}번 ${KIND[h.kind]} ${COLOR[m.c]}`}>
                {no}
              </button>
            );
          })}
        </div>
        <div className="klive-legend">
          <span>
            <i /> 빈 열쇠
          </span>
          <span>
            <i className="in" /> 이용 중
          </span>
          <span>
            <i className="pink" /> 반납 시간(10분 안)
          </span>
          <span>
            <i className="red" /> 반납 시간 넘음
          </span>
          <span>
            <i className="svc" /> 서비스 키
          </span>
        </div>
      </section>
      <section className="card klive-card">
        <h2>
          입장료 매출 <span className="note">{live.at.slice(11, 16)} 기준 · {s.kind} 단가</span>
        </h2>
        <div className="klive-rows">
          <div>
            <span>
              입장권 {count(s.tickets)}장 × {won(s.price)}
            </span>
            <b className="num">{won(s.fee)}</b>
          </div>
          <div>
            <span>초과요금 결제 {count(live.over.count)}건</span>
            <b className="num">{won(s.over)}</b>
          </div>
          <div className="sum">
            <span>합계</span>
            <b className="num">{won(s.total)}</b>
          </div>
        </div>
        {s.due > 0 && (
          <p className="note">
            아직 받지 않은 초과요금 <b className="bad num">{won(s.due)}</b> (반납 전 손님 · 반납할 때 POS 결제)
          </p>
        )}
        <p className="note">장수 × 단가로 센 지금까지 · 할인 · 무료입장은 다음 날 아침 확정 보고에서 맞춰져요</p>
      </section>

      <section className="card klive-card">
        <h2>
          네이버 예약 <span className="note">오늘 합</span>
        </h2>
        <div className="klive-ntot">
          <div>
            <span>완료</span>
            <b className="num good">{count(n.done)}</b>
          </div>
          <div>
            <span>미입장</span>
            <b className="num bad">{count(n.conf)}</b>
          </div>
          <div>
            <span>잔여</span>
            <b className="num">{count(n.left)}</b>
          </div>
        </div>
        <table className="klive-slots">
          <thead>
            <tr>
              <th>시간</th>
              <th className="num">완료</th>
              <th className="num">미입장</th>
              <th className="num">잔여</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((x) => (
              <tr key={x.t} className={x.t === cur ? "sel" : undefined}>
                <td className="num">{x.t}</td>
                <td className={`num${x.done ? "" : " muted"}`}>{x.done}</td>
                <td className={`num${x.conf ? " bad" : " muted"}`}>{x.conf}</td>
                <td className={`num${x.left ? "" : " muted"}`}>{x.left}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {n.slots.length > busySlots.length && (
          <button className="ghost small" onClick={onAll}>
            {all ? "예약 있는 시간만 보기" : `모든 시간 보기 (${n.slots.length}칸)`}
          </button>
        )}
        {n.products.length > 1 && <p className="note">상품별 완료: {n.products.map((x) => `${x.name} ${x.done}`).join(" · ")}</p>}
      </section>

    </>
  );
}

function KeySheet({ live, no, onClose }: { live: DeskLive; no: number; onClose: () => void }) {
  const m = live.keys.map[no];
  const h = live.keys.holders[m.h];
  const ends = [...new Set(h.keys.map((x) => live.keys.map[x]?.end ?? null))].map((e) => (e == null ? "무제한" : e)).join(" · ");
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(phoneText(h.phone)).then(
      () => setCopied(true),
      () => undefined,
    );
  };
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet klive-sheet" role="dialog" aria-label={`${no}번 열쇠 손님`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <b>
            {h.kind === "s" && h.staff ? `직원 ${h.name}` : h.name}
            <span className={`klive-kind${h.kind === "s" ? " svc" : ""}`}>{KIND[h.kind]}</span>
          </b>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="klive-phone">
          <span className="num">{phoneText(h.phone)}</span>
          {h.phone && (
            <>
              <a className="klive-call" href={`tel:${h.phone}`}>
                전화 걸기
              </a>
              <button className="ghost small" onClick={copy}>
                {copied ? "복사함" : "번호 복사"}
              </button>
            </>
          )}
        </div>
        <dl className="klive-kv">
          <dt>열쇠</dt>
          <dd>
            {h.keys.map((x) => (
              <span key={x} className={`klive-chip num ${live.keys.map[x]?.c || ""}`}>
                {x}
              </span>
            ))}
          </dd>
          <dt>상태</dt>
          <dd>
            {COLOR[m.c]}
            {h.over > 0 ? (
              <>
                {" · "}
                <b className="bad">초과요금 {won(h.over)}</b>
              </>
            ) : h.paid > 0 ? (
              ` · 초과요금 ${won(h.paid)} 결제함`
            ) : (
              ""
            )}
          </dd>
          <dt>입장</dt>
          <dd className="num">
            {h.in || "—"}
            {h.kind === "n" ? ` (예약 ${h.slot})` : h.slot && h.slot !== h.in ? ` (입장 타임 ${h.slot})` : ""}
          </dd>
          <dt>반납</dt>
          <dd className="num">{ends}</dd>
          {h.kind === "s" ? (
            <>
              <dt>수령인</dt>
              <dd>{h.of || "서비스 키"} · 판매 아님 · 초과요금 없음</dd>
            </>
          ) : (
            <>
              <dt>수량</dt>
              <dd>
                {h.product} {count(h.qty)}장
              </dd>
            </>
          )}
          {h.visitor && (
            <>
              <dt>방문자</dt>
              <dd>{h.visitor} (대리예약)</dd>
            </>
          )}
          {h.no ? (
            <>
              <dt>예약번호</dt>
              <dd className="num">{h.no}</dd>
            </>
          ) : h.pos ? (
            <>
              <dt>POS 번호</dt>
              <dd className="num">{h.pos}</dd>
            </>
          ) : null}
        </dl>
      </div>
    </div>
  );
}
