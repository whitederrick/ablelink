// app/manager/_components/StatusBadge.tsx
// 매니저 콘솔 공통 상태 뱃지 — 상태값→라벨·색을 단일 매핑으로 통일(화면별 색감 제각각 방지).
"use client";

import { T } from "../_styles";

export type BadgeTone = "amber" | "sky" | "emerald" | "rose" | "violet" | "slate";

const TONE_CLS: Record<BadgeTone, string> = {
  amber:   "bg-amber-50 text-amber-600",
  sky:     "bg-sky-50 text-sky-600",
  emerald: "bg-emerald-50 text-emerald-600",
  rose:    "bg-rose-50 text-rose-600",
  violet:  "bg-violet-50 text-violet-600",
  slate:   "bg-slate-100 text-slate-500",
};

// 자주 쓰는 상태값 기본 매핑(공통). 화면별 커스텀은 map prop으로 덮어쓴다.
const DEFAULT_MAP: Record<string, { label: string; tone: BadgeTone }> = {
  // 승인/처리 워크플로
  PENDING:    { label: "대기",     tone: "amber" },
  APPROVED:   { label: "승인",     tone: "emerald" },
  REJECTED:   { label: "반려",     tone: "rose" },
  COMPLETED:  { label: "완료",     tone: "emerald" },
  CANCELLED:  { label: "취소",     tone: "slate" },
  CLOSED:     { label: "종료",     tone: "slate" },
  IN_PROGRESS:{ label: "진행중",   tone: "sky" },
  OPEN:       { label: "열림",     tone: "sky" },
  // 공지/알림 심각도
  URGENT:     { label: "긴급",     tone: "rose" },
  WARN:       { label: "주의",     tone: "amber" },
  INFO:       { label: "안내",     tone: "sky" },
  // 근태
  WORKING:    { label: "근무중",   tone: "sky" },
  DONE:       { label: "마감중",   tone: "amber" },
  ABSENT:     { label: "결근",     tone: "rose" },
};

export default function StatusBadge({
  status,
  map,
  className = "",
}: {
  status: string;
  map?: Record<string, { label: string; tone: BadgeTone }>;
  className?: string;
}) {
  const m = (map?.[status] ?? DEFAULT_MAP[status]) ?? { label: status, tone: "slate" as BadgeTone };
  return <span className={`${T.badge} ${TONE_CLS[m.tone]} ${className}`}>{m.label}</span>;
}
