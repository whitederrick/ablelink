// lib/docs/periodLimit.ts
// 문서 생성·제출 기간 검증 — 단일 출처.
//
// 2026-10-08 감사 P2: 호출부가 isValidYmd(형식·실존)만 확인해 periodStart=0001-01-01·periodEnd=9999-12-31 같은 요청이
//  통과했다. 출근부 렌더러의 주 단위 루프가 약 52만 주를 돌고 payload 쿼리도 전 범위를 읽어, 한 요청이 서버리스
//  CPU·메모리를 잡아 타임아웃을 낼 수 있었다(공휴일 연도 범위 밖 경고만 남기고 0으로 처리되는 부작용도 동반).
//  정상 문서는 월 단위(출근부·일지)이고 종합평가도 훈련 기간(수개월)이므로 여유 있게 400일까지 허용한다.

export const MAX_DOC_PERIOD_DAYS = 400;

const dayNum = (ymd: string) => Math.floor(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86400000);

/** 두 값이 이미 isValidYmd를 통과했다고 가정. 문제 있으면 사용자 메시지(400), 없으면 null. */
export function checkDocPeriod(periodStart: string, periodEnd: string): string | null {
  const span = dayNum(periodEnd) - dayNum(periodStart);
  if (span < 0) return "기간의 시작일이 종료일보다 늦습니다.";
  if (span + 1 > MAX_DOC_PERIOD_DAYS) return `문서 기간은 최대 ${MAX_DOC_PERIOD_DAYS}일까지 지정할 수 있습니다.`;
  return null;
}
