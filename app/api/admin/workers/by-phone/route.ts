// GET /api/admin/workers/by-phone?phone=01012345678
// 배정 요청 '직접 추가' 시 입력한 전화번호가 이미 가입된 직무지도원인지 조회.
// 가입돼 있으면 기존 워커(현재 배정 상태 포함)로 반환 → 신규 가입 초대 대신 배정 요청 경로로 처리.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { logAccess } from "@/lib/accessLog";
import { AssignStatus } from "@prisma/client";

const ENGAGED: AssignStatus[] = ["ASSIGNED", "CONFIRMED", "ACTIVE"];

export async function GET(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);
    const agencyId = scope.agencyId;

    const { searchParams } = new URL(request.url);
    const phone = (searchParams.get("phone") || "").replace(/-/g, "").trim();
    if (!/^01[0-9]{8,9}$/.test(phone)) {
      return NextResponse.json({ success: false, message: "올바른 휴대전화번호를 입력해주세요." }, { status: 400 });
    }

    // 가입은 loginId = 전화번호 기준
    const worker = await prisma.worker.findUnique({
      where: { loginId: phone },
      select: {
        id: true,
        workerName: true,
        phoneNumber: true,
        status: true,
        assignments: {
          where: { agencyId, status: { in: ENGAGED } },
          select: { status: true, startDate: true, endDate: true, site: { select: { companyName: true } } },
          orderBy: { startDate: "desc" },
          take: 1,
        },
      },
    });

    if (!worker) return NextResponse.json({ success: true, exists: false });

    const a = worker.assignments[0];
    // ★13차: 전화번호를 알면 타(또는 미관계) 기관 워커도 조회 가능(정책상 배정요청 유도용으로 유지). 본 기관과
    //  관계(진행 중 배정)없는 워커의 조회는 접속기록에 남긴다(크로스기관 PII 조회 추적). 실패해도 조회는 진행.
    if (!a) {
      try {
        await logAccess(request, scope, {
          subjectType: "Worker",
          subjectId: worker.id,
          subjectLabel: worker.workerName,
          resource: "worker_by_phone",
          action: "view",
        });
      } catch (e) { console.warn("[by-phone] logAccess 실패:", e); }
    }
    return NextResponse.json({
      success: true,
      exists: true,
      worker: {
        id: String(worker.id),
        name: worker.workerName,
        phone: worker.phoneNumber,
        active: String(worker.status) === "ACTIVE",
        engaged: !!a,
        currentSiteName: a?.site?.companyName ?? null,
        periodStart: a?.startDate ? a.startDate.toISOString() : null,
        periodEnd: a?.endDate ? a.endDate.toISOString() : null,
      },
    });
  } catch (err: any) {
    if (err instanceof Response) return err;
    console.error("[admin/workers/by-phone]", err);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
