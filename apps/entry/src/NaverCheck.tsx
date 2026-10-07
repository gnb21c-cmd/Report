/* 네이버 [신규 다시 확인] — 정해진 계정(NAVER_ASK_EMAIL)만 보임
   누르면 요청을 클라우드에 남김 → GitHub(5분마다 봄)이 POS 메인 PC 수집을 시작 → 어제 완료자 목록 + 오늘 이용완료 목록을 읽어
   어제 · 오늘 모두 온 손님은 오늘 줄 수만큼 '완료 N' 에서 빼고 어제 신규를 다시 셈 → B 에 반영 · 결과를 여기에 보여 줌 (이름 · 전화 없음) */
import { useEffect, useState } from "react";
import type { NaverAsk, NaverAskResult } from "@report/core";
import { api } from "./api";

const hm = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function NaverCheck({ by, onDone }: { by: string; onDone?: () => void }) {
  const [ask, setAsk] = useState<NaverAsk | null>(null);
  const [res, setRes] = useState<NaverAskResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // 이번 요청의 결과인지
  const mine = ask && res?.ask === ask.at ? res : null;
  const waiting = !!ask && (!mine || mine.state === "run");

  const load = async () => {
    try {
      const r = await api.naverCheck();
      setAsk(r.ask);
      setRes(r.result);
      setErr("");
      return r;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    }
  };
  useEffect(() => {
    load();
  }, []);
  // 기다리는 동안 30초마다 (체험판은 5초)
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(async () => {
      const r = await load();
      if (r?.ask && r.result?.ask === r.ask.at && r.result.state !== "run") onDone?.();
    }, __DEMO__ ? 5000 : 30000);
    return () => clearInterval(id);
  }, [waiting, ask?.at]);

  const press = async () => {
    if (waiting && !confirm("아직 앞 요청을 처리하는 중입니다. 다시 요청할까요?")) return;
    setBusy(true);
    try {
      setAsk(await api.naverAsk(by || "?"));
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reps = mine?.repeaters || [];
  return (
    <div className="naver-check">
      <div className="nc-row">
        <button className="small" onClick={press} disabled={busy}>
          🔄 어제 신규 다시 확인
        </button>
        <span className="nc-state">
          {!ask
            ? "어제 · 오늘 이용완료 손님을 견주어 어제 신규방문자를 다시 셉니다"
            : !mine
              ? `${hm(ask.at)} 요청함 — GitHub 이 POS 메인 PC 에 일을 넘기기를 기다리는 중 (보통 5 ~ 15분)`
              : mine.state === "run"
                ? `${hm(ask.at)} 요청 — POS 메인 PC 가 네이버를 읽는 중 (몇 분)`
                : mine.state === "fail"
                  ? `${hm(mine.at)} 끝 — ${mine.stopped ? "중간에 멈춤 (네이버 로그인이 풀렸을 수 있음)" : "목록을 다 못 읽음 — 한 번 더 눌러 주세요"}`
                  : `${hm(mine.at)} 끝 — B 에 반영함`}
        </span>
      </div>
      {mine && mine.state !== "run" && mine.date && (
        <div className="nc-result">
          <div>
            {md(mine.date)} 판매입장권 {mine.tickets ?? "?"}장 · 신규 {mine.newPeople == null ? "모름" : `${mine.newPeople}명`}
            {mine.todayCells ? ` · 오늘 이용완료 ${mine.todayCells}칸 읽음${mine.todayFail ? ` (못 읽음 ${mine.todayFail}칸)` : ""}` : " · 오늘 이용완료 아직 없음"}
          </div>
          {reps.length ? (
            <table className="nc-table">
              <thead>
                <tr>
                  <th>어제 · 오늘 모두 온 손님</th>
                  <th>어제</th>
                  <th>오늘</th>
                  <th>완료 누적</th>
                  <th>어제 신규?</th>
                </tr>
              </thead>
              <tbody>
                {reps.map((r, i) => (
                  <tr key={i}>
                    <td>손님 {i + 1}</td>
                    <td>{r.yesterday}건</td>
                    <td>{r.today}건</td>
                    <td>완료 {r.done}</td>
                    <td>{r.isNew ? "✓ 신규 (오늘 것 빼면 처음)" : "예전에도 옴"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="nc-none">어제 · 오늘 모두 온 손님 없음 — 어제 '완료 N' 이 어제 온 횟수와 같은(대부분 완료 1) 손님을 신규로 셈</div>
          )}
        </div>
      )}
      {err && <div className="msg bad">{err}</div>}
    </div>
  );
}
