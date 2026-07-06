// app/api/worker/docs/context/route.ts
// 문서조회/생성 화면용 경량 컨텍스트 — 서비스단계(trainingType) + 훈련생 목록만.
// site/current는 구독·문서접근·출근기록까지 조회해 무거우므로, 문서 화면 진입 지연을 줄이기 위해 분리.
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";
import { effectiveTrainingType } from "@/lib/serviceStep";

export async function GET(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

  const workerId = BigInt(session.workerId);
  const todayStr = getKstDateString();
  const today = new Date(`${todayStr}T00:00:00.000Z`);

  // 멀티현장: 클라가 선택 배정(assignmentId)을 주면 그 현장의 훈련생 목록(소유·활성·기간 검증). 없으면 최신 1건.
  let selAssignmentId: bigint | null = null;
  try { const raw = req.nextUrl.searchParams.get("assignmentId"); selAssignmentId = raw ? BigInt(raw) : null; } catch { selAssignmentId = null; }

  // 단일 쿼리: 배정 + 현장명 + 사업체담당자 + 훈련생.
  //  명시 배정(딥링크/쿠키)이면 종료(ENDED)여도 그 배정으로 — ACTIVE+오늘기간을 걸면 ENDED 딥링크가
  //  data:null이 돼 문서페이지 카드/제출버튼이 안 뜨는 데드엔드(generate/preview/site-current와 통일).
  //  소유(workerId)+근무발생상태만 검증. 미명시면 최신 활성.
  const assignment = await prisma.siteAssignment.findFirst({
    where: selAssignmentId != null
      ? { id: selAssignmentId, workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"] } }
      : {
          workerId,
          status: "ACTIVE",
          startDate: { lte: today },
          OR: [{ endDate: null }, { endDate: { gte: today } }],
        },
    select: {
      serviceStep: true,
      adaptationStartDate: true,
      site: {
        select: {
          companyName: true,
          businessContactName: true,
          businessContactPhone: true,
          businessContactEmail: true,
          contacts: { where: { isActive: true }, select: { name: true, phoneNumber: true, email: true, role: true }, orderBy: { id: "asc" } },
          trainees: { where: { status: { in: ["TRAINING", "EMPLOYED"] } }, select: { id: true, name: true, gender: true } },
        },
      },
    },
    orderBy: { startDate: "desc" },
  });

  const noStore = { headers: { "Cache-Control": "no-store" } };
  if (!assignment?.site) return NextResponse.json({ success: true, data: null }, noStore);

  // 오늘 기준 단계(전환일 지나면 적응지도)
  const trainingType = effectiveTrainingType(assignment.serviceStep, (assignment as any).adaptationStartDate, todayStr);

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
      trainees: assignment.site.trainees.map((t) => ({ id: t.id.toString(), name: t.name, gender: t.gender })),
    },
  }, noStore);
}
