// 파일럿 화면 공용 상수.
// ★page.tsx에서 export하면 안 된다 — Next.js App Router는 page 모듈의 export를
//  default·metadata 등으로 제한하므로 타입 검사에서 깨진다(실제로 깨졌다).

export const PILOT_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT:     { label: "설정 중",   cls: "bg-slate-100 text-slate-600" },
  READY:     { label: "참여 대기", cls: "bg-amber-50 text-amber-700" },
  ACTIVE:    { label: "진행 중",   cls: "bg-emerald-50 text-emerald-700" },
  ENDED:     { label: "종료",      cls: "bg-sky-50 text-sky-700" },
  PURGED:    { label: "폐기 완료", cls: "bg-slate-100 text-slate-500" },
  CANCELLED: { label: "취소",      cls: "bg-rose-50 text-rose-600" },
};

export const PARTICIPANT_STATUS: Record<string, { label: string; cls: string }> = {
  CONFIGURED: { label: "설정됨",  cls: "bg-slate-100 text-slate-600" },
  INVITED:    { label: "초대됨",  cls: "bg-amber-50 text-amber-700" },
  ACCEPTED:   { label: "참여 중", cls: "bg-emerald-50 text-emerald-700" },
  CANCELLED:  { label: "취소",    cls: "bg-rose-50 text-rose-600" },
};

export const WORK_TYPES = [
  { value: "AM", label: "오전 4시간" },
  { value: "PM", label: "오후 4시간" },
  { value: "FULL_DAY", label: "전일 8시간" },
];

export const SERVICE_STEPS = [
  { value: "FIELD_TRAINING", label: "지원고용 훈련" },
  { value: "ADAPTATION", label: "적응지도" },
];
