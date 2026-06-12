// lib/docs/requiredSignatures.ts
// 문서별 필수 서명 매트릭스(공식 양식 기준) — 제출 게이트(직무지도원→매니저)와
// 발송 게이트(매니저→공단)에서 공용으로 사용.
//  - 직무지도원: 모든 문서 필수 (프로필 등록 서명)
//  - 사업체 담당자: 출근부·훈련일지만 필수 (양식에 서명칸 존재)
//  - 매니저: 모든 문서 필수 (일지 관리의 명시적 서명 액션)
// 키는 Prisma DocumentType enum 기준. (PDF docType은 PDF_TO_PRISMA_DOCTYPE로 변환해 조회)

export interface SigRequirement {
  worker: boolean;
  companyManager: boolean;
  manager: boolean;
}

export const SIG_REQUIREMENTS: Record<string, SigRequirement> = {
  ATTENDANCE_SHEET:              { worker: true,  companyManager: true,  manager: true },
  TRAINING_DAILY_LOG:           { worker: true,  companyManager: true,  manager: true },
  POST_EMPLOY_ADAPT_LOG:        { worker: true,  companyManager: false, manager: true },
  TRAINEE_COMPREHENSIVE_EVAL:   { worker: true,  companyManager: false, manager: true },
  ADAPTATION_COMPREHENSIVE_EVAL:{ worker: true,  companyManager: false, manager: true },
  CHECKLIST:                    { worker: false, companyManager: false, manager: false },
};

export const SIG_LABEL: Record<keyof SigRequirement, string> = {
  worker: "직무지도원",
  companyManager: "사업체 담당자",
  manager: "매니저",
};

export function sigRequirement(docTypePrisma: string): SigRequirement {
  return SIG_REQUIREMENTS[docTypePrisma] ?? { worker: true, companyManager: false, manager: true };
}

/**
 * 스냅샷 payload + run의 매니저 서명으로 "누락된 필수 서명" 라벨 목록을 계산.
 * - worker/companyManager 는 스냅샷 sourceData.signatures.*.imageUrl 로 판정.
 * - manager 는 run.managerSignatureUrl(명시 sign 액션 결과)로 판정.
 */
export function missingSignatureLabels(
  docTypePrisma: string,
  sourceData: any,
  managerSignatureUrl: string | null | undefined,
): string[] {
  const req = sigRequirement(docTypePrisma);
  const sigs = sourceData?.signatures ?? {};
  const lacks: string[] = [];
  if (req.worker && !sigs?.worker?.imageUrl) lacks.push(SIG_LABEL.worker);
  if (req.companyManager && !sigs?.companyManager?.imageUrl) lacks.push(SIG_LABEL.companyManager);
  if (req.manager && !managerSignatureUrl) lacks.push(SIG_LABEL.manager);
  return lacks;
}
