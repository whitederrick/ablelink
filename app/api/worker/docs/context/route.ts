// app/api/worker/docs/context/route.ts
// 문서조회/생성 화면용 경량 컨텍스트 — 서비스단계(trainingType) + 훈련생 목록만.
// site/current는 구독·문서접근·출근기록까지 조회해 무거우므로, 문서 화면 진입 지연을 줄이기 위해 분리.
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getKstDateString } from "@/lib/time";
import { effectiveTrainingType } from "@/lib/serviceStep";
import { resolveDocAssignment } from "@/lib/docs/resolveDocAssignment";

export async function GET(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

  const workerId = BigInt(session.workerId);
  const todayStr = getKstDateString();

  // 멀티현장: 클라가 선택 배정(assignmentId)을 주면 그 현장의 훈련생 목록(소유·활성·기간 검증). 없으면 최신 1건.
  let selAssignmentId: bigint | null = null;
  try { const raw = req.nextUrl.searchParams.get("assignmentId"); selAssignmentId = raw ? BigInt(raw) : null; } catch { selAssignmentId = null; }

  // 단일 쿼리: 배정 + 현장명 + 사업체담당자 + 훈련생.
  //  명시 배정(딥링크/쿠키)이면 종료(ENDED)여도 그 배정으로 — ACTIVE+오늘기간을 걸면 ENDED 딥링크가
  //  data:null이 돼 문서페이지 카드/제출버튼이 안 뜨는 데드엔드(generate/preview/site-current와 통일).
  //  소유(workerId)+근무발생상태만 검증. 미명시면 최신 활성.
  const selectCtx = {
    serviceStep: true,
    adaptationStartDate: true,
    agencyId: true,
    siteId: true,
    site: {
      select: {
        companyName: true,
        businessContactName: true,
        businessContactPhone: true,
        businessContactEmail: true,
        contacts: { where: { isActive: true }, select: { name: true, phoneNumber: true, email: true, role: true }, orderBy: { id: "asc" } },
        // ★훈련생 목록은 아래에서 배정 기관(agencyId)으로 스코프해 별도 조회 — site.trainees를 그대로 쓰면
        //  공유현장(같은 Site.id)에서 타 기관 훈련생 성명·성별(PII)이 노출된다(admin/docs/trainees와 동일 방어).
      },
    },
  } satisfies Prisma.SiteAssignmentSelect;
  // 배정 결정은 단일 출처(resolveDocAssignment)로 통일 — preview/generate/submit과 동일.
  const noStore = { headers: { "Cache-Control": "no-store" } };
  const resolved = await resolveDocAssignment(workerId, selAssignmentId, { select: selectCtx });
  if (resolved.status === "ambiguous") {
    // 활성 배정이 여러 개 + 유효 선택 없음 → 조용히 한 곳 고르지 않고, 화면이 현장 선택을 띄우도록 목록 반환.
    const sites = await prisma.siteAssignment.findMany({
      where: { workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
      orderBy: { assignedAt: "desc" },
      select: { id: true, site: { select: { companyName: true } } },
    });
    return NextResponse.json({ success: true, data: null, needsSiteSelection: true, sites: sites.map(s => ({ assignmentId: String(s.id), siteName: s.site?.companyName ?? "현장" })) }, noStore);
  }
  const assignment = resolved.status === "resolved" ? resolved.assignment : null;
  if (!assignment?.site) return NextResponse.json({ success: true, data: null }, noStore);

  // 훈련생 목록 — 배정 현장 + 배정 기관 소속 훈련생만(공유현장 타기관 PII 배제). null 기관이면 빈 목록(fail-closed).
  const scopedTrainees = assignment.agencyId
    ? await prisma.trainee.findMany({
        where: { currentSiteId: assignment.siteId, status: { in: ["TRAINING", "EMPLOYED"] }, site: { agencyId: assignment.agencyId } },
        select: { id: true, name: true, gender: true },
        orderBy: { id: "asc" },
      })
    : [];

  // 오늘 기준 단계(전환일 지나면 적응지도)
  const trainingType = effectiveTrainingType(assignment.serviceStep, assignment.adaptationStartDate, todayStr);

  // 현장 담당자 전체(대표 사업체담당자 먼저, 이어서 활성 추가담당자) — 워커 표시용(읽기전용)
  const siteContacts = [
    ...(assignment.site.businessContactName
      ? [{
          name: assignment.site.businessContactName,
          phone: assignment.site.businessContactPhone ?? null,
          email: assignment.site.businessContactEmail ?? null,
          role: "대표",
          isPrimary: true,
        }]
      : []),
    ...(((assignment.site as any).contacts ?? []).map((c: any) => ({
      name: c.name,
      phone: c.phoneNumber ?? null,
      email: c.email ?? null,
      role: c.role ?? null,
      isPrimary: false,
    }))),
  ];

  return NextResponse.json({
    success: true,
    data: {
      companyName: assignment.site.companyName,
      businessContactName: assignment.site.businessContactName ?? "",
      siteContacts,
      trainingType,
      trainees: scopedTrainees.map((t) => ({ id: t.id.toString(), name: t.name, gender: t.gender })),
    },
  }, noStore);
}
