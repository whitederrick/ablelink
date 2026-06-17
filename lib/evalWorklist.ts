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
  categoryScores: { name: string; weight: number; score: number }[] | null;
  sharedWithAgency: boolean;
  sentAt: string | null;
  respondedAt: string | null;
};

export type EvalWorklistResult = {
  items: EvalWorklistItem[];
  total: number;
  counts: { needs: number; requested: number; done: number };
};

// 서버 페이지네이션 + 검색 + 상태필터 + 상태별 카운트. 근무 종료=실근무 배정(ACTIVE/CONFIRMED/ENDED) 종료일 경과.
export async function getEvalWorklistPage(opts: {
  agencyId?: bigint; page?: number; pageSize?: number; q?: string; states?: string[];
}): Promise<EvalWorklistResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 10));
  const q = (opts.q ?? "").trim();
  const states = (opts.states ?? []).filter(s => ["needs", "requested", "done"].includes(s));

  const and: any[] = [];
  if (q) {
    and.push({ OR: [
      { user: { workerName: { contains: q, mode: "insensitive" } } },
      { user: { loginId: { contains: q, mode: "insensitive" } } },
      { site: { companyName: { contains: q, mode: "insensitive" } } },
      ...(opts.agencyId ? [] : [{ agency: { name: { contains: q, mode: "insensitive" } } }]),
    ] });
  }
  const baseWhere: any = {
    status: { in: ["ACTIVE", "CONFIRMED", "ENDED"] },
    endDate: { gte: windowStart, lt: now },
    ...(opts.agencyId ? { agencyId: opts.agencyId } : {}),
    ...(and.length ? { AND: and } : {}),
  };

  // 평가 상태별 배정 id 집합(기관 스코프) — 진행/완료 평가가 걸린 배정
  const svScope: any = opts.agencyId ? { agencyId: opts.agencyId } : {};
  const [pendingRows, respondedRows] = await Promise.all([
    prisma.satisfactionSurvey.findMany({ where: { ...svScope, status: "PENDING", NOT: { assignmentId: null } } as any, select: { assignmentId: true } as any }),
    prisma.satisfactionSurvey.findMany({ where: { ...svScope, status: "RESPONDED", NOT: { assignmentId: null } } as any, select: { assignmentId: true } as any }),
  ]);
  const pendingIds = [...new Set((pendingRows as any[]).map(r => String(r.assignmentId)))].map(s => BigInt(s));
  const respondedIds = [...new Set((respondedRows as any[]).map(r => String(r.assignmentId)))].map(s => BigInt(s));
  const reqResIds = [...pendingIds, ...respondedIds];
  const idFor = (st: string) => st === "needs" ? { notIn: reqResIds } : st === "requested" ? { in: pendingIds } : { in: respondedIds };

  const [cNeeds, cReq, cDone] = await Promise.all([
    prisma.siteAssignment.count({ where: { ...baseWhere, id: { notIn: reqResIds } } }),
    prisma.siteAssignment.count({ where: { ...baseWhere, id: { in: pendingIds } } }),
    prisma.siteAssignment.count({ where: { ...baseWhere, id: { in: respondedIds } } }),
  ]);

  const finalWhere: any = states.length ? { ...baseWhere, OR: states.map(st => ({ id: idFor(st) })) } : baseWhere;
  const total = await prisma.siteAssignment.count({ where: finalWhere });

  const rows = await prisma.siteAssignment.findMany({
    where: finalWhere,
    orderBy: { endDate: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true, agencyId: true, workerId: true, startDate: true, endDate: true,
      agency: { select: { name: true } },
      user: { select: { workerName: true, loginId: true } },
      site: { select: { companyName: true, businessContactName: true, businessContactPhone: true } },
    },
  });

  const pageIds = rows.map(r => r.id);
  const surveys = pageIds.length ? await prisma.satisfactionSurvey.findMany({
    where: { assignmentId: { in: pageIds } } as any,
    orderBy: { createdAt: "desc" },
    select: { id: true, assignmentId: true, status: true, auto: true, createdByManagerId: true, overallScore: true, totalScore: true, categoryScores: true, sharedWithAgency: true, sentAt: true, respondedAt: true } as any,
  }) : [];
  const byAsgn = new Map<string, any>();
  for (const s of surveys as any[]) { const k = String(s.assignmentId); if (s.assignmentId != null && !byAsgn.has(k)) byAsgn.set(k, s); }

  const items: EvalWorklistItem[] = rows.map(a => {
    const matched = byAsgn.get(String(a.id));
    const requestedBy = matched ? (matched.auto ? "AUTO" : matched.createdByManagerId ? "MANAGER" : "OPERATOR") : null;
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
      categoryScores: matched?.status === "RESPONDED" ? (matched.categoryScores ?? null) : null,
      sharedWithAgency: matched?.sharedWithAgency ?? false,
      sentAt: matched?.sentAt?.toISOString() ?? null,
      respondedAt: matched?.respondedAt?.toISOString() ?? null,
    };
  });

  return { items, total, counts: { needs: cNeeds, requested: cReq, done: cDone } };
}
