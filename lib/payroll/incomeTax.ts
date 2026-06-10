// lib/payroll/incomeTax.ts
// 근로소득 간이세액표(운영자가 홈택스에서 받아 입력) 파싱 + 세액 조회.
// 저장형식: brackets = [{ from(원, 이상), taxes:[공제대상가족 1~N명 세액] }] (from 오름차순).

export interface TaxBracket {
  from: number;       // 월 과세급여 하한(원, 이상)
  taxes: number[];    // 공제대상가족수 1명(index0) ~ N명 세액(원)
}

/**
 * 홈택스 간이세액표 붙여넣기(엑셀 복사 → 탭 구분 권장) 파싱.
 * 각 행: [월급여 이상(천원)] [월급여 미만(천원)] [가족1] [가족2] ... [가족N]
 *  - 숫자 내 콤마(천단위)는 제거, 빈 칸 무시.
 *  - 유효 숫자 칸이 3개 미만이면 헤더로 보고 스킵.
 *  - 월급여는 천원 단위 → ×1000으로 원 단위 저장.
 */
export function parseHometaxTable(text: string): TaxBracket[] {
  const out: TaxBracket[] = [];
  // 범위표기(~)는 구분자로, 그 외 탭/공백으로 토큰화. 콤마(천단위)는 숫자 내부에서 제거.
  const lines = String(text ?? "").replace(/[~∼－—-]/g, " ").split(/\r?\n/);
  for (const raw of lines) {
    if (!raw.trim()) continue;
    // 탭/공백으로 토큰 분리 후, 콤마 제거하고 순수 숫자만 추출(헤더 글자·빈칸 자동 무시)
    const nums = raw
      .split(/[\t ]+/)
      .map(c => c.replace(/,/g, "").trim())
      .filter(c => /^\d+(\.\d+)?$/.test(c))
      .map(Number);
    // 이상 + 미만 + 세액(1개↑) 필요. nums[0](월급여 천원)이 너무 작으면 헤더(가족수 1·2·3…) → 스킵.
    if (nums.length < 3) continue;
    if (nums[0] < 100) continue;
    const taxes = nums.slice(2);
    if (taxes.length === 0) continue;
    out.push({ from: Math.round(nums[0] * 1000), taxes });
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}

/**
 * 월 과세급여(원)·공제대상가족수로 소득세 조회.
 *  - 해당 구간(from 이하 중 최대)을 찾아 taxes[가족수-1] 반환.
 *  - 표/구간 없으면 null (호출측에서 수동입력 폴백).
 */
export function lookupIncomeTax(brackets: TaxBracket[], monthlyTaxablePay: number, dependents: number): number | null {
  if (!Array.isArray(brackets) || brackets.length === 0) return null;
  if (!Number.isFinite(monthlyTaxablePay) || monthlyTaxablePay <= 0) return 0;
  // 첫 구간보다 작으면 비과세 구간 → 0
  if (monthlyTaxablePay < brackets[0].from) return 0;
  // from 이하 중 최대 구간(이진탐색)
  let lo = 0, hi = brackets.length - 1, idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (brackets[mid].from <= monthlyTaxablePay) { idx = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  const taxes = brackets[idx].taxes;
  const d = Math.max(1, Math.min(dependents || 1, taxes.length));
  return Math.round(taxes[d - 1] ?? 0);
}

/** 주민세(지방소득세) = 소득세의 10%(원 단위 절사). */
export function localIncomeTax(incomeTax: number): number {
  return Math.floor((Number(incomeTax) || 0) * 0.1);
}

/**
 * 8세 이상 20세 이하 자녀 추가공제액(간이세액표 금액에서 차감).
 *  1명 12,500 / 2명 29,160 / 3명↑ 29,160 + (초과 1명당 25,000).
 */
export function childTaxCredit(childCount: number): number {
  const n = Math.max(0, Math.floor(Number(childCount) || 0));
  if (n <= 0) return 0;
  if (n === 1) return 12500;
  if (n === 2) return 29160;
  return 29160 + (n - 2) * 25000;
}

export interface IncomeTaxResult {
  base: number;        // 간이세액표 원액(공제대상가족수 기준)
  childCredit: number; // 8~20세 자녀 추가공제액
  afterCredit: number; // max(0, base - childCredit)
  rate: number;        // 원천징수 선택비율(80/100/120)
  tax: number;         // 최종 소득세(원천징수세액)
  localTax: number;    // 주민세 = tax × 10%
}

/**
 * 소득세 종합 산정: 간이세액표 조회 → 8~20세 자녀 추가공제(음수 0) → 원천징수비율(80/100/120%) 적용.
 *  - dependents: 공제대상가족수(본인+배우자+자녀 등, 표 열).
 *  - childUnder20: 8세~20세 자녀수(추가공제용).
 *  - rate: 80|100|120 (기본 100).
 */
export function computeIncomeTax(
  brackets: TaxBracket[],
  monthlyTaxablePay: number,
  dependents: number,
  opts?: { childUnder20?: number; rate?: number },
): IncomeTaxResult {
  const base = lookupIncomeTax(brackets, monthlyTaxablePay, dependents) ?? 0;
  const childCredit = childTaxCredit(opts?.childUnder20 ?? 0);
  const afterCredit = Math.max(0, base - childCredit);
  const rate = opts?.rate === 80 || opts?.rate === 120 ? opts.rate : 100;
  const tax = Math.round((afterCredit * rate) / 100);
  return { base, childCredit, afterCredit, rate, tax, localTax: localIncomeTax(tax) };
}
