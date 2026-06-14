// app/api/worker/assignment/connect/route.ts
// 기존 직무지도원: 인증코드 입력으로 새 배정을 본인 계정에 연결(connectedAt 기록).
// assignment-pipeline-design.md §7

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

export async function POST(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }
    const workerId = BigInt(session.workerId);

    const body = await req.json().catch(() => ({}));
    const code = String(body?.code ?? "").trim();
    if (!code) {
      return NextResponse.json({ success: false, message: "인증코드를 입력해주세요." }, { status: 400 });
    }

    const invite = await prisma.workerInvite.findFirst({
      where: {
        code,
        purpose: "CONNECT_EXISTING",
        existingWorkerId: workerId,
        usedAt: null,
      },
      orderBy: { id: "desc" },
    });
    if (!invite) {
      return NextResponse.json({ success: false, message: "유효하지 않은 인증코드입니다." }, { status: 404 });
    }
    if (new Date() > invite.expiresAt) {
      return NextResponse.json({ success: false, message: "만료된 인증코드입니다. 담당자에게 재발급을 요청하세요." }, { status: 410 });
    }
    if (!invite.assignmentId) {
      return NextResponse.json({ success: false, message: "연결할 배정 정보가 없습니다." }, { status: 422 });
    }

    // 배정이 본인 것인지 확인 후 연결 처리
    const assignment = await prisma.siteAssignment.findFirst({
      where: { id: invite.assignmentId, workerId },
      select: { id: true, connectedAt: true, attendanceButtonExempt: true, site: { select: { companyName: true } } },
    });
    if (!assignment) {
      return NextResponse.json({ success: false, message: "연결할 배정을 찾을 수 없습니다." }, { status: 404 });
    }

    const ops: any[] = [
      prisma.siteAssignment.updateMany({
        where: { id: assignment.id, connectedAt: null },
        data: { connectedAt: new Date() },
      }),
      prisma.workerInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), usedByWorkerId: workerId },
      }),
    ];
    // 출퇴근 버튼 미적용(자동 기록) 배정은 위치확정 단계가 없으므로 연결 시 바로 ACTIVE로 전이.
    if (assignment.attendanceButtonExempt) {
      ops.push(prisma.siteAssignment.updateMany({
        where: { id: assignment.id, status: "CONFIRMED" },
        data: { status: "ACTIVE" },
      }));
    }
    await prisma.$transaction(ops);

    return NextResponse.json({
      success: true,
      message: "배정이 연결되었습니다.",
      siteName: assignment.site?.companyName ?? null,
    });
  } catch (err) {
    console.error("[worker/assignment/connect]", err);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
