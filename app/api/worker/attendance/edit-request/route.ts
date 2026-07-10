// 직무지도원이 출근 기록 수정 요청 제출
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";

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
      select: { id: true, workerId: true, workDate: true, site: { select: { agencyId: true, ownerManagerId: true } } },
    });
    if (!attendance || attendance.workerId !== workerId) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    // 수정요청 제출/재제출을 담당 매니저(없으면 기관 활성 매니저)에게 알림 — 회신 도달성.
    async function notifyManagers(kind: string) {
      try {
        const site: any = (attendance as any).site;
        let managerIds: bigint[] = [];
        if (site?.ownerManagerId) managerIds = [site.ownerManagerId];
        else if (site?.agencyId) {
          const mgrs = await prisma.manager.findMany({ where: { agencyId: site.agencyId, isActive: true }, select: { id: true } });
          managerIds = mgrs.map(m => m.id);
        }
        if (managerIds.length === 0) return;
        await prisma.managerNotice.createMany({
          data: managerIds.map(mid => ({
            managerId: mid,
            title: `[출근부 수정요청] ${session!.workerName} · ${attendance!.workDate}`,
            body: `${session!.workerName} 직무지도원이 ${attendance!.workDate} 출근부 시각 수정을 ${kind}했습니다. 검토 후 승인/반려해 주세요.`,
            link: "/manager/attendance-edit-requests",
          })),
        });
      } catch (e) { console.warn("[edit-request] 매니저 알림 실패:", e); }
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
      await audit(session, { entityType: "AttendanceEditRequest", entityId: existing.id, action: "update", summary: "출근부 수정요청(재제출)" });
      await notifyManagers("업데이트(재제출)");
      return NextResponse.json({ success: true, message: "수정 요청이 업데이트되었습니다." });
    }

    let createdReq;
    try {
      createdReq = await prisma.attendanceEditRequest.create({
        data: {
          attendanceId: attId,
          workerId,
          reason:        reason.trim(),
          proposedStart: proposedStart || null,
          proposedEnd:   proposedEnd   || null,
          status: "PENDING",
        },
      });
    } catch (e) {
      // #8: 동시 제출 경합 — 방금 다른 요청이 PENDING을 만들었다(부분 unique index 위반 P2002).
      //  중복 생성 대신 그 행을 최신 값으로 갱신(=재제출과 동일 처리).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const dup = await prisma.attendanceEditRequest.findFirst({ where: { attendanceId: attId, status: "PENDING" } });
        if (dup) {
          await prisma.attendanceEditRequest.update({
            where: { id: dup.id },
            data: { reason: reason.trim(), proposedStart: proposedStart || null, proposedEnd: proposedEnd || null },
          });
          await audit(session, { entityType: "AttendanceEditRequest", entityId: dup.id, action: "update", summary: "출근부 수정요청(동시 제출 병합)" });
          await notifyManagers("업데이트(재제출)");
          return NextResponse.json({ success: true, message: "수정 요청이 업데이트되었습니다." });
        }
      }
      throw e;
    }

    await audit(session, { entityType: "AttendanceEditRequest", entityId: createdReq.id, action: "create", summary: "출근부 수정요청" });
    await notifyManagers("제출");
    return NextResponse.json({ success: true, message: "수정 요청이 제출되었습니다. 위탁기관 관리자 승인 후 반영됩니다." });
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
