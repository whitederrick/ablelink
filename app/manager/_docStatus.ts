// 일지(문서) 제출 상태 — 서명 워크플로(signStage) + 공단 제출(govStatus·발송횟수)을 하나의 축으로 세분화.
import type { BadgeTone } from "./_components/StatusBadge";

export type DocSubmitKey =
  | "WORKER_DRAFTING"   // 직무지도원 작성중
  | "WORKER_SUBMITTED"  // 직무지도원 제출 완료(서명+제출)
  | "AGENCY_CONFIRMED"  // 위탁기관 담당자 확정 완료
  | "AGENCY_SIGNED"     // 위탁기관 담당자 서명 완료
  | "CHANGES_REQUESTED" // 위탁기관 수정요청
  | "GOV_RESUBMIT"      // 공단 재제출 요구
  | "GOV_SUBMITTED"     // 공단 제출 완료(1차 발송)
  | "GOV_RESUBMITTED";  // 공단 수정 제출 완료(2차 이상 발송)

export function docSubmitStatus(p: {
  signStage: string; govStatus: string; govSubmitCount?: number | null;
}): DocSubmitKey {
  // 공단 발송이 완료되면 서명 단계는 이미 끝난 상태 → 공단 제출 상태를 우선 표기
  if (p.govStatus === "SUBMITTED") {
    return (p.govSubmitCount ?? 0) >= 2 ? "GOV_RESUBMITTED" : "GOV_SUBMITTED";
  }
  if (p.govStatus === "RESUBMIT") return "GOV_RESUBMIT";
  switch (p.signStage) {
    case "MANAGER_SIGNED":   return "AGENCY_SIGNED";
    case "CONFIRMED":        return "AGENCY_CONFIRMED";
    case "CHANGES_REQUESTED":return "CHANGES_REQUESTED";
    case "SUBMITTED":        return "WORKER_SUBMITTED";
    default:                 return "WORKER_DRAFTING"; // DRAFT 등
  }
}

export const DOC_SUBMIT_BADGE: Record<DocSubmitKey, { label: string; tone: BadgeTone }> = {
  WORKER_DRAFTING:   { label: "직무지도원 작성중",        tone: "slate" },
  WORKER_SUBMITTED:  { label: "직무지도원 제출 완료",      tone: "amber" },
  AGENCY_CONFIRMED:  { label: "위탁기관 담당자 확정 완료", tone: "sky" },
  AGENCY_SIGNED:     { label: "위탁기관 담당자 서명 완료", tone: "violet" },
  CHANGES_REQUESTED: { label: "수정요청",                tone: "rose" },
  GOV_RESUBMIT:      { label: "공단 재제출 요구",         tone: "rose" },
  GOV_SUBMITTED:     { label: "공단 제출 완료",           tone: "emerald" },
  GOV_RESUBMITTED:   { label: "공단 수정 제출 완료",       tone: "emerald" },
};
