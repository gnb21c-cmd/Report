import { join } from "node:path/win32";
import { describe, expect, it } from "vitest";
import { DESK_DIRS, NETWORK_SERVICE_SID, noFileHint, probeDir, scanOutboxes, shareCmd, type Probe } from "../src/surveyShare";

const err = (code: string) => () => {
  throw Object.assign(new Error(code), { code });
};
const dir = () => ({ isDirectory: () => true });
const file = () => ({ isDirectory: () => false });

describe("설문 보고 폴더 — 실행기(서비스 계정)가 들어가는지", () => {
  it("폴더 하나: 들어감 · 못 들어감(EPERM · EACCES) · 없음", () => {
    expect(probeDir(dir)).toBe("ok");
    expect(probeDir(err("EPERM"))).toBe("denied");
    expect(probeDir(err("EACCES"))).toBe("denied");
    expect(probeDir(err("ENOENT"))).toBe("none");
    expect(probeDir(file)).toBe("none");
  });

  const ROAM = "C:\\Users\\desk\\AppData\\Roaming";
  const APP = join(ROAM, DESK_DIRS[0]);
  const BOX = join(APP, "report-outbox");
  const scan = (map: Record<string, Probe>, direct: string[] = []) => scanOutboxes(direct, [ROAM, "C:\\Users\\other\\AppData\\Roaming", ROAM], (d) => map[d] ?? "none", join);

  it("연결 전: 데스크 폴더 · 보고 폴더에 못 들어감 → 연결 도우미를 더블클릭하라고", () => {
    const s = scan({ [APP]: "denied", [BOX]: "denied" });
    expect(s).toEqual({ found: [], denied: 1, waiting: 0 });
    const h = noFileHint(s, 0);
    expect(h.warn).toBe(true);
    expect(h.text).toContain("survey-share.cmd");
  });

  it("데스크가 아직 한 번도 안 보냄 (보고 폴더 없음 · 데스크 폴더는 못 들어감) → 그래도 연결 도우미 (보고 폴더를 만들어 줌)", () => {
    const s = scan({ [APP]: "denied" });
    expect(s.denied).toBe(1);
    expect(noFileHint(s, 0).warn).toBe(true);
  });

  it("연결 뒤: 데스크 폴더는 그대로 못 들어가도 보고 폴더는 읽음 (같은 폴더는 한 번)", () => {
    const s = scan({ [APP]: "denied", [BOX]: "ok" });
    expect(s).toEqual({ found: [BOX], denied: 0, waiting: 0 });
  });

  it("데스크 폴더는 있는데 보고 폴더가 없음 → '보고앱에 보내기' 켜기 안내 (경고 아님)", () => {
    const s = scan({ [APP]: "ok" });
    expect(s).toEqual({ found: [], denied: 0, waiting: 1 });
    const h = noFileHint(s, 0);
    expect(h.warn).toBe(false);
    expect(h.text).toContain("누적 정보 보고앱에 보내기");
  });

  it("보고 폴더는 읽는데 파일이 없음 · 통합데스크가 없음 · 읽지 못한 파일 수", () => {
    expect(noFileHint({ found: [BOX], denied: 0, waiting: 0 }, 0).text).toContain("20:00");
    expect(noFileHint({ found: [], denied: 0, waiting: 0 }, 0).text).toContain("찾지 못함");
    expect(noFileHint({ found: [BOX], denied: 0, waiting: 0 }, 2).text).toContain("읽지 못한 파일 2개");
  });

  it("정해 준 보고 폴더(SURVEY_OUTBOX_DIR)도 읽음 · 빈 값은 건너뜀", () => {
    expect(scan({ "D:\\outbox": "ok" }, ["D:\\outbox", ""]).found).toEqual(["D:\\outbox"]);
  });
});

describe("연결 도우미 (survey-share.cmd — PowerShell 없이 cmd 만)", () => {
  const cmd = shareCmd();
  const lines = cmd.split("\r\n");

  it("명령 줄은 영어만 (한글 폴더 이름을 쓰지 않음) · 안내 글만 한글(UTF-8) · 줄바꿈은 CRLF", () => {
    expect(lines[0]).toBe("@echo off");
    expect(lines[1]).toBe("chcp 65001 >nul");
    for (const l of lines.filter((x) => !/^\s*(rem|echo) /.test(x))) expect(/^[\x00-\x7f]*$/.test(l)).toBe(true);
    expect(cmd).not.toMatch(/[^\r]\n/);
    expect(cmd).not.toMatch(/powershell/i);
    for (const n of DESK_DIRS) expect(cmd).not.toContain(n);
  });

  it("이 계정 %APPDATA% 에서 report-outbox 가 있는 폴더만 · NETWORK SERVICE 읽기(하위 파일까지)만", () => {
    expect(cmd).toContain('for /d %%D in ("%APPDATA%\\*") do if exist "%%D\\report-outbox\\" (');
    expect(cmd).toContain(`icacls "%%D\\report-outbox" /grant "*${NETWORK_SERVICE_SID}:(OI)(CI)RX" /T /Q`);
    // 쓰기 · 지우기 권한은 주지 않음, 데스크 폴더 전체(%%D)에도 아님
    expect(cmd).not.toMatch(/:\(OI\)\(CI\)(F|M|W)/);
    expect(cmd).not.toMatch(/icacls "%%D"/);
  });

  it("괄호 묶음 안의 안내 글 괄호는 ^ 로 막음 · 끝에 창을 멈춰 둠", () => {
    for (const l of lines.filter((x) => /^\s+echo /.test(x))) expect(l.replace(/\^[()]/g, "")).not.toMatch(/[()]/);
    expect(lines.at(-2)).toBe("pause");
  });
});
