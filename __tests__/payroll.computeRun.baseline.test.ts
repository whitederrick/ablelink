// computePayrollItems 무회귀 앵커: 연차(USE) 기록이 없으면 결과가 기준선(fixtures)과 한 글자도 다르지 않아야 한다.
//  기준선은 연차 급여 반영(2026-10-08) '이전' 코드로 생성했다. 갱신은 UPDATE_PAYROLL_BASELINE=1 (의도된 변경일 때만).
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { installPrismaMock, normalize, state, YEAR_MONTH, AGENCY } from "./helpers/payrollRunHarness";

const BASELINE = path.join(__dirname, "fixtures", "payroll.computeRun.baseline.json");

describe("computePayrollItems — 연차 기록 없는 경우 기준선 동일(무회귀)", () => {
  beforeEach(() => {
    vi.resetModules();
    installPrismaMock();
    state.leave = [];
  });

  it("월급제·시급제·일급제 결과가 기준선과 완전히 동일", async () => {
    const { computePayrollItems } = await import("@/lib/payroll/computeRun");
    const { items } = await computePayrollItems(AGENCY, YEAR_MONTH);
    const actual = normalize(items);
    if (process.env.UPDATE_PAYROLL_BASELINE === "1") {
      fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
      fs.writeFileSync(BASELINE, JSON.stringify(actual, null, 2), "utf-8");
    }
    const expected = JSON.parse(fs.readFileSync(BASELINE, "utf-8"));
    expect(actual).toEqual(expected);
  });
});
