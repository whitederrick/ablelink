export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { id } = await params;
    const record = await prisma.dailyAttendance.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, workerId: true, workDate: true, isFinalClosed: true, isManagerFinalClosed: true, startTime: true, endTime: true },
    });

    if (!record)
      return NextResponse.json({ success: false, message: "기록을 찾을 수 없습니다." }, { status: 404 });
    if (record.workerId.toString() !== session.workerId)
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    if (record.isManagerFinalClosed)
      return NextResponse.json({ success: false, message: "위탁기관 관리자가 최종 확정한 기록입니다. 수정이 불가합니다." }, { status: 409 });
    if (record.isFinalClosed)
      return NextResponse.json({ success: false, message: "이미 확정된 기록입니다." }, { status: 409 });

    // ★self-confirm은 '저장된 시각으로만' 확정한다. 워커가 본문으로 임의 startTime/endTime을 넣어 기본급을
    //  부풀리는(급여는 startTime~endTime 구간 기준) 것을 차단 — 시각 변경은 매니저 승인(수정요청) 경로로 강제.
    //  현재 UI는 빈 본문을 보내므로 정상 동작에는 영향이 없다.
    const updateData: any = { isFinalClosed: true, finalizedAt: new Date(), status: "DONE" };

    // 퇴근/출근 시각 없이 확정 금지(급여 과지급·유령 근무일 방지). 시각 보정이 필요하면 수정요청→매니저 승인.
    if (!record.endTime) {
      return NextResponse.json({ success: false, message: "퇴근 시각이 없어 확정할 수 없습니다. 시각 보정은 수정요청으로 담당자 승인을 받아주세요." }, { status: 400 });
    }
    if (!record.startTime) {
      return NextResponse.json({ success: false, message: "출근 시각이 없어 확정할 수 없습니다. 시각 보정은 수정요청으로 담당자 승인을 받아주세요." }, { status: 400 });
    }

    await prisma.dailyAttendance.update({ where: { id: record.id }, data: updateData });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[attendance/[id]/confirm]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
