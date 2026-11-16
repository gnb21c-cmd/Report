/* 재방문 이벤트 매일 아침 (2026-11-16 사장님) — POS 자동 수집이 끝나면 (.github/workflows/event-daily.yml)
   ① 돈까스 결제 건: 이벤트 시작일 ~ 어제 카페 칸에 eventMeal 이 없거나 다르면 정리한 영수증 줄(lines)로 다시 셈 (packages/core/src/eventMeal.ts)
      — 새로 받는 날은 아침 수집(buildStorePart)이 이미 넣음. 이 칸이 생기기 전 날 · 사람이 예전 입력 화면으로 올린 날을 채움
   ② 재방문 분석: 통합데스크가 매일 20:00 보내는 방문 기록(deskVisits/latest — 손님 해시 대신 보낼 때마다 새 번호)으로
      분석을 다시 계산해 deskStats/study-revisit 에 덮어씀 (방문 기록은 deskVisits/latest — 입력 계정만 읽음) (packages/core/src/revisitStudy.ts) — 아직 안 보냈으면 건너뜀
   EVENT_FROM ~ EVENT_TO (비우면 2026-10-26 ~ 어제) · EVENT_DRY=1 이면 쓰지 않음
   공개 저장소라 기록에는 날 수 · 처리 여부만 (금액 · 건수 · 손님 수 없음) */
import {
  DESK_STUDY,
  DESK_VISITS,
  dayRange,
  eventMealOf,
  parseVisitHistory,
  revisitStudy,
  STUDY_EVENT_FROM,
  STUDY_TYPE,
} from "@report/core";
import { fbLogin, readCafePiece, readDeskDoc, readLines, writeCafePiece, writeDeskStat } from "./firebase";

const env = (k: string) => process.env[k] || "";

async function main() {
  const from = env("EVENT_FROM") || STUDY_EVENT_FROM;
  const to = env("EVENT_TO") || new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10);
  const dry = env("EVENT_DRY") === "1";
  const fb = await fbLogin({
    apiKey: env("FIREBASE_API_KEY"),
    projectId: env("FIREBASE_PROJECT_ID"),
    board: env("REPORT_BOARD_KEY"),
    email: env("WEATHER_EMAIL"),
    password: env("WEATHER_PASSWORD"),
  });

  // ① 돈까스 결제 건
  let done = 0,
    same = 0;
  const skipped: string[] = [];
  for (const date of dayRange(from, to)) {
    const piece = await readCafePiece(fb, date);
    const lines = await readLines(fb, date, "cafe");
    if (!piece?.p || piece.p.basis !== "receipt" || !lines) {
      skipped.push(date);
      continue;
    }
    const m = eventMealOf(lines);
    if (JSON.stringify(piece.p.eventMeal || null) === JSON.stringify(m)) {
      same++;
      continue;
    }
    if (!dry) await writeCafePiece(fb, date, { ...piece, p: { ...piece.p, eventMeal: m } });
    done++;
  }
  console.log(
    `돈까스 결제 건 ${from} ~ ${to}: ${dry ? "확인만 — 채울 날" : "채움"} ${done}일 · 이미 같음 ${same}일${skipped.length ? ` · 영수증 줄이 없어 건너뜀 ${skipped.length}일 (${skipped.join(", ")})` : ""}`,
  );

  // ② 재방문 분석
  let v: Awaited<ReturnType<typeof readDeskDoc>>;
  try {
    v = await readDeskDoc(fb, DESK_VISITS);
  } catch (e) {
    // 보안 규칙(deskVisits)을 콘솔에 아직 안 붙여 넣었으면 읽기가 막힘 — 돈까스 결제 건은 끝났으니 실패로 멈추지 않음
    if (/클라우드 오류 403/.test(String((e as Error).message))) {
      console.log("재방문 분석: 방문 기록을 읽을 수 없음(403) — 보안 규칙 deskVisits 를 Firebase 콘솔에 붙여 넣어야 함 · 건너뜀");
      return;
    }
    throw e;
  }
  if (!v) {
    console.log(
      "재방문 분석: 통합데스크가 방문 기록(deskVisits/latest)을 아직 보내지 않음 — 건너뜀 (키즈 포스에서 파일로 계산한 것은 그대로)",
    );
    return;
  }
  const data = parseVisitHistory(v.json);
  if (!data || !data.visits.size) {
    console.log("재방문 분석: 방문 기록 모양이 틀림 — 건너뜀");
    process.exitCode = 1;
    return;
  }
  const s = {
    ...revisitStudy(data, new Date().toISOString()),
    src: "desk" as const,
    dataAt: v.at.slice(0, 40),
  };
  const json = JSON.stringify(s);
  if (!json.includes(STUDY_TYPE) || json.length >= 60000)
    throw new Error("요약 모양 · 크기 이상 — 쓰지 않음");
  if (!dry) await writeDeskStat(fb, DESK_STUDY, json);
  console.log(
    `재방문 분석: ${dry ? "확인만 — 계산됨" : "저장함"} (방문 기록 ${data.days}일 · 보낸 때 ${v.at.slice(0, 16) || "모름"})`,
  );
}

main().catch((e) => {
  console.log("멈춤:", String((e as Error).message).slice(0, 200));
  process.exit(1);
});
