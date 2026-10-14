import { describe, expect, it } from "vitest";
import { cleanSurveys, sampleSurveys, SURVEY_SAMPLE_TODAY, surveyList, surveyOpen, surveyShares, type Survey } from "../src";

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
  it("항목별 % — 응답 합 = 100%, 소수 한 자리, 나머지가 큰 항목부터 0.1 씩 더해 합이 꼭 100.0", () => {
    const p = surveyShares([{ no: 1, label: "가", n: 1 }, { no: 2, label: "나", n: 1 }, { no: 3, label: "다", n: 1 }]);
    expect(p).toEqual([33.4, 33.3, 33.3]);
    expect(Math.round(p.reduce((a, x) => a + x, 0) * 10)).toBe(1000);
    expect(surveyShares([{ no: 1, label: "가", n: 12 }, { no: 2, label: "나", n: 5 }, { no: 3, label: "다", n: 3 }])).toEqual([60, 25, 15]);
    expect(surveyShares([{ no: 1, label: "가", n: 0 }, { no: 2, label: "나", n: 0 }])).toEqual([0, 0]);
  });
  it("체험판 설문 — 진행 중 1건 이상, 합 100%", () => {
    const doc = cleanSurveys(sampleSurveys())!;
    const list = surveyList(doc, SURVEY_SAMPLE_TODAY);
    expect(list.map((x) => [x.survey.id, x.open])).toEqual([["how-know", true], ["kids-age", true], ["visit-again", false]]);
    for (const { survey } of list) if (survey.options.some((o) => o.n)) expect(Math.round(surveyShares(survey.options).reduce((a, x) => a + x, 0) * 10)).toBe(1000);
  });
});
