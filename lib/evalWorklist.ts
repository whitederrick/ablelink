// lib/evalWorklist.ts
// 직무지도원 평가 워크리스트 — '근무 종료 = 배정 종료'된 직무지도원(현장 근무 단위) × 평가요청 상태.
//  · 평가는 '종료 배정(assignmentId)'에 1건만 묶임 → 배정 관리·만족도 평가·운영자 화면이 같은 키로 상태 공유(자동 동기화·중복 차단).
//  · 1 근로계약(예: 6개월)에 현장 2곳 = 배정 2건 = 평가 2건. 배정이 계약보다 먼저 끝나도 그 시점에 평가 대상.
//  · 매니저(본 기관): agencyId 지정 / 운영자(전체): agencyId 미지정.
import { prisma } from "@/lib/prisma";

const WINDOW_DAYS = 180; // 너무 오래된 배정 제외(목록 경량화)

export type EvalRequestStatus = "NONE" | "PENDING" | "RESPONDED" | "EXPIRED" | "CANCELLED";

export type EvalWorklistItem = {
  assignmentId: string;
  agencyId: string;
  agencyName: string;
  workerId: string;
  workerName: string;
  workerLoginId: string;
  siteName: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  hasContact: boolean;
  startDate: string;
  endDate: string;       // 배정(현장 근무) 종료일 = 근무 종료 기준
  requestStatus: EvalRequestStatus;
  requestedBy: "AUTO" | "MANAGER" | "OPERATOR" | null;
  surveyId: string | null;
  totalScore: number | null;
  overallScore: number | null;
  sharedWithAgency: boolean;
  sentAt: string | null;
  respondedAt: string | null;
};

export async function getEvalWorklist(opts: { agencyId?: bigint } = {}): Promise<EvalWorklistItem[]> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // 근무 종료 = 실근무 배정(ACTIVE/CONFIRMED/ENDED)의 종료일 경과
  const assignments = await prisma.siteAssignment.findMany({
    where: {
      status: { in: ["ACTIVE", "CONFIRMED", "ENDED"] },
      endDate: { gte: windowStart, lt: now },
      ...(opts.agencyId ? { agencyId: opts.agencyId } : {}),
    },
    orderBy: { endDate: "desc" },
    take: 500,
    select: {
      id: true, agencyId: true, workerId: true, startDate: true, endDate: true,
      agency: { select: { name: true } },
      user: { select: { workerName: true, loginId: true } },
      site: { select: { companyName: true, businessContactName: true, businessContactPhone: true } },
    },
  });
  if (assignments.length === 0) return [];

  const asgnIds = assignments.map(a => a.id);
  const surveys = await prisma.satisfactionSurvey.findMany({
    where: { assignmentId: { in: asgnIds } } as any,
    orderBy: { createdAt: "desc" },
    select: {
      id: true, assignmentId: true, status: true, auto: true, createdByManagerId: true,
      overallScore: true, totalScore: true, sharedWithAgency: true, sentAt: true, respondedAt: true,
    } as any,
  });
  const surveyByAsgn = new Map<string, any>();
  for (const s of surveys as any[]) {
    const k = String(s.assignmentId);
    if (s.assignmentId != null && !surveyByAsgn.has(k)) surveyByAsgn.set(k, s);
  }

  return assignments.map(a => {
    const matched = surveyByAsgn.get(String(a.id));
    const requestedBy = matched
      ? (matched.auto ? "AUTO" : matched.createdByManagerId ? "MANAGER" : "OPERATOR")
      : null;
    return {
      assignmentId: String(a.id),
      agencyId: String(a.agencyId),
      agencyName: a.agency?.name ?? "",
      workerId: String(a.workerId),
      workerName: a.user?.workerName ?? "",
      workerLoginId: a.user?.loginId ?? "",
      siteName: a.site?.companyName ?? null,
      recipientName: a.site?.businessContactName ?? null,
      recipientPhone: a.site?.businessContactPhone ?? null,
      hasContact: !!a.site?.businessContactPhone,
      startDate: a.startDate.toISOString().slice(0, 10),
      endDate: a.endDate!.toISOString().slice(0, 10),
      requestStatus: (matched?.status ?? "NONE") as EvalRequestStatus,
      requestedBy: requestedBy as any,
      surveyId: matched ? String(matched.id) : null,
      totalScore: matched?.status === "RESPONDED" ? (matched.totalScore ?? null) : null,
      overallScore: matched?.status === "RESPONDED" ? (matched.overallScore ?? null) : null,
      sharedWithAgency: matched?.sharedWithAgency ?? false,
      sentAt: matched?.sentAt?.toISOString() ?? null,
      respondedAt: matched?.respondedAt?.toISOString() ?? null,
    };
  });
}
