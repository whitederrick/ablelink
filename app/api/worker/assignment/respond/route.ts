// app/api/worker/assignment/respond/route.ts
// 직무지도원이 배정 요청(REQUESTED)에 회신: 수락(희망 근무형태 선택) / 거절.
//  - 단일 후보(같은 현장에 경쟁 후보 없음) 수락 → 바로 ASSIGNED(계약 대기, 근무형태 확정).
//  - 복수 후보 수락 → ACCEPTED(위탁기관 담당자 최종확정 대기).
//  - 거절 → REJECTED.
// 회신 기한 초과 건은 수락 불가(EXPIRED 처리).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

const VALID_WT = ["AM", "PM", "FULL_DAY", "CUSTOM"];

export async function POST(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }
    const workerId = BigInt(session.workerId);

    const body = await req.json().catch(() => ({}));
    const assignmentId = String(body?.assignmentId ?? "").trim();
    const action = String(body?.action ?? "").trim(); // "accept" | "decline"
    const workType = body?.workType != null ? String(body.workType).trim() : "";

    if (!/^\d+$/.test(assignmentId)) {
      return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
    }

    const asgn = await prisma.siteAssignment.findFirst({
      where: { id: BigInt(assignmentId), workerId, status: "REQUESTED" },
      select: { id: true, siteId: true, replyDeadline: true, requestedWorkTypes: true, site: { select: { companyName: true } } },
    });
    if (!asgn) {
      return NextResponse.json({ success: false, message: "회신할 배정 요청을 찾을 수 없습니다." }, { status: 404 });
    }

    // 회신 기한 초과 → 자동 탈락(EXPIRED)
    if (asgn.replyDeadline && new Date() > asgn.replyDeadline) {
      await prisma.siteAssignment.updateMany({
        where: { id: asgn.id, status: "REQUESTED" },
        data: { status: "EXPIRED", rejectedAt: new Date(), statusReason: "회신 기한 초과 자동 탈락" },
      });
      return NextResponse.json({ success: false, message: "회신 기한이 지나 자동 탈락되었습니다." }, { status: 410 });
    }

    if (action === "decline") {
      await prisma.siteAssignment.updateMany({
        where: { id: asgn.id, status: "REQUESTED" },
        data: { status: "REJECTED", rejectedAt: new Date(), statusReason: "후보 거절" },
      });
      return NextResponse.json({ success: true, status: "REJECTED", message: "배정 요청을 거절했습니다." });
    }

    if (action !== "accept") {
      return NextResponse.json({ success: false, message: "잘못된 회신입니다." }, { status: 400 });
    }

    // 수락: 희망 근무형태가 요청 근무형태 목록에 포함돼야 함
    const offered = (asgn.requestedWorkTypes ?? "").split(",").filter(Boolean);
    if (!VALID_WT.includes(workType) || (offered.length > 0 && !offered.includes(workType))) {
      return NextResponse.json({ success: false, message: "요청된 근무형태 중 하나를 선택해주세요." }, { status: 400 });
    }
    const commuteGuidanceIncluded = workType === "FULL_DAY" ? false : true;

    // 같은 현장에 경쟁 후보(요청 중 또는 이미 수락) 존재 여부 → 단일/복수 판정
    const others = await prisma.siteAssignment.count({
      where: {
        siteId: asgn.siteId,
        id: { not: asgn.id },
        status: { in: ["REQUESTED", "ACCEPTED"] },
      },
    });

    if (others === 0) {
      // 단일 후보 → 바로 계약 대기(ASSIGNED). 본인 계정에서 수락했으므로 연결(connectedAt)까지 처리.
      await prisma.siteAssignment.updateMany({
        where: { id: asgn.id, status: "REQUESTED" },
        data: { status: "ASSIGNED", workType, commuteGuidanceIncluded, connectedAt: new Date() },
      });
      return NextResponse.json({
        success: true, status: "ASSIGNED",
        message: "배정 요청을 수락했습니다. 계약서 작성을 기다려주세요.",
        siteName: asgn.site?.companyName ?? null,
      });
    }

    // 복수 후보 → 수락(ACCEPTED). 담당자 최종확정 대기.
    await prisma.siteAssignment.updateMany({
      where: { id: asgn.id, status: "REQUESTED" },
      data: { status: "ACCEPTED", workType, commuteGuidanceIncluded, connectedAt: new Date() },
    });
    return NextResponse.json({
      success: true, status: "ACCEPTED",
      message: "배정 요청을 수락했습니다. 담당자 확정을 기다려주세요.",
      siteName: asgn.site?.companyName ?? null,
    });
  } catch (err) {
    console.error("[worker/assignment/respond]", err);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
