import { describe, expect, it } from "vitest";
import { cleanSurveys, sampleSurveys, SURVEY_SAMPLE_TODAY, surveyList, surveyOpen, surveyRanked, surveysFromDesk, surveyShares, type Survey } from "../src";

const s = (o: Partial<Survey>): Survey => ({ id: "a", title: "아스타나를 어떻게 알게 되셨나요?", from: "2026-10-15", to: null, options: [], ...o });

describe("설문조사 — 통합데스크가 20시에 남기는 집계 (2026-10-14 사장님)", () => {
  it("모양이 맞는 것만 받음 — 번호 순으로, 응답 수는 0 이상 정수, 같은 이름표 · 빈 항목은 뺌", () => {
    const doc = cleanSurveys({
      v: 1,
      at: "2026-10-15T20:00:00+09:00",
      surveys: [
        { id: "how-know", title: "아스타나를 어떻게 알게 되셨나요?", from: "2026-10-15", to: null, options: [{ no: 2, label: "인스타그램", n: 5 }, { no: 1, label: "네이버 검색", n: 12.7 }, { no: 3, label: "", n: 1 }, { no: 4, label: "지인 소개", n: -3 }] },
        { id: "how-know", title: "중복", from: "2026-10-15", options: [] },
        { id: "", title: "이름표 없음", from: "2026-10-15", options: [] },
        { id: "bad-date", title: "날짜 틀림", from: "10/15", options: [] },
        "아무거나",
      ],
    })!;
    expect(doc.at).toBe("2026-10-15T20:00:00+09:00");
    expect(doc.surveys).toHaveLength(1);
    expect(doc.surveys[0].options).toEqual([
      { no: 1, label: "네이버 검색", n: 13 },
      { no: 2, label: "인스타그램", n: 5 },
      { no: 4, label: "지인 소개", n: 0 },
    ]);
    expect(cleanSurveys(null)).toBeNull();
    expect(cleanSurveys({ v: 1, surveys: "x" })).toBeNull();
  });
  it("진행 중 = 시작일 ~ 끝일(없으면 계속) 안", () => {
    expect(surveyOpen(s({ from: "2026-10-15", to: null }), "2026-10-14")).toBe(false);
    expect(surveyOpen(s({ from: "2026-10-15", to: null }), "2026-10-15")).toBe(true);
    expect(surveyOpen(s({ from: "2026-10-15", to: "2026-10-31" }), "2026-10-31")).toBe(true);
    expect(surveyOpen(s({ from: "2026-10-15", to: "2026-10-31" }), "2026-11-01")).toBe(false);
  });
  it("목록 — 진행 중인 것이 위, 그 안에서 최근 시작한 것이 맨 위 · 끝난 것은 아래", () => {
    const list = surveyList(
      {
        v: 1,
        at: "",
        surveys: [s({ id: "old", from: "2026-09-01", to: "2026-09-30" }), s({ id: "a", from: "2026-10-01" }), s({ id: "b", from: "2026-10-15" }), s({ id: "soon", from: "2026-11-01" })],
      },
      "2026-10-20",
    );
    expect(list.map((x) => [x.survey.id, x.open])).toEqual([
      ["b", true],
      ["a", true],
      ["soon", false],
      ["old", false],
    ]);
  });
  it("항목별 % — 응답 합을 100% 로, 항목마다 소수 한 자리 반올림 (같은 응답 수는 늘 같은 %)", () => {
    expect(surveyShares([{ no: 1, label: "가", n: 1 }, { no: 2, label: "나", n: 1 }, { no: 3, label: "다", n: 1 }])).toEqual([33.3, 33.3, 33.3]);
    expect(surveyShares([{ no: 1, label: "가", n: 1 }, { no: 2, label: "나", n: 2 }])).toEqual([33.3, 66.7]);
    expect(surveyShares([{ no: 1, label: "가", n: 12 }, { no: 2, label: "나", n: 5 }, { no: 3, label: "다", n: 3 }])).toEqual([60, 25, 15]);
    expect(surveyShares([{ no: 1, label: "가", n: 0 }, { no: 2, label: "나", n: 0 }])).toEqual([0, 0]);
  });
  it("보여 줄 때는 순위 순 — 응답이 많은 항목이 1위로 맨 위, 같은 수는 같은 순위 · 같은 %(번호 순)", () => {
    const r = surveyRanked([
      { no: 1, label: "네이버", n: 5 },
      { no: 2, label: "인스타", n: 12 },
      { no: 3, label: "지인", n: 5 },
      { no: 4, label: "간판", n: 0 },
      { no: 5, label: "블로그", n: 8 },
    ]);
    expect(r.map((x) => [x.rank, x.label, x.n, x.share])).toEqual([
      [1, "인스타", 12, 40],
      [2, "블로그", 8, 26.7],
      [3, "네이버", 5, 16.7],
      [3, "지인", 5, 16.7],
      [5, "간판", 0, 0],
    ]);
  });
  it("통합데스크 report-outbox 파일들 → 설문마다 가장 최근 날의 기간 누적 (질문 · 기간 시작일이 같으면 같은 설문)", () => {
    const f = (day: string, totals: number[], o: Record<string, unknown> = {}) => ({
      type: "astanakiz-survey",
      v: 1,
      day,
      sentAt: `${day} 20:00`,
      question: "아스타나키즈를 어떻게 알게 되었나요",
      period: { from: "2026-11-01", to: "2026-11-30" },
      targets: { naverNew: true, walkin: true, all: false },
      options: [
        { no: 1, label: "네이버 검색", today: 1, total: totals[0] },
        { no: 2, label: "인스타그램", today: 0, total: totals[1] },
        { no: 3, label: "", today: 0, total: 0 },
      ],
      excluded: { today: 1, total: 5 },
      answered: { today: 3, total: totals[0] + totals[1] },
      ...o,
    });
    const doc = surveysFromDesk([
      f("2026-11-02", [8, 4]),
      f("2026-11-03", [12, 5]),
      f("2026-11-01", [3, 1]),
      f("2026-10-20", [7, 9], { question: "다음에 또 오실 건가요?", period: { from: "2026-10-10", to: "2026-10-20" } }),
      { type: "다른 것", v: 1 },
      f("날짜 아님", [1, 1]),
    ])!;
    expect(doc.at).toBe("2026-11-03 20:00");
    expect(doc.surveys).toHaveLength(2);
    const a = doc.surveys.find((x) => x.from === "2026-11-01")!;
    expect([a.title, a.to, a.asOf, a.answered, a.excluded, a.targets]).toEqual(["아스타나키즈를 어떻게 알게 되었나요", "2026-11-30", "2026-11-03", 17, 5, ["신규고객", "현장구매자"]]);
    expect(a.options).toEqual([{ no: 1, label: "네이버 검색", n: 12 }, { no: 2, label: "인스타그램", n: 5 }]); // 빈 선택지는 뺌
    expect(doc.surveys.find((x) => x.from === "2026-10-10")!.options.map((o) => o.n)).toEqual([7, 9]);
    // 클라우드에 올렸다 다시 읽어도 같음
    expect(cleanSurveys(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(surveysFromDesk([])).toBeNull();
  });
  it("체험판 설문 — 진행 중 2건 · 끝난 1건, % 를 더하면 100% 에서 0.1 안쪽", () => {
    const doc = cleanSurveys(sampleSurveys())!;
    const list = surveyList(doc, SURVEY_SAMPLE_TODAY);
    expect(list.map((x) => [x.survey.id, x.open])).toEqual([["how-know", true], ["kids-age", true], ["visit-again", false]]);
    for (const { survey } of list) expect(Math.abs(surveyShares(survey.options).reduce((a, x) => a + x, 0) - 100)).toBeLessThanOrEqual(0.1 + 1e-9);
  });
});
