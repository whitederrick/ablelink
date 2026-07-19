// app/api/admin/docs/trainees/route.ts
// 직무지도원의 담당 훈련생 목록 조회
// Trainee.currentSiteId + TraineePlacement 양쪽 모두 조회

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);
    const { searchParams } = new URL(request.url);
    const workerIdRaw = searchParams.get("workerId") ?? "";
    if (!workerIdRaw || !/^[0-9]+$/.test(workerIdRaw)) return NextResponse.json({ success: false, message: "workerId 필요" }, { status: 400 });

    const workerId = BigInt(workerIdRaw);

    // 직무지도원의 현장 배정 — 멀티현장은 assignmentId로 현장 지정(preview C2와 동일 패턴).
    //  지정 배정도 workerId+agencyId 스코프 안에서만 조회(타기관/타워커 배정 지정 불가). 미지정=최신 배정(무회귀).
    const assignmentIdRaw = searchParams.get("assignmentId");
    const assignmentId = assignmentIdRaw && /^[0-9]+$/.test(assignmentIdRaw) ? BigInt(assignmentIdRaw) : null;
    const assignment = await prisma.siteAssignment.findFirst({
      where: { workerId, status: { in: ["ASSIGNED","CONFIRMED","ACTIVE"] }, agencyId: scope.agencyId, ...(assignmentId ? { id: assignmentId } : {}) },
      select: { siteId: true },
      orderBy: { assignedAt: "desc" },
    });

    if (!assignment) return NextResponse.json({ success: true, trainees: [] });

    const siteId = assignment.siteId;

    // 방법 1: Trainee.currentSiteId 기반
    const byCurrentSite = await prisma.trainee.findMany({
      where: { currentSiteId: siteId, status: { in: ["TRAINING","EMPLOYED"] } },
      select: { id: true, name: true, gender: true },
    });

    // 방법 2: TraineePlacement 기반 (중복 제거용 id 수집)
    const placements = await prisma.traineePlacement.findMany({
      where: { siteId, status: "ACTIVE" },
      include: { trainee: { select: { id: true, name: true, gender: true, status: true } } },
    });
    const byPlacement = placements
      .filter(p => p.trainee.status === "TRAINING" || p.trainee.status === "EMPLOYED")
      .map(p => p.trainee);

    // 두 결과 합치고 중복 제거
    const allMap = new Map<string, { id: string; name: string; gender: string }>();
    [...byCurrentSite, ...byPlacement].forEach(t => {
      allMap.set(String(t.id), { id: String(t.id), name: t.name, gender: t.gender });
    });

    return NextResponse.json({ success: true, trainees: Array.from(allMap.values()) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/docs/trainees]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}