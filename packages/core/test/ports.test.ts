import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dayStage, LIVE_LABEL, PORTS, portBudget, SPARK, SYSTEMS, type SystemId } from "../src";

const rules = readFileSync(new URL("../../../firebase/firestore.rules", import.meta.url), "utf8");

describe("통합 Ver.2.0 — 시스템 이름", () => {
  it("A ~ F 지칭", () => {
    expect(SYSTEMS.A.name).toBe("기초 데이터 입력창");
    expect(SYSTEMS.B.name).toBe("일일 영업 보고 app");
    expect(SYSTEMS.C.name).toBe("아스타나키즈 통합데스크");
    expect(SYSTEMS.D.name).toBe("베이커리 결정플랫폼");
    expect(SYSTEMS["D-1"].name).toBe("베이커리 생산지시서");
    expect(SYSTEMS.E.name).toBe("재고추적관리 시스템");
    expect(SYSTEMS["E-1"].name).toBe("재고 관리 및 설정");
    expect(SYSTEMS.F.name).toBe("발주app");
  });
});

describe("통합 Ver.2.0 — 포트(자료 통로) 검증", () => {
  it("포트마다 쓰는 쪽 · 읽는 쪽이 있는 시스템", () => {
    for (const p of PORTS) {
      expect(p.writers.length, p.id).toBeGreaterThan(0);
      for (const w of p.writers) expect(SYSTEMS[w.system], `${p.id} ${w.system}`).toBeTruthy();
      for (const r of p.readers) expect(SYSTEMS[r], `${p.id} ${r}`).toBeTruthy();
    }
  });

  it("포트 id 가 겹치지 않음", () => {
    expect(new Set(PORTS.map((p) => p.id)).size).toBe(PORTS.length);
  });

  it("한 칸을 두 시스템이 쓰면 누가 이기는지 정해져 있어야 함 (충돌 없음)", () => {
    for (const p of PORTS) {
      const seen = new Map<string, SystemId>();
      for (const w of p.writers)
        for (const f of w.fields) {
          const prev = seen.get(f);
          if (prev && prev !== w.system) expect(p.merge, `${p.id}.${f}: ${prev} · ${w.system}`).toBeTruthy();
          seen.set(f, w.system);
        }
    }
  });

  it("개인정보는 그 PC 안에만 (클라우드 · 공개 저장소에 올리지 않음)", () => {
    for (const p of PORTS.filter((x) => x.personal)) expect(p.access, p.id).toBe("local-only");
  });

  it("누구나 읽는(공개 읽기) 포트에는 개인정보 · 원가가 없음", () => {
    for (const p of PORTS.filter((x) => x.access === "public-read")) {
      expect(p.personal, p.id).toBeFalsy();
      expect(p.cost, p.id).toBeFalsy();
    }
  });

  it("클라우드 포트는 보안 규칙에 자리가 있거나, 아직 계획이면 새 규칙이 필요하다고 적혀 있음", () => {
    for (const p of PORTS.filter((x) => x.access !== "local-only")) {
      const top = p.path.split("/")[0];
      const has = new RegExp(`match /${top}/`).test(rules);
      if (p.status === "운영") expect(has, `${p.id} → firestore.rules 에 match /${top}/ 없음`).toBe(true);
      else if (!has) expect(p.newRule, `${p.id} — 새 규칙 설명 필요`).toBeTruthy();
    }
  });

  it("Firebase 무료(Spark) 하루 한도의 절반 안 — 읽기 · 쓰기", () => {
    const b = portBudget(PORTS);
    expect(b.writes).toBeLessThan(SPARK.writesPerDay / 2);
    expect(b.reads).toBeLessThan(SPARK.readsPerDay / 2);
  });

  it("무료 판에 없는 기능(Cloud Functions)에 기대지 않음", () => {
    for (const p of PORTS) for (const w of p.writers) expect(w.via, p.id).not.toBe("functions");
  });
});

describe("마감 전 영업정보 — 오늘은 다음 날 확정", () => {
  it("오늘(현재일) = 마감 전, 어제까지 = 확정", () => {
    expect(dayStage("2026-10-08", "2026-10-08")).toBe("live");
    expect(dayStage("2026-10-07", "2026-10-08")).toBe("closed");
    expect(dayStage("2026-10-09", "2026-10-08")).toBe("future");
    expect(LIVE_LABEL).toBe("마감 전 영업정보");
  });
});
