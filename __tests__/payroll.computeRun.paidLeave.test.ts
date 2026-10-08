// 연차 사용일(USE) 급여 반영 — 2026-10-08 감사 P1 (승인 연차일이 결근처럼 계산되던 문제)
//  기대값은 손계산: 2026-11 소정근로일 21일, 월급 2,090,000, 시급 10,030×8h=80,240/일, 일급 80,000.
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { installPrismaMock, normalize, state, useRow, YEAR_MONTH, AGENCY, WORKER, iso } from "./helpers/payrollRunHarness";

type Item = { workerId: string; grossPay: string; workedDays: number; breakdown: Record<string, unknown> };
const baseline: Item[] = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "payroll.computeRun.baseline.json"), "utf-8"));
const base = (id: bigint) => baseline.find((i: Item) => i.workerId === id.toString())!;

async function run(leave: ReturnType<typeof useRow>[]) {
  vi.resetModules();
  installPrismaMock();
  state.leave = leave;
  const { computePayrollItems } = await import("@/lib/payroll/computeRun");
  const { items } = await computePayrollItems(AGENCY, YEAR_MONTH);
  const out: Item[] = normalize(items);
  return (id: bigint) => out.find((i: Item) => i.workerId === id.toString())!;
}
const sumLines = (i: Item) => (i.breakdown.payLines as { amount: number }[]).reduce((s, l) => s + l.amount, 0);

describe("월급제 — 연차일은 출근으로 간주(일할 감액 없음)", () => {
  it("결근 2일(11/11·11/12)에 연차 2일 → 월정액 전액", async () => {
    const get = await run([useRow(WORKER.monthly, 11), useRow(WORKER.monthly, 12)]);
    const m = get(WORKER.monthly);
    expect(m.grossPay).toBe("2090000"); // 기준선 1,890,952 → 감액 199,048원 해소
    expect(m.breakdown.prorated).toBe(false);
    expect(m.breakdown.paidLeaveDays).toBe(2);
  });

  it("연차 1일만 등록 → 20/21 일할(연차 1일 포함 표기)", async () => {
    const get = await run([useRow(WORKER.monthly, 11)]);
    const m = get(WORKER.monthly);
    expect(m.grossPay).toBe(String(Math.round((2090000 * 20) / 21)));
    expect(m.breakdown.prorateWorkdays).toBe(20);
    expect((m.breakdown.calcMethods as Record<string, string>)["기본급"]).toContain("연차 1일 포함");
  });

  it("주말(11/7 토)에 등록된 연차는 소정근로일이 아니므로 임금 무영향 + 무시 일수 표시", async () => {
    const get = await run([useRow(WORKER.monthly, 7)]);
    const m = get(WORKER.monthly);
    expect(m.grossPay).toBe(base(WORKER.monthly).grossPay);
    expect(m.breakdown.paidLeaveIgnoredDays).toBe(1);
    expect(m.breakdown.paidLeaveDays).toBeUndefined();
  });
});

describe("시급제 — 연차일 임금 지급 + 그 주 주휴 개근 유지", () => {
  it("결근 1일(11/11)에 연차 1일 → 연차 80,240 + 주휴 4주(기준선 3주)", async () => {
    const get = await run([useRow(WORKER.hourly, 11)]);
    const h = get(WORKER.hourly);
    // 기본 160h×10,030=1,604,800 + 연차 1일×8h×10,030=80,240 + 주휴 4주×80,240=320,960
    expect(h.grossPay).toBe("2006000");
    expect(h.breakdown.paidLeavePay).toBe(80240);
    expect(h.breakdown.weeklyHolidayPay).toBe(320960);
    expect(sumLines(h)).toBe(2006000); // 지급내역 합계 = 총지급액(PATCH 합계 불변식)
    const line = (h.breakdown.payLines as { key: string; amount: number; hours: number }[]).find((l) => l.key === "paidLeave")!;
    expect(line.amount).toBe(80240);
    expect(line.hours).toBe(8);
  });

  it("반차(0.5일) → 임금 40,120 + 그날도 출근으로 간주해 주휴 유지", async () => {
    const get = await run([useRow(WORKER.hourly, 11, 0.5)]);
    const h = get(WORKER.hourly);
    expect(h.breakdown.paidLeavePay).toBe(40120);
    expect(h.breakdown.weeklyHolidayPay).toBe(320960);
    expect(h.grossPay).toBe(String(1604800 + 40120 + 320960));
  });
});

describe("일급제 — 출근 없는 연차일만 일급 지급(출근일은 중복 지급 금지)", () => {
  it("결근일(11/11) 연차 → +80,000, 주휴 4주", async () => {
    const get = await run([useRow(WORKER.daily, 11)]);
    const d = get(WORKER.daily);
    expect(d.breakdown.paidLeavePay).toBe(80000);
    expect(d.grossPay).toBe(String(1600000 + 80000 + 320000));
    expect(sumLines(d)).toBe(2000000);
  });

  it("이미 출근한 날(11/3)에 반차 등록 → 일급 중복 없음(임금 무변동)", async () => {
    const get = await run([useRow(WORKER.daily, 3, 0.5)]);
    const d = get(WORKER.daily);
    expect(d.breakdown.paidLeavePay).toBe(0);
    expect(d.grossPay).toBe(base(WORKER.daily).grossPay);
  });
});

describe("격리 — 연차가 없는 워커는 다른 워커의 연차에 영향받지 않는다", () => {
  it("월급제2(연차 없음)·시급제·일급제 결과가 기준선과 동일", async () => {
    const get = await run([useRow(WORKER.monthly, 11), useRow(WORKER.monthly, 12)]);
    for (const id of [WORKER.hourly, WORKER.daily, WORKER.monthly2]) {
      expect(get(id)).toEqual(base(id));
    }
  });
});

describe("회귀 가드", () => {
  it("연차일에 근로 기록이 없어도 workedDays(보험·근로일 판정)는 늘지 않는다 — 기존 보험 판정 불변", async () => {
    const get = await run([useRow(WORKER.hourly, 11)]);
    expect(get(WORKER.hourly).workedDays).toBe(base(WORKER.hourly).workedDays);
    expect(iso(11)).toBe("2026-11-11");
  });
});
