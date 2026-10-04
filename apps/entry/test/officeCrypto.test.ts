import { describe, expect, it } from "vitest";
import { extraTotal, parseNiceSheet } from "@report/core";
import { readRows } from "../src/excel";
import { decryptXlsx, isEncrypted } from "../src/officeCrypto";
import { NICE_SAMPLE_PW1 } from "./fixtures/niceSample";

// 가짜 숫자로 만든 나이스 모양 엑셀 (비밀번호 1)
const buf = Uint8Array.from(atob(NICE_SAMPLE_PW1), (c) => c.charCodeAt(0)).buffer;

// 시험 파일은 SHA-512 (해시 10만 번) 라 느림 — 실제 나이스 파일은 SHA-1 빠른 길
describe("비밀번호 걸린 나이스 엑셀", { timeout: 60000 }, () => {
  it("비밀번호로 풀어 읽음", async () => {
    expect(isEncrypted(buf)).toBe(true);
    const s = parseNiceSheet(readRows(await decryptXlsx(buf, "1")))!;
    expect(s.sum).toBe(6500);
    expect(s.summary).toBe(6500);
    expect(extraTotal(s.days.get("2026-07-01"))).toBe(6500);
  });
  it("비밀번호가 틀리면 알려 줌", async () => {
    await expect(decryptXlsx(buf, "2")).rejects.toThrow("비밀번호가 맞지 않습니다.");
  });
});
