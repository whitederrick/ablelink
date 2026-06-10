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
  const lines = String(text ?? "").split(/\r?\n/);
  for (const raw of lines) {
    if (!raw.trim()) continue;
    // 탭이 있으면 탭 구분(엑셀 복사), 없으면 2칸 이상 공백 구분
    const cells = raw.includes("\t") ? raw.split("\t") : raw.trim().split(/\s{2,}|\s+/);
    const nums = cells.map(c => {
      const s = c.replace(/[,\s]/g, "");
      if (s === "" || !/^-?\d+(\.\d+)?$/.test(s)) return NaN;
      return Number(s);
    });
    // 앞 두 칸(이상/미만) + 세액 1칸 이상 필요
    if (!Number.isFinite(nums[0]) || nums.length < 3) continue;
    const taxes = nums.slice(2).filter(n => Number.isFinite(n)) as number[];
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
