// 에이전시 관리자: 훈련생 수정 / 상태 변경
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope    = await requireManagerSession(req);
    const agencyId = scope.agencyId;

    const { id } = await params;
    const body = await req.json();
    const { name, gender, birthDate, phoneNumber, guardianPhoneNumber,
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
    if (guardianPhoneNumber !== undefined) updateData.guardianPhoneNumber = guardianPhoneNumber || null;
    if (disabilityType !== undefined)      updateData.disabilityType      = disabilityType;
    if (severity !== undefined)            updateData.severity            = severity;
    if (note !== undefined)                updateData.note                = note?.trim() || null;
    if (status !== undefined) {
      updateData.status = status;
      if (status !== "TRAINING") updateData.leftAt = new Date();
    }

    await prisma.trainee.update({ where: { id: trainee.id }, data: updateData });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
