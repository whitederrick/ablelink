import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";

// 2026-08-22~23 사용자 확정 — 출근부의 빈 칸이 '쉰 날'인지 '기록이 빠진 날'인지 구분되지 않던 것.
//  근무하지 않은 날은 총 지도시간 칸에 사유를 글자로 찍는다(보정대기와 같은 방식).
//   · 휴무 = 커스텀 휴무일(SiteHoliday) · 평일 공휴일
//   · 주말 = 토·일 중 근무 기록이 없는 날 (★주말이 공휴일보다 우선)
//  ★근무 기록이 있으면(주말·공휴일 출근) 사유를 무시하고 시각이 찍힌다.
//  ★사유가 붙지 않은 평일 공백만 원본 빈 서식으로 남는다 — 그게 곧 '기록 누락' 신호다.
//  ★근무일 시간은 괄호 없이(2026-08-23).

let draws: string[] = [];
let capturing = false;
const proto = PDFDocument.prototype as unknown as { text: (...a: unknown[]) => unknown };
const origText = proto.text;
proto.text = function (this: unknown, ...args: unknown[]) {
  if (capturing) draws.push(String(args[0] ?? ""));
  return (origText as (...a: unknown[]) => unknown).apply(this, args);
};

const ENTRY = (date: string) => ({ date, start: "12:30", end: "18:00", hours: 5.5, multiHours: 5.5 });
// 기간 2026-08-03(월) ~ 08-08(토). 근무 = 월·화·금.
const BASE = {
  workerName: "곽은하", workerPhone: "010-0000-0000", companyName: "동아ST",
  periodStartYMD: "2026.08.03", periodEndYMD: "2026.08.08",
  totalDays: 3, totalHours: 16.5,
  weeklyHolidayCount: 0, monthlyLeaveCount: 0, allowanceTotalWon: "0",
  oneToOneHours: 0, oneToManyHours: 16.5, otOneToOneHours: 0, otOneToManyHours: 0,
  entries: ["2026-08-03", "2026-08-04", "2026-08-07"].map(ENTRY),
  signatures: { govAgent: { name: "" }, companyManager: { name: "" }, worker: { name: "곽은하" } },
};

async function render(payload: Record<string, unknown>): Promise<string[]> {
  const { renderPdfKit } = await import("@/lib/pdf/pdfkitRenderer");
  draws = []; capturing = true;
  await renderPdfKit("ATTENDANCE_SHEET" as never, payload as never);
  capturing = false;
  return draws;
}
const count = (d: string[], t: string) => d.filter((x) => x === t).length;

describe("출근부 — 근무하지 않은 날의 사유 표기", () => {
  it("커스텀 휴무일·평일 공휴일은 '휴무'", async () => {
    // 08-05(수)=커스텀 · 08-06(목)=공휴일 → 2건
    const d = await render({ ...BASE, holidays: ["2026-08-05", "2026-08-06"] });
    expect(count(d, "휴무")).toBe(2);
  });

  it("★토·일 무근무는 '주말' — 기간 내 08-08(토) 1건", async () => {
    const d = await render(BASE);
    expect(count(d, "주말")).toBe(1);
  });

  it("★주말이 공휴일보다 우선한다(토요일 공휴일은 '주말')", async () => {
    const d = await render({ ...BASE, holidays: ["2026-08-08"] });
    expect(count(d, "주말")).toBe(1);
    expect(count(d, "휴무")).toBe(0);
  });

  it("★주말에 출근하면 사유 대신 시각이 찍힌다", async () => {
    const d = await render({ ...BASE, entries: [...BASE.entries, ENTRY("2026-08-08")] });
    expect(count(d, "주말")).toBe(0);
  });

  it("★공휴일이라도 실제 출근한 날은 '휴무'를 찍지 않는다", async () => {
    const d = await render({
      ...BASE, entries: [...BASE.entries, ENTRY("2026-08-06")], holidays: ["2026-08-06"],
    });
    expect(count(d, "휴무")).toBe(0);
  });

  it("기간 밖 휴무일은 칸 자체가 없어 찍히지 않는다", async () => {
    const d = await render({ ...BASE, holidays: ["2026-09-01"] });
    expect(count(d, "휴무")).toBe(0);
  });

  it("점(.) 구분 날짜도 인식한다", async () => {
    const d = await render({ ...BASE, holidays: ["2026.08.05"] });
    expect(count(d, "휴무")).toBe(1);
  });

  it("holidays 필드가 없어도 주말 표기는 동작한다(기존 payload 무회귀)", async () => {
    const d = await render(BASE);
    expect(count(d, "휴무")).toBe(0);
    expect(count(d, "주말")).toBe(1);
  });
});

describe("출근부 — 시간 표기에서 괄호 제거", () => {
  it("근무일 시간은 괄호 없이 '5.5h'", async () => {
    const d = await render(BASE);
    expect(d).toContain("5.5h");
    expect(d).not.toContain("(5.5h)");
  });

  it("사유가 붙은 날의 1:多 칸은 '-'", async () => {
    const d = await render({ ...BASE, holidays: ["2026-08-05"] });
    expect(count(d, "-")).toBeGreaterThanOrEqual(2);  // 08-05 휴무 + 08-08 주말
  });

  it("★사유 없는 평일 공백은 원본 빈 서식으로 남는다(기록 누락 신호)", async () => {
    // 08-06(목)은 근무도 휴무도 아님 → ': / ~ : / (h)' 유지
    const d = await render(BASE);
    expect(d).toContain("(h)");
  });
});
