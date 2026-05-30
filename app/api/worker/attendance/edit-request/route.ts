// 직무지도원이 출근 기록 수정 요청 제출
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const body = await req.json();
    const { attendanceId, reason, proposedStart, proposedEnd } = body;

    if (!attendanceId || !reason?.trim()) {
      return NextResponse.json({ success: false, message: "출근 기록 ID와 수정 사유는 필수입니다." }, { status: 400 });
    }

    const workerId = BigInt(session.workerId);
    const attId  = BigInt(attendanceId);

    // 본인 기록인지 확인
    const attendance = await prisma.dailyAttendance.findUnique({
      where: { id: attId },
      select: { id: true, workerId: true, workDate: true },
    });
    if (!attendance || attendance.workerId !== workerId) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    // 동일 출근 기록에 대한 PENDING 요청이 있으면 덮어쓰기(update) 아니면 새로 생성
    const existing = await prisma.attendanceEditRequest.findFirst({
      where: { attendanceId: attId, status: "PENDING" },
    });

    if (existing) {
      await prisma.attendanceEditRequest.update({
        where: { id: existing.id },
        data: {
          reason:        reason.trim(),
          proposedStart: proposedStart || null,
          proposedEnd:   proposedEnd   || null,
        },
      });
      return NextResponse.json({ success: true, message: "수정 요청이 업데이트되었습니다." });
    }

    await prisma.attendanceEditRequest.create({
      data: {
        attendanceId: attId,
        workerId,
        reason:        reason.trim(),
        proposedStart: proposedStart || null,
        proposedEnd:   proposedEnd   || null,
        status: "PENDING",
      },
    });

    return NextResponse.json({ success: true, message: "수정 요청이 제출되었습니다. 에이전시 관리자 승인 후 반영됩니다." });
  } catch (e: any) {
    console.error("[worker/attendance/edit-request POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const attendanceId = searchParams.get("attendanceId");

    const workerId = BigInt(session.workerId);
    const where: any = { workerId };
    if (attendanceId) where.attendanceId = BigInt(attendanceId);

    const requests = await prisma.attendanceEditRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({
      success: true,
      requests: requests.map(r => ({
        id:           r.id.toString(),
        attendanceId: r.attendanceId.toString(),
        reason:       r.reason,
        proposedStart: r.proposedStart,
        proposedEnd:   r.proposedEnd,
        status:       r.status,
        adminNote:    r.adminNote,
        reviewedAt:   r.reviewedAt?.toISOString() ?? null,
        createdAt:    r.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    console.error("[worker/attendance/edit-request GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
