// lib/docs/logTextLimit.ts
// 일지 자유텍스트(지도사항·특이사항) 길이 상한 — 단일 출처.
// 2026-07-21 감사 P2: 무상한 입력이 약 900자+에서 일지 PDF 셀(dailyLogTable)을 1페이지 높이 초과로 밀어
//  자동 흘림 캐스케이드 붕괴(07-20 출근부·평가소견과 동일 클래스). 입력단 상한 + 렌더러 클램프 이중 방어.
// 상한은 지도사항 열폭 기준 붕괴 임계(~900자) 아래로 잡아 최악에도 셀 안에 담기게 한다.
export const MAX_LOG_TEXT_LEN = 800;

/** 초과 시 사용자 메시지(400). 통과 시 null. */
export function checkLogText(label: string, v: unknown): string | null {
  if (typeof v === "string" && v.length > MAX_LOG_TEXT_LEN) {
    return `${label}은(는) ${MAX_LOG_TEXT_LEN}자 이내로 입력해 주세요.`;
  }
  return null;
}
