// 위탁기관 관리자: 훈련생 수정 / 상태 변경
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { syncPlacementForStatus } from "@/lib/traineePlacement";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope    = await requireManagerSession(req);
    const agencyId = scope.agencyId;

    const { id } = await params;
    const body = await req.json();
    const { name, gender, birthDate, phoneNumber, guardianPhoneNumber, guardianPhoneNumber2,
            disabilityType, severity, status, note } = body;

    const trainee = await prisma.trainee.findUnique({
      where: { id: BigInt(id) },
      include: { site: { select: { agencyId: true } } },
    });
    if (!trainee || trainee.site?.agencyId !== agencyId)
      return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });

    const updateData: any = {};
    if (name !== undefined)                updateData.name                = name.trim();
    if (gender !== undefined)              updateData.gender              = gender;
    if (birthDate !== undefined)           updateData.birthDate           = birthDate || null;
    if (phoneNumber !== undefined)         updateData.phoneNumber         = phoneNumber || null;
    if (guardianPhoneNumber !== undefined)  updateData.guardianPhoneNumber  = guardianPhoneNumber || null;
    if (guardianPhoneNumber2 !== undefined) updateData.guardianPhoneNumber2 = guardianPhoneNumber2 || null;
    if (disabilityType !== undefined)      updateData.disabilityType      = disabilityType;
    if (severity !== undefined)            updateData.severity            = severity;
    if (note !== undefined)                updateData.note                = note?.trim() || null;
    const now = new Date();
    if (status !== undefined) {
      updateData.status = status;
      // 재적(TRAINING/EMPLOYED)이 아니면 이탈 시각 기록
      if (status !== "TRAINING" && status !== "EMPLOYED") updateData.leftAt = now;
    }

    // 훈련생 수정 + (상태 변경 시) 현장배치 이력 동기화 — 급여/출근부/목록/캘린더 근거 유지
    await prisma.$transaction(async (tx) => {
      await tx.trainee.update({ where: { id: trainee.id }, data: updateData });
      if (status !== undefined) {
        await syncPlacementForStatus(tx, trainee.id, status, trainee.currentSiteId, now);
      }
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
