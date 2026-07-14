// lib/serviceStep.ts
// 단일 배정 내 '지원고용 훈련 → 적응지도' 전환 처리 공용 헬퍼. (2026-06-14)
// adaptationStartDate(전환일)가 설정된 배정은, 기준일(refDate)이 전환일 이상이면 적응지도로 간주한다.
// 전환일이 없으면 배정의 serviceStep을 그대로 사용(단건).

export type TrainingType = "PRE" | "FIELD" | "ADAPTATION";

// KST 기준 날짜 문자열(YYYY-MM-DD)로 정규화. Date·ISO·"YYYY-MM-DD" 모두 허용.
function toKstDateStr(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d; // 이미 날짜 문자열
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return null;
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 기준일 시점의 실효 serviceStep. 전환일 이상이면 ADAPTATION, 그 전이면 기존 serviceStep.
export function effectiveServiceStep(
  serviceStep: string | null | undefined,
  adaptationStartDate: Date | string | null | undefined,
  refDate: Date | string,
): string {
  const base = serviceStep ?? "FIELD_TRAINING";
  const split = toKstDateStr(adaptationStartDate);
  if (!split) return base;
  const ref = toKstDateStr(refDate);
  if (!ref) return base;
  // 전환일 전에는 배정의 기존 serviceStep(base)을 그대로 반영한다. FIELD_TRAINING을 하드코딩하면
  //  serviceStep=PRE_TRAINING(또는 ADAPTATION)인 배정이 전환일 전 구간에 FIELD로 오분류된다(일지·문서 분류 오염).
  return ref >= split ? "ADAPTATION" : base;
}

export function serviceStepToTrainingType(step: string | null | undefined): TrainingType {
  return step === "PRE_TRAINING" ? "PRE" : step === "ADAPTATION" ? "ADAPTATION" : "FIELD";
}

// 편의: 기준일 시점의 trainingType 직접 계산.
export function effectiveTrainingType(
  serviceStep: string | null | undefined,
  adaptationStartDate: Date | string | null | undefined,
  refDate: Date | string,
): TrainingType {
  return serviceStepToTrainingType(effectiveServiceStep(serviceStep, adaptationStartDate, refDate));
}
