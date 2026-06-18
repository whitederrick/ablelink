// app/api/admin/worker-accounts/[id]/route.ts
// 직무지도원 관리 상세 — 인적 정보 + 급여계좌 + 현재/과거 계약(배정) 이력 + 만족도 평가 결과.
// 정보 수정(이름·전화·급여계좌·임시비번)은 기존 PATCH /api/admin/workers/[id]를 재사용한다.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { AssignStatus } from "@prisma/client";

const ACTIVE_ASSIGN: AssignStatus[] = [AssignStatus.ACTIVE, AssignStatus.ASSIGNED, AssignStatus.CONFIRMED];

// 자기 위탁기관 소속(배정 이력) 직무지도원인지 확인
async function assertAgencyWorker(workerId: bigint, agencyId: bigint) {
  const worker = await prisma.worker.findFirst({
    where: { id: workerId, assignments: { some: { site: { agencyId } } } },
    select: { id: true },
  });
  return !!worker;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    const { id } = await params;
    let workerId: bigint;
    try { workerId = BigInt(id); } catch { return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 }); }

    if (!(await assertAgencyWorker(workerId, agencyId))) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    const w = await prisma.worker.findUnique({
      where: { id: workerId },
      select: {
        id: true, loginId: true, workerName: true, phoneNumber: true, birthDate: true, status: true, createdAt: true,
        bankName: true, accountNumber: true, accountHolder: true,
        accountVerifiedAt: true, accountHolderVerified: true,
        identityVerifiedAt: true, identityMethod: true,
      },
    });
    if (!w) return NextResponse.json({ success: false, message: "직무지도원을 찾을 수 없습니다." }, { status: 404 });

    // 계약(배정) 이력 — 본 위탁기관 현장만, 최신순
    const assignments = await prisma.siteAssignment.findMany({
      where: { workerId, site: { agencyId } },
      orderBy: { startDate: "desc" },
      select: {
        id: true, status: true, startDate: true, endDate: true,
        workType: true, serviceStep: true, site: { select: { companyName: true } },
      },
    });

    // 만족도 평가 — 점수/코멘트는 운영자 전달(sharedWithAgency) 시에만 노출
    const surveys = await prisma.satisfactionSurvey.findMany({
      where: { workerId, agencyId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, siteName: true, status: true, overallScore: true, comment: true,
        scores: true, sharedWithAgency: true, respondedAt: true, createdAt: true,
        totalScore: true, categoryScores: true,
      } as any,
    });

    return NextResponse.json({
      success: true,
      data: {
        account: {
          id: String(w.id),
          loginId: w.loginId,
          workerName: w.workerName,
          phoneNumber: w.phoneNumber,
          birthDate: w.birthDate ?? null,
          status: String(w.status),
          createdAt: w.createdAt.toISOString(),
          bankName: w.bankName ?? null,
          accountNumber: w.accountNumber ?? null,
          accountHolder: w.accountHolder ?? null,
          accountVerifiedAt: w.accountVerifiedAt ? w.accountVerifiedAt.toISOString() : null,
          accountHolderVerified: w.accountHolderVerified ?? null,
          identityVerifiedAt: w.identityVerifiedAt ? w.identityVerifiedAt.toISOString() : null,
          identityMethod: w.identityMethod ?? null,
        },
        assignments: assignments.map((a) => ({
          id: String(a.id),
          siteName: a.site?.companyName ?? "-",
          status: String(a.status),
          startDate: a.startDate.toISOString(),
          endDate: a.endDate ? a.endDate.toISOString() : null,
          workType: a.workType ?? null,
          serviceStep: String(a.serviceStep),
          active: ACTIVE_ASSIGN.includes(a.status),
        })),
        surveys: surveys.map((s: any) => {
          // 역량 평가표 결과는 위탁기관에 '총점+카테고리'만 노출. 문항 답안·의견은 운영자 전용.
          const isRubric = s.totalScore != null || s.categoryScores != null;
          const shared = s.sharedWithAgency;
          return {
            id: String(s.id),
            siteName: s.siteName ?? null,
            status: String(s.status),
            respondedAt: s.respondedAt ? s.respondedAt.toISOString() : null,
            createdAt: s.createdAt.toISOString(),
            sharedWithAgency: shared,
            isRubric,
            totalScore: shared ? (s.totalScore ?? null) : null,
            categoryScores: shared ? (s.categoryScores ?? null) : null,
            // 레거시(평가표 미연결)만 종합 별점·문항·코멘트 노출, 평가표 결과는 차단
            overallScore: shared && !isRubric ? s.overallScore : null,
            comment: shared && !isRubric ? s.comment : null,
            scores: shared && !isRubric ? (s.scores ?? null) : null,
          };
        }),
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[worker-accounts/[id] GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
