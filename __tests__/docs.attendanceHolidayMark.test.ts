import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";

// 2026-08-22 사용자 확정 — 출근부의 빈 칸이 '쉰 날'인지 '기록이 빠진 날'인지 구분되지 않던 것.
//  커스텀 휴무일·공휴일은 총 지도시간 칸에 '휴무'를 찍는다(보정대기와 같은 방식).
//  ★주말은 요일 헤더로 자명하므로 찍지 않는다. ★공휴일에 실제 출근한 날은 시각이 찍히므로 대상이 아니다.

type Draw = string;
let draws: Draw[] = [];
let capturing = false;
const proto = PDFDocument.prototype as unknown as { text: (...a: unknown[]) => unknown };
const origText = proto.text;
proto.text = function (this: unknown, ...args: unknown[]) {
  if (capturing) draws.push(String(args[0] ?? ""));
  return (origText as (...a: unknown[]) => unknown).apply(this, args);
};

const ENTRY = (date: string) => ({ date, start: "12:30", end: "18:00", hours: 5.5, multiHours: 0 });
const BASE = {
  workerName: "곽은하", workerPhone: "010-0000-0000", companyName: "동아ST",
  periodStartYMD: "2026.08.03", periodEndYMD: "2026.08.08",
  totalDays: 3, totalHours: 16.5,
  weeklyHolidayCount: 0, monthlyLeaveCount: 0, allowanceTotalWon: "0",
  oneToOneHours: 0, oneToManyHours: 16.5, otOneToOneHours: 0, otOneToManyHours: 0,
  entries: ["2026-08-03", "2026-08-04", "2026-08-07"].map(ENTRY),
  signatures: { govAgent: { name: "" }, companyManager: { name: "" }, worker: { name: "곽은하" } },
};

async function countHolidayMarks(payload: Record<string, unknown>): Promise<number> {
  const { renderPdfKit } = await import("@/lib/pdf/pdfkitRenderer");
  draws = []; capturing = true;
  await renderPdfKit("ATTENDANCE_SHEET" as never, payload as never);
  capturing = false;
  return draws.filter((d) => d === "휴무").length;
}

describe("출근부 휴무 표기", () => {
  it("holidays 필드가 없으면 아무것도 찍지 않는다(기존 payload 무회귀)", async () => {
    expect(await countHolidayMarks(BASE)).toBe(0);
  });

  it("커스텀 휴무일·공휴일은 찍고, ★주말은 찍지 않는다", async () => {
    // 08-05(수)=커스텀 · 08-06(목)=공휴일 · 08-08(토)=주말 → 2건만
    expect(await countHolidayMarks({ ...BASE, holidays: ["2026-08-05", "2026-08-06", "2026-08-08"] })).toBe(2);
  });

  it("★공휴일이라도 실제 출근한 날은 찍지 않는다(시각이 들어가야 하므로)", async () => {
    expect(await countHolidayMarks({
      ...BASE,
      entries: [...BASE.entries, ENTRY("2026-08-06")],
      holidays: ["2026-08-06"],
    })).toBe(0);
  });

  it("기간 밖 휴무일은 칸 자체가 없어 찍히지 않는다", async () => {
    expect(await countHolidayMarks({ ...BASE, holidays: ["2026-09-01"] })).toBe(0);
  });

  it("점(.) 구분 날짜도 인식한다", async () => {
    expect(await countHolidayMarks({ ...BASE, holidays: ["2026.08.05"] })).toBe(1);
  });
});
