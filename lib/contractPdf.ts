// lib/contractPdf.ts
// EmploymentContract → 표준근로계약서 PDF payload 빌더 (관리자/직무지도원 조회 공용)
import { renderPdfToBuffer } from "@/lib/pdf";

function ymdK(d: Date | null | undefined): string {
  if (!d) return "";
  // 계약 일자는 "YYYY-MM-DD" 문자열로 저장(UTC 자정) → UTC 파트로 표기(타임존 드리프트 방지)
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

type ClauseSnap = { title: string; body: string };

export function buildContractPdfPayload(c: any) {
  const sc: ClauseSnap[] = Array.isArray(c.specialClauses) ? c.specialClauses : [];
  const signedDate: Date | null = c.workerSignedAt || c.adminSignedAt || c.createdAt || null;
  return {
    employerBizName: c.employerBizName || c.agency?.name || "",
    employerPhone: c.employerPhone || c.agency?.phoneNumber || "",
    employerAddress: c.employerAddress || c.agency?.address || "",
    employerRepName: c.employerRepName || "",
    workerName: c.user?.workerName || "",
    workerPhone: c.user?.phoneNumber || "",
    workerAddress: c.workerFilledAddress || c.workerAddress || "",
    contractStartText: ymdK(c.contractStart),
    contractEndText: ymdK(c.contractEnd),
    workLocation: c.workLocation || c.siteName || c.workerFilledSiteName || "",
    jobDescription: c.jobDescription || "",
    workStartTime: c.workStartTime,
    workEndTime: c.workEndTime,
    breakStartTime: c.breakStartTime,
    breakEndTime: c.breakEndTime,
    workDaysPerWeek: c.workDaysPerWeek,
    weeklyHoliday: c.weeklyHoliday,
    wageType: c.wageType,
    wageAmount: c.wageAmount,
    bonusExists: c.bonusExists,
    bonusAmount: c.bonusAmount,
    extraPayExists: c.extraPayExists,
    extraPayDesc: c.extraPayDesc,
    overtimeRate: c.overtimeRate,
    wagePayday: c.wagePayday,
    wagePayMethod: c.wagePayMethod,
    specialClauses: sc,
    dateText: ymdK(signedDate),
    signatures: {
      employer: { imageUrl: c.adminSignatureUrl || undefined },
      worker: { imageUrl: c.workerSignatureUrl || undefined },
    },
  };
}

export async function renderContractPdf(c: any): Promise<Buffer> {
  return renderPdfToBuffer({ documentType: "EMPLOYMENT_CONTRACT", payload: buildContractPdfPayload(c) });
}
