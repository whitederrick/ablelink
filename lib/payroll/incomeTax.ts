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
// 셀 값 → 숫자(콤마 제거). 숫자형/숫자문자열만 인정, 그 외(헤더·"-"·빈칸)는 NaN.
function cellToNum(v: any): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.replace(/,/g, "").trim();
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  return NaN;
}

// 한 행의 숫자열 → 구간. [이상(천원), 미만(천원), 가족1, 가족2 …]. 헤더/초과식 행은 제외.
function bracketFromNums(nums: number[]): TaxBracket | null {
  if (nums.length < 3) return null;
  // nums[0]=월급여(천원). 헤더(가족수 1·2·3…)는 작고, "10,000천원 초과" 식 행은 세액(수십만↑)이 앞에 옴 → 범위로 거른다.
  if (nums[0] < 100 || nums[0] > 100000) return null;
  const taxes = nums.slice(2);
  if (taxes.length === 0) return null;
  return { from: Math.round(nums[0] * 1000), taxes };
}

// 셀 행렬(엑셀 업로드 등) → 구간 목록.
export function bracketsFromMatrix(rows: any[][]): TaxBracket[] {
  const out: TaxBracket[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const nums = row.map(cellToNum).filter((n): n is number => Number.isFinite(n));
    const b = bracketFromNums(nums);
    if (b) out.push(b);
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}

export function parseHometaxTable(text: string): TaxBracket[] {
  // 범위표기(~,—)는 구분자로 치환, 줄/탭/공백으로 토큰화 → 행렬로 환원 후 공통 처리.
  const rows = String(text ?? "")
    .replace(/[~∼－—]/g, " ")
    .split(/\r?\n/)
    .map(line => line.split(/[\t ]+/));
  return bracketsFromMatrix(rows);
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

export interface BonusTaxResult {
  months: number;          // 지급대상기간 월수(1~12)
  ordinaryTotal: number;   // 기간 내 상여외 급여 합계
  perMonth: number;        // (상여 + 상여외급여합계) ÷ 월수
  perMonthTax: number;     // ㉮: perMonth의 간이세액표 세액(자녀공제·비율 반영)
  grossOnPeriod: number;   // ㉮ × 월수
  alreadyWithheld: number; // ㉰: 기간 상여외 급여에 이미 원천징수한 세액
  bonusTax: number;        // 상여 원천징수 소득세 = max(0, ㉮×월수 − ㉰)
  bonusLocalTax: number;   // 상여분 주민세 = 소득세 10%
}

/**
 * 상여 등 원천징수세액(원칙: 지급대상기간 있는 상여).
 *  bonusTax = (㉮ × 월수) − 기징수세액,  ㉮ = 간이세액표((상여 + 상여외급여합계) ÷ 월수).
 *  - monthlyPay: 월 상여외 급여(과세). 상여외급여합계 미지정 시 monthlyPay × 월수로 산정.
 *  - alreadyWithheld 미지정 시 (월급여 세액 × 월수)로 산정.
 *  - 지급대상기간 없는/특례 상여는 호출측에서 months(또는 합계)만 맞춰 전달.
 */
export function computeBonusTax(
  brackets: TaxBracket[],
  opts: {
    bonus: number; monthlyPay: number; months: number; dependents: number;
    childUnder20?: number; rate?: number; ordinaryTotal?: number; alreadyWithheld?: number;
  },
): BonusTaxResult {
  const months = Math.max(1, Math.min(12, Math.round(opts.months || 1)));
  const taxOpts = { childUnder20: opts.childUnder20 ?? 0, rate: opts.rate ?? 100 };
  const ordinaryTotal = opts.ordinaryTotal != null ? opts.ordinaryTotal : (Number(opts.monthlyPay) || 0) * months;
  const perMonth = ((Number(opts.bonus) || 0) + ordinaryTotal) / months;
  const perMonthTax = computeIncomeTax(brackets, perMonth, opts.dependents, taxOpts).tax;
  const grossOnPeriod = perMonthTax * months;
  const monthlyTax = computeIncomeTax(brackets, Number(opts.monthlyPay) || 0, opts.dependents, taxOpts).tax;
  const alreadyWithheld = opts.alreadyWithheld != null ? opts.alreadyWithheld : monthlyTax * months;
  const bonusTax = Math.max(0, Math.round(grossOnPeriod - alreadyWithheld));
  return {
    months, ordinaryTotal, perMonth, perMonthTax, grossOnPeriod,
    alreadyWithheld, bonusTax, bonusLocalTax: localIncomeTax(bonusTax),
  };
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
