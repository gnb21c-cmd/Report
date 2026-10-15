/* ============================================================
   통합데스크 설문 보고 폴더 찾기 · 연결 도우미 (2026-10-15)
   - 통합데스크는 그 PC 를 쓰는 Windows 계정의 %APPDATA%\{데스크 폴더}\report-outbox 에 파일을 남기는데,
     POS 메인 PC 실행기는 서비스 계정(NETWORK SERVICE, docs/NICE_RUNNER.md)이라 다른 계정의 폴더에 들어가지 못함
   - 그래서 실행기 폴더에 survey-share.cmd 를 깔아 둠 → 통합데스크를 쓰는 계정으로 한 번 더블클릭하면
     report-outbox 하나만 NETWORK SERVICE 가 읽을 수 있게 바꿈 (데스크의 다른 파일 · 사용자 폴더는 그대로, 관리자 권한 필요 없음)
   - 폴더 상태는 수로만 셈 (공개 기록에 Windows 사용자 이름 · 폴더 이름 남기지 않음)
   ============================================================ */
import { SURVEY_OUTBOX } from "@report/core";

/** 데스크 앱 폴더 이름 — 설치본은 productName, 혹시 몰라 package name 도 */
export const DESK_DIRS = ["아스타나키즈 입장 데스크", "astanakiz-desk"];
/** 연결 도우미 파일 (실행기 폴더 맨 위, naver-login.cmd 옆) */
export const SHARE_CMD = "survey-share.cmd";
/** NETWORK SERVICE — Windows 언어와 상관없는 이름 */
export const NETWORK_SERVICE_SID = "S-1-5-20";

/** 폴더 하나 — 들어감 · 있는데 못 들어감 · 없음 */
export type Probe = "ok" | "denied" | "none";

export function probeDir(stat: () => { isDirectory(): boolean }): Probe {
  try {
    return stat().isDirectory() ? "ok" : "none";
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "EPERM" || code === "EACCES" ? "denied" : "none";
  }
}

export interface OutboxScan {
  /** 읽을 수 있는 보고 폴더 */
  found: string[];
  /** 데스크 폴더나 보고 폴더가 있는데 이 실행기가 못 들어가는 곳 수 → survey-share.cmd */
  denied: number;
  /** 데스크 폴더는 들어가지는데 보고 폴더가 아직 없는 곳 수 (데스크가 아직 한 번도 안 보냄) */
  waiting: number;
}

/**
 * 설문 보고 폴더 후보 살피기
 * @param direct 정해 준 보고 폴더 (SURVEY_OUTBOX_DIR)
 * @param bases 사용자 Roaming 폴더들 (이 실행기 %APPDATA% · C:\Users\*\AppData\Roaming)
 */
export function scanOutboxes(direct: string[], bases: string[], probe: (dir: string) => Probe, join: (...p: string[]) => string): OutboxScan {
  const found = new Set<string>();
  let denied = 0;
  let waiting = 0;
  for (const d of direct) if (d && probe(d) === "ok") found.add(d);
  for (const base of [...new Set(bases.filter(Boolean))])
    for (const name of DESK_DIRS) {
      const app = join(base, name);
      const box = join(app, SURVEY_OUTBOX);
      const b = probe(box);
      if (b === "ok") found.add(box);
      else if (b === "denied") denied++;
      else {
        const a = probe(app);
        if (a === "denied") denied++;
        else if (a === "ok") waiting++;
      }
    }
  return { found: [...found], denied, waiting };
}

/** 파일이 없을 때 남길 말 — 무엇을 하면 되는지 */
export function noFileHint(scan: OutboxScan, bad: number, where = "C:\\actions-runner"): { text: string; warn: boolean } {
  const tail = bad ? ` (읽지 못한 파일 ${bad}개)` : "";
  if (scan.denied > 0)
    return {
      text: `통합데스크 폴더 ${scan.denied}곳에 이 실행기(서비스 계정)가 들어가지 못함 — POS 메인 PC 에서 통합데스크를 쓰는 Windows 계정으로 ${where}\\${SHARE_CMD} 를 한 번 더블클릭해 주세요${tail}`,
      warn: true,
    };
  if (scan.found.length || scan.waiting)
    return { text: `통합데스크 설문 보고 파일이 아직 없음 — 통합데스크 설문조사 탭 '누적 정보 보고앱에 보내기'가 켜져 있으면 매일 20:00 에 생김${tail}`, warn: false };
  return { text: `통합데스크 폴더를 찾지 못함 — 이 PC 에 통합데스크(1.38~)가 있나요?${tail}`, warn: false };
}

/**
 * 연결 도우미 (더블클릭) — PowerShell 없이 cmd 만 (POS PC 는 PowerShell 스크립트가 막혀 있음)
 * 이 계정 %APPDATA% 아래에서 report-outbox 가 있는 앱 폴더(= 통합데스크, 한 번이라도 보낸 뒤)를 찾아 그 폴더 하나에만 NETWORK SERVICE 읽기를 더함
 * 폴더 이름(한글)을 글에 쓰지 않아 명령창 글자판과 상관없이 찾음. 안내 글은 UTF-8 (chcp 65001)
 */
export function shareCmd(): string {
  return [
    "@echo off",
    "chcp 65001 >nul",
    "rem 통합데스크 설문 보고 폴더(report-outbox)를 보고 수집기(실행기 서비스 계정 NETWORK SERVICE)가 읽을 수 있게 함 - 보고 저장소 apps/collector/src/surveyShare.ts (docs/SURVEY.md)",
    "set n=0",
    `for /d %%D in ("%APPDATA%\\*") do if exist "%%D\\${SURVEY_OUTBOX}\\" (`,
    `  icacls "%%D\\${SURVEY_OUTBOX}" /grant "*${NETWORK_SERVICE_SID}:(OI)(CI)RX" /T /Q >nul && set /a n+=1 >nul`,
    ")",
    "echo.",
    "if %n%==0 (",
    "  echo 이 Windows 계정에서 통합데스크 설문 보고 폴더를 찾지 못했습니다.",
    "  echo 통합데스크를 쓰는 계정으로 로그인해 다시 더블클릭해 주세요. 통합데스크가 아직 한 번도 보내지 않았으면 설문조사 탭 [지금 보내기] 뒤에 다시.",
    ") else (",
    "  echo 연결했습니다. 다음 수집^(30분마다^)부터 통합데스크 설문 보고 파일을 읽습니다. 창을 닫아 주세요.",
    ")",
    "pause",
    "",
  ].join("\r\n");
}
