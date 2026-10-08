// lib/pdf/writtenDate.ts
// 출근부 확인문구 아래 '작성일' 해석.
//
// 배경(2026-10-08 감사 P2): 작성일을 렌더 시각으로 찍어, 10/05에 제출한 시트를 10/20에 공단에 발송하면 10/20로
//  나오고, 같은 문서를 다른 날 내려받으면 날짜가 달라졌다(워커 미리보기와 공단 제출본도 불일치).
//  → payload 생성(= 제출 스냅샷 저장) 시점의 KST 날짜(writtenYMD)를 우선 사용한다.
//  writtenYMD가 없는 이전 스냅샷은 종전처럼 렌더 시각(KST)으로 폴백한다(소급 불가).

/** "YYYY-MM-DD" 형식·실존 날짜인가. */
function isYmd(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 작성일 표기 연·월·일. now는 테스트용(기본 현재). KST 벽시계일 기준. */
export function resolveWrittenDate(writtenYMD: unknown, now: number = Date.now()): { y: number; m: number; d: number } {
  if (isYmd(writtenYMD)) {
    const [y, m, d] = writtenYMD.split("-").map(Number);
    return { y, m, d };
  }
  const k = new Date(now + 9 * 3600 * 1000);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() };
}
