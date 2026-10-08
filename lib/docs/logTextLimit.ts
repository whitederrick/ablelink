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

// ── 2026-10-08 감사 P3: 일지 숫자·짧은 텍스트 입력 검증 ──
//  숫자: NaN("abc")은 Prisma 500, 음수·거대값은 그대로 저장돼 출근부·급여 시간 합산을 오염시켰다.
//  짧은 텍스트(과제명·측정시간)는 상한이 없어 지도사항 800자 상한을 우회해 PDF 셀을 다시 붕괴시킬 수 있었다.
export const MAX_LOG_HOURS = 24;
export const MAX_TASK_NAME_LEN = 100;
export const MAX_MEASUREMENT_LEN = 50;
export const MAX_BATCH_LOGS = 2000;

/** 시간(시간 단위) 값 검증. 미입력(undefined·null·"")은 통과(기본값 0 적용). 잘못되면 사용자 메시지(400). */
export function checkLogHours(label: string, v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_LOG_HOURS) {
    return `${label}은(는) 0 이상 ${MAX_LOG_HOURS} 이하의 숫자로 입력해 주세요.`;
  }
  return null;
}

/** 짧은 텍스트 길이 상한. */
export function checkShortText(label: string, v: unknown, max: number): string | null {
  if (typeof v === "string" && v.length > max) return `${label}은(는) ${max}자 이내로 입력해 주세요.`;
  return null;
}
