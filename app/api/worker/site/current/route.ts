// app/api/worker/site/current/route.ts
// 현재 배정된 Site 정보 조회 (업무일지 작성용)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getWorkerSessionFromReq, WK_ACTIVE_ASSIGNMENT_COOKIE } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { getWorkerPremiumStatus, getWorkerDocAccess } from "@/lib/planGuard";
import { getKstDateString } from "@/lib/time";
import { effectiveTrainingType } from "@/lib/serviceStep";
import { resolveWorkerAssignment } from "@/lib/worker/assignmentResolve";

// 응답 헤더 조립. rewriteCookieId가 있으면 낡은 선택배정 쿠키를 해석된 활성 배정으로 되써
//  모든 쿠키 소비처(일지·홈·캘린더·근태)가 같은 배정으로 수렴하게 한다(ENDED 고착 근본 차단).
function buildHeaders(rewriteCookieId: string | null): Record<string, string> {
  const headers: Record<string, string> = { "Cache-Control": "no-store, must-revalidate" };
  if (rewriteCookieId) {
    const maxAge = 60 * 60 * 24 * 90; // 쿠키 수명 = 세션과 동일(90일)
    headers["Set-Cookie"] = `${WK_ACTIVE_ASSIGNMENT_COOKIE}=${rewriteCookieId}; path=/; max-age=${maxAge}; samesite=lax`;
  }
  return headers;
}

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

    // 멀티 현장: 쿠키/딥링크로 온 assignmentId를 컨텍스트에 맞게 해석(lib/worker/assignmentResolve).
    //  - 일지류(worklog/logs/signature/batch, allowEnded 미전달): 오늘 활성만. 낡은 쿠키가 ENDED/미래를
    //    가리키면 최신 활성으로 폴백(종료 현장 고착 데드엔드·오귀속 방지) 후 쿠키를 되써 수렴시킨다.
    //  - 과거문서(docs, allowEnded=1): 명시 id면 ENDED 허용(과거 출근부/일지 재제출·수정요청 딥링크).
    const reqAssignmentId = request.nextUrl.searchParams.get("assignmentId");
    const allowEnded = request.nextUrl.searchParams.get("allowEnded") === "1";

    const assignmentInclude = {
      site: {
        include: {
          trainees: { where: { status: { in: ["TRAINING", "EMPLOYED"] } } },
          contacts: { where: { isActive: true }, select: { name: true, phoneNumber: true, email: true, role: true }, orderBy: { id: "asc" } },
        },
      },
      agency: true,
    } satisfies Prisma.SiteAssignmentInclude;

    // 워커 소유 배정 후보(라이트) — 해석용. KST 문자열로 정규화해 순수 로직에 위임.
    const candidates = await prisma.siteAssignment.findMany({
      where: { workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"] } },
      select: { id: true, status: true, startDate: true, endDate: true },
    });
    const resolved = resolveWorkerAssignment({
      requestedId: reqAssignmentId,
      allowEnded,
      assignments: candidates.map((c) => ({
        id: c.id.toString(),
        status: c.status,
        startDate: getKstDateString(c.startDate),
        endDate: c.endDate ? getKstDateString(c.endDate) : null,
      })),
      todayStr,
    });

    if (!resolved.assignmentId) {
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." });
    }

    const assignment = await prisma.siteAssignment.findFirst({
      where: { id: BigInt(resolved.assignmentId), workerId },
      include: assignmentInclude,
    });

    if (!assignment?.site) {
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." });
    }

    const site = assignment.site;
    const agency = assignment.agency;

    // 공유(divergent) 현장 크로스테넌트 PII 차단(2026-07-21 감사 P2): 훈련생은 배정 기관(assignment.agencyId)이
    //  현장 소유 기관(site.agencyId)과 일치할 때만 노출한다. 불일치·null이면 빈 목록(fail-closed) — worker/docs/context와
    //  동일 정책. 같은 Site.id를 두 기관이 공유하면 타 기관 훈련생 성명·성별(장애인 PII)이 섞여 나올 수 있으므로.
    const scopedTrainees = assignment.agencyId != null && site.agencyId === assignment.agencyId
      ? (site.trainees ?? [])
      : [];

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
        // 파일럿 배정이면 문서 화면이 '위탁기관 최종 제출' 대신 PDF 생성·다운로드 동선을 보인다(v1.8 §8).
        //  ★차단의 본체는 서버(worker/docs/submit 403)다. 이 값은 안내일 뿐이라 없어도 제출은 막힌다.
        isPilot: assignment.pilotSessionId != null,
        workType: assignment.workType || "FULL_DAY",
        commuteGuidanceIncluded: assignment.commuteGuidanceIncluded ?? true,
        customWorkStart: assignment.customWorkStart ?? null,
        customWorkEnd: assignment.customWorkEnd ?? null,
        attendanceButtonExempt: assignment.attendanceButtonExempt ?? false,
        traineeCount: scopedTrainees.length,
        trainees: scopedTrainees.map(t => ({
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
      headers: buildHeaders(resolved.usedFallback ? resolved.assignmentId : null),
    });
  } catch (error: any) {
    console.error("[worker/site/current]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
