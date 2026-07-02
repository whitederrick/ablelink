// app/api/admin/document-runs/gov-status/route.ts
// 매니저: 선택 문서의 '장애인고용공단 제출 상태' 수동 변경.
//  NONE(미제출) | SUBMITTED(제출완료) | RESUBMIT(재제출 요구)
// 공단과의 소통은 앱 밖(이메일/전화)이라, 앱 외 제출·정정·재제출 요구를 매니저가 직접 반영.
// (발송→공단 성공 시에는 send 라우트가 자동으로 SUBMITTED 처리)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { audit } from "@/lib/audit";

const VALID = ["NONE", "SUBMITTED", "RESUBMIT"] as const;

export async function PATCH(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const body = await req.json().catch(() => ({}));

    const status = String(body?.status ?? "");
    if (!VALID.includes(status as any)) {
      return NextResponse.json({ success: false, message: "잘못된 상태값입니다." }, { status: 400 });
    }
    const idsRaw = body?.ids;
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return NextResponse.json({ success: false, message: "대상 문서를 선택해주세요." }, { status: 400 });
    }
    const ids = idsRaw.map(String).filter(s => /^\d+$/.test(s)).map(s => BigInt(s));
    if (ids.length === 0) return NextResponse.json({ success: false, message: "대상 문서를 선택해주세요." }, { status: 400 });
    if (ids.length > 100) return NextResponse.json({ success: false, message: "한 번에 최대 100건까지 변경할 수 있습니다." }, { status: 400 });

    const r = await prisma.documentRun.updateMany({
      where: { id: { in: ids }, agencyId: scope.agencyId, signStage: { not: "DRAFT" } },
      data: {
        govStatus: status,
        // 제출완료로 표시할 때 제출시각 기록 + 발송 횟수 증가(앱 외 수동 제출도 n차로 누적).
        ...(status === "SUBMITTED" ? { govSubmittedAt: new Date(), govSubmitCount: { increment: 1 } } : {}),
      },
    });

    await audit(scope, { entityType: "DocumentRun", action: "update", summary: `공단 제출 상태 변경: ${status} (${r.count}건)` });
    return NextResponse.json({ success: true, updated: r.count, message: `${r.count}건의 제출 상태를 변경했습니다.` });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/document-runs/gov-status]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
