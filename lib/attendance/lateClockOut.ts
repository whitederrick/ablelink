// lib/attendance/lateClockOut.ts
// 퇴근 미실행(어제 이전 퇴근 안 누른 날) → 직무지도원이 늦게 처리할 때 입력하는 '사유'.
// 직무지도원 모달·매니저 조회·감사기록에서 공용으로 쓰는 코드/라벨 정의.

export type LateClockOutReasonCode =
  | "FORGOT"
  | "APP_ERROR"
  | "DEVICE_ISSUE"
  | "LEFT_SITE"
  | "OTHER";

export const LATE_CLOCK_OUT_REASONS: { code: LateClockOutReasonCode; label: string }[] = [
  { code: "FORGOT",       label: "퇴근 등록을 잊어버림" },
  { code: "APP_ERROR",    label: "앱 오류" },
  { code: "DEVICE_ISSUE", label: "단말기 이슈" },
  { code: "LEFT_SITE",    label: "현장 이탈(미복귀)" },
  { code: "OTHER",        label: "기타" },
];

const LABEL_BY_CODE: Record<string, string> = Object.fromEntries(
  LATE_CLOCK_OUT_REASONS.map((r) => [r.code, r.label]),
);

export function isLateClockOutReasonCode(v: unknown): v is LateClockOutReasonCode {
  return typeof v === "string" && v in LABEL_BY_CODE;
}

/** 코드 → 한글 라벨. 기타이거나 자유입력이 있으면 합쳐서 표기. */
export function lateClockOutReasonLabel(
  code: string | null | undefined,
  text?: string | null,
): string {
  if (!code) return "";
  const base = LABEL_BY_CODE[code] ?? code;
  const t = (text ?? "").trim();
  if (!t) return base;
  // OTHER는 라벨 대신 자유입력만, 그 외는 "라벨 — 자유입력"
  return code === "OTHER" ? t : `${base} — ${t}`;
}
