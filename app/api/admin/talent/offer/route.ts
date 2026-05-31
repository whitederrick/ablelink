// app/api/admin/talent/offer/route.ts
// 에이전시/공단 — 후보자에게 제안(컨택) 보내기
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";

const PROFS = ["JOB_COACH", "CAREGIVER", "ACTIVITY_ASSISTANT"] as const;

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const b = await req.json();
    const workerId = parseBigInt(b.workerId);
    if (!workerId) return NextResponse.json({ success: false, message: "대상 후보자가 필요합니다." }, { status: 400 });

    const worker = await prisma.worker.findUnique({ where: { id: workerId }, select: { id: true, openToOffers: true, status: true } });
    if (!worker || worker.status !== "ACTIVE") return NextResponse.json({ success: false, message: "후보자를 찾을 수 없습니다." }, { status: 404 });
    if (!worker.openToOffers) return NextResponse.json({ success: false, message: "현재 제안을 받지 않는 후보자입니다." }, { status: 409 });

    const agencyId = session.kind === "manager" ? session.agencyId : null;
    // 같은 주체의 미처리(PENDING) 중복 제안 방지
    const dup = await prisma.talentOffer.findFirst({
      where: {
        workerId, status: "PENDING",
        ...(session.kind === "manager" ? { agencyId: session.agencyId } : { createdByAdminId: session.adminId }),
      },
    });
    if (dup) return NextResponse.json({ success: false, message: "이미 보낸 제안이 처리 대기 중입니다." }, { status: 409 });

    const profession = PROFS.includes(b.profession) ? b.profession : null;
    await prisma.talentOffer.create({
      data: {
        workerId,
        agencyId,
        createdByManagerId: session.kind === "manager" ? session.managerId : null,
        createdByAdminId: session.kind === "admin" ? session.adminId : null,
        profession,
        siteName: b.siteName?.trim() || null,
        message: b.message?.trim() || null,
        status: "PENDING",
      },
    });

    // 후보자 알림 (WorkerNotice.agencyId 필수 → 에이전시 제안일 때만)
    if (agencyId) {
      try {
        await prisma.workerNotice.create({
          data: { workerId, agencyId, title: "[직무지도 매칭] 에이전시에서 제안이 도착했습니다", body: b.message?.trim() ? String(b.message).slice(0, 200) : "제안 내용을 확인해주세요.", type: "INFO" },
        });
      } catch { /* 비치명적 */ }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/talent/offer POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
