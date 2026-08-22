import { describe, it, expect } from "vitest";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { trainingDailyLogPayload, adaptationDailyLogPayload } from "@/lib/docs/traineeDocPayload";

// 2026-08-22 사용자 확정 — ★두 개의 시간 축을 섞지 않는다.
//  · measHours(출근부·급여) = 직무지도원 관점. 오전·오후 = 근무4H + 휴게0.5H + 출퇴근지도1H = 5.5H.
//    이 값은 work_hours_rules(2026-06-18) 절대불변이라 아래 테스트가 방벽 역할을 한다.
//  · traineeMeasHours(일지) = 장애인 관점. 출퇴근지도는 직무지도원의 시간이라 들어가지 않는다.
//    오전·오후 = 4H + 휴게 0.5H = 4.5H / 전일 = 8H(근로시간 상한).
//  그리고 일지에 실제로 찍히는 값은 ★직무지도원이 입력한 측정시간이며, 위 값은 미입력 시 기본값일 뿐이다.

const T = (workType: string, commute: boolean, cs?: string, ce?: string) =>
  dailyDocTimes(workType, commute, cs, ce);

describe("dailyDocTimes — 직무지도원 관점(measHours) 절대불변", () => {
  it("오전/오후 + 출퇴근지도 인정 = 5.5H", () => {
    expect(T("AM", true).measHours).toBe(5.5);
    expect(T("PM", true).measHours).toBe(5.5);
    expect(T("AM", true).measTimeH).toBe("5.5H");
  });
  it("오전/오후 + 출퇴근지도 미인정 = 4.5H", () => {
    expect(T("AM", false).measHours).toBe(4.5);
    expect(T("PM", false).measHours).toBe(4.5);
  });
  it("전일 = 8H (출퇴근지도 무관)", () => {
    expect(T("FULL_DAY", true).measHours).toBe(8);
    expect(T("FULL_DAY", false).measHours).toBe(8);
  });
});

describe("dailyDocTimes — 일지 기본값(traineeMeasHours) = 장애인 관점", () => {
  it("오전/오후 = 4.5H — ★출퇴근지도 인정 여부와 무관하다", () => {
    expect(T("AM", true).traineeMeasHours).toBe(4.5);
    expect(T("AM", false).traineeMeasHours).toBe(4.5);
    expect(T("PM", true).traineeMeasHours).toBe(4.5);
    expect(T("PM", false).traineeMeasHours).toBe(4.5);
    expect(T("AM", true).traineeMeasTimeH).toBe("4.5H");
  });
  it("전일 = 8H — 휴게를 더해 8을 넘기지 않는다", () => {
    expect(T("FULL_DAY", false).traineeMeasHours).toBe(8);
    expect(T("FULL_DAY", true).traineeMeasHours).toBe(8);
  });
  it("커스텀 = 지정 창 그대로", () => {
    expect(T("CUSTOM", false, "10:00", "16:00").traineeMeasHours).toBe(6);
  });
  it("★두 축이 실제로 갈라져 있다(오전 인정 배정: 출근부 5.5 vs 일지 4.5)", () => {
    const t = T("AM", true);
    expect(t.measHours).toBe(5.5);
    expect(t.traineeMeasHours).toBe(4.5);
  });
});

// ── payload 조립 ────────────────────────────────────────────────────────────
const docTimes = {
  trainingTimeH: "4H",
  guidanceYN: "Y",
  measTimeH: "5.5H",          // 직무지도원 관점 — 일지에 나오면 안 된다
  workTimeRange: "08:30~14:00",
  traineeMeasTimeH: "4.5H",   // 일지 기본값
};

const mkLog = (score: number | null, difficulty: string | null) => ({
  trainingType: "FIELD",
  evaluation: null,
  content: "지도 내용",
  attendance: { workDate: "2026-08-03" },
  tasks: [{ taskName: "포장", performanceScore: score, difficulty }],
});

// 검사 대상 필드만 좁게 선언 — payload 전체 형태에 묶이지 않도록.
type TrainingPayload = { rows: { taskLevelMeasured: string }[] };
type AdaptationPayload = { entries: { performanceLabel: string; performanceTime: string }[] };

const training = (score: number | null, difficulty: string | null) =>
  trainingDailyLogPayload({
    traineeName: "김훈련", companyName: "사업체", preStartYmd: "2026-08-01",
    start: "2026-08-03", end: "2026-08-07", logs: [mkLog(score, difficulty)],
    docTimes, signatures: {},
  }) as unknown as TrainingPayload;

const adaptation = (score: number | null, difficulty: string | null) =>
  adaptationDailyLogPayload({
    traineeName: "김훈련", companyName: "사업체",
    start: "2026-08-03", end: "2026-08-07", logs: [mkLog(score, difficulty)],
    docTimes, signatures: {},
  }) as unknown as AdaptationPayload;

describe("일지 측정시간 — 직무지도원 입력값이 그대로 나간다", () => {
  it("입력값 4 → (4H). ★근무형태 고정값 5.5H 로 덮어쓰지 않는다", () => {
    expect(training(4, "4").rows[0].taskLevelMeasured).toBe("잘함\n(4H)");
    expect(training(4, "4").rows[0].taskLevelMeasured).not.toContain("5.5");
  });
  it("입력값 4.5 · '4.5H' · '4.5h' 모두 (4.5H) 로 정규화", () => {
    for (const raw of ["4.5", "4.5H", "4.5h", " 4.5 "]) {
      expect(training(3, raw).rows[0].taskLevelMeasured).toBe("보통\n(4.5H)");
    }
  });
  it("미입력이면 근무형태 기본값(장애인 관점)으로 채운다", () => {
    expect(training(3, null).rows[0].taskLevelMeasured).toBe("보통\n(4.5H)");
    expect(training(3, "").rows[0].taskLevelMeasured).toBe("보통\n(4.5H)");
  });
  it("숫자로 읽을 수 없는 입력은 워커가 쓴 그대로 존중", () => {
    expect(training(3, "4~5").rows[0].taskLevelMeasured).toBe("보통\n(4~5)");
  });
  it("적응지도일지도 같은 규칙", () => {
    expect(adaptation(5, "4").entries[0].performanceTime).toBe("4H");
    expect(adaptation(5, null).entries[0].performanceTime).toBe("4.5H");
  });
});

describe("수행정도 미입력(null)", () => {
  it("훈련일지 — 라벨 없이 측정시간만(괄호 없음), 앞에 빈 줄을 남기지 않는다", () => {
    const cell = training(null, "4").rows[0].taskLevelMeasured;
    expect(cell).toBe("4H");
    expect(cell.startsWith("\n")).toBe(false);
  });
  it("적응지도일지 — performanceLabel 이 빈 문자열", () => {
    expect(adaptation(null, "4").entries[0].performanceLabel).toBe("");
    expect(adaptation(null, "4").entries[0].performanceTime).toBe("4H");
  });
  it("★점수가 있으면 라벨 + 줄바꿈 + 괄호 두른 측정시간", () => {
    expect(training(1, "8").rows[0].taskLevelMeasured).toBe("매우못함\n(8H)");
    expect(training(5, "8").rows[0].taskLevelMeasured).toBe("매우잘함\n(8H)");
  });
});
