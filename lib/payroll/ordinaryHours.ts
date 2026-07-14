// lib/payroll/ordinaryHours.ts
// 월급제 통상시급 산정의 분모 = 월 소정근로시간(유급주휴 포함).
//  통상임금 산정 기준시간 = (주 소정근로시간 + 주휴시간) × 4.345주.
//  · 주휴시간 = (주 소정근로시간 ÷ 40) × 8  (소정은 법정 주40h 상한)
//  · 주40시간(전일 5일) → (40+8)×4.345 ≈ 208.56 → 반올림 209 (관행값과 정확히 일치)
//  · 단시간(예 주20h)   → (20+4)×4.345 ≈ 104.28 → 104
//  209 고정은 주40h 전용이므로 단시간에 쓰면 통상시급이 과대해져 연장·야간·휴일 가산이
//  과소지급된다(위법). 이 함수로 주 소정근로시간에 비례해 동적으로 역산한다.

export const WEEKS_PER_MONTH = 4.345; // 365 ÷ 7 ÷ 12

/** 주 소정근로시간(시간) → 월 소정근로시간(유급주휴 포함, 반올림). 주40h→209. */
export function monthlyStandardHours(weeklySojeHours: number): number {
  const soje = Math.min(Math.max(0, weeklySojeHours), 40); // 소정은 법정 주40h 상한
  const weeklyHoliday = (soje / 40) * 8;                    // 주휴시간
  return Math.round((soje + weeklyHoliday) * WEEKS_PER_MONTH);
}
