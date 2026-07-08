// app/api/worker/site/current/route.ts
// 현재 배정된 Site 정보 조회 (업무일지 작성용)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { getWorkerPremiumStatus, getWorkerDocAccess } from "@/lib/planGuard";
import { getKstDateString } from "@/lib/time";
import { effectiveTrainingType } from "@/lib/serviceStep";

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const workerId = BigInt(session.workerId);
    // ⚠️ 서버는 UTC라 new Date()로 비교하면 KST 자정~09시 사이 하루 빠르게 잡혀
    //    "오늘 시작한 배정"이 미시작으로 제외됨(현장·훈련생 전부 빈값). KST 오늘로 비교.
    const todayStr = getKstDateString();
    const today = new Date(`${todayStr}T00:00:00.000Z`);

    // 멀티 현장: 클라가 선택 배정(assignmentId)을 주면 그걸 우선(소유·활성·기간 검증). 없으면 최신 1건.
    const reqAssignmentId = request.nextUrl.searchParams.get("assignmentId");
    let selAssignmentId: bigint | null = null;
    try { selAssignmentId = reqAssignmentId ? BigInt(reqAssignmentId) : null; } catch { selAssignmentId = null; }

    // 명시 배정(딥링크/쿠키)이면 종료(ENDED)여도 그 배정으로 — 과거문서 재제출·수정요청 딥링크가
    //  ENDED를 가리키므로 ACTIVE+오늘기간 필터를 걸면 siteInfo=null → 문서 카드/제출버튼이 안 뜨는 데드엔드.
    //  소유(workerId)+근무발생상태(generate/preview/buildDocPayload와 동일)만 검증. 미명시면 최신 활성.
    const assignment = await prisma.siteAssignment.findFirst({
      where: selAssignmentId != null
        ? { id: selAssignmentId, workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"] } }
        : {
            workerId,
            status: "ACTIVE",
            startDate: { lte: today },
            OR: [{ endDate: null }, { endDate: { gte: today } }],
          },
      include: {
        site: {
          include: {
            trainees: { where: { status: { in: ["TRAINING", "EMPLOYED"] } } },
            contacts: { where: { isActive: true }, select: { name: true, phoneNumber: true, email: true, role: true }, orderBy: { id: "asc" } },
          },
        },
        agency: true,
      },
      orderBy: { startDate: "desc" },
    });

    if (!assignment?.site) {
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." });
    }

    const site = assignment.site;
    const agency = assignment.agency;

    // 현장 담당자 전체(대표 사업체담당자 먼저, 이어서 활성 추가담당자) — 워커 표시용(읽기전용)
    const siteContacts = [
      ...(site.businessContactName
        ? [{
            name: site.businessContactName,
            phone: site.businessContactPhone ?? null,
            email: site.businessContactEmail ?? null,
            role: "대표",
            isPrimary: true,
          }]
        : []),
      ...(((site as any).contacts ?? []).map((c: any) => ({
        name: c.name,
        phone: c.phoneNumber ?? null,
        email: c.email ?? null,
        role: c.role ?? null,
        isPrimary: false,
      }))),
    ];

    // 배정 이후 독립적인 4개 조회는 병렬로(순차 round-trip 줄여 로딩 단축)
    const [todayAttendance, user, premiumStatus, docAccessStatus] = await Promise.all([
      // 오늘 출근 기록 (KST todayStr 재사용)
      prisma.dailyAttendance.findFirst({
        where: { workerId, assignmentId: assignment.id, workDate: todayStr },
        orderBy: { id: "desc" },
      }),
      // 직무지도원 정보
      prisma.worker.findUnique({
        where: { id: workerId },
        select: { workerName: true, phoneNumber: true, signatureUrl: true },
      }),
      getWorkerPremiumStatus(workerId),
      getWorkerDocAccess(workerId),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        siteId: site.id.toString(),
        assignmentId: assignment.id.toString(),
        agencyId: agency?.id.toString() ?? null,
        companyName: site.companyName,
        workType: assignment.workType || "FULL_DAY",
        commuteGuidanceIncluded: assignment.commuteGuidanceIncluded ?? true,
        customWorkStart: assignment.customWorkStart ?? null,
        customWorkEnd: assignment.customWorkEnd ?? null,
        attendanceButtonExempt: assignment.attendanceButtonExempt ?? false,
        traineeCount: site.trainees.length,
        trainees: site.trainees.map(t => ({
          id: t.id.toString(),
          name: t.name,
          gender: t.gender,
        })),
        agencyPlanType: agency?.planType ?? "FREE",
        trialEndsAt: agency?.trialEndsAt ?? null,
        // 계약 기반 유료기능 접근 (프론트 사전 게이트·안내 통일용)
        premiumAccess: premiumStatus.premium,
        premiumReason: premiumStatus.reason ?? null,
        premiumMessage: premiumStatus.message ?? null,
        // 문서·서명 접근(셀프등록 워커는 무료 허용 → premiumAccess와 별개)
        docAccess: docAccessStatus.allowed,
        // 이메일 발송용 추가 정보
        workerName: user?.workerName ?? "",
        workerPhone: user?.phoneNumber ?? "",
        signatureUrl: user?.signatureUrl ?? null,
        // 사업체 담당자(현장 담당자 단일 출처)
        managerName: site.businessContactName ?? "",
        managerEmail: site.businessContactEmail ?? "",
        managerPhone: site.businessContactPhone ?? "",
        // 사업체 담당자(현장 연락 담당자) — 출근부 '사업체담당자' 서명 프리필용
        businessContactName: site.businessContactName ?? "",
        businessContactPhone: site.businessContactPhone ?? "",
        // 현장 담당자 전체(대표+추가) — 워커 표시용
        siteContacts,
        fieldTrainingStart: assignment.startDate?.toISOString() ?? null,
        fieldTrainingEnd: assignment.endDate?.toISOString() ?? null,
        attendanceId: todayAttendance?.id?.toString() ?? null,
        // 훈련 단계(오늘 기준 — 전환일 지나면 적응지도)
        trainingType: effectiveTrainingType(assignment?.serviceStep, assignment?.adaptationStartDate, todayStr),
      },
    }, {
      // 브라우저가 과거(전환 전) 값을 캐시로 먼저 반환해 화면이 잠깐 옛 단계로 보이는 것 방지
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (error: any) {
    console.error("[worker/site/current]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
