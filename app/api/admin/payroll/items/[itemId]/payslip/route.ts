// app/api/admin/payroll/items/[itemId]/payslip/route.ts
// GET: 급여명세서 PDF 발급(운영자/매니저). 소속 위탁기관 항목만.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { renderPdfToBuffer } from "@/lib/pdf";
import { buildPayslipPayload } from "@/lib/payroll/payslipPayload";
import { logAccess } from "@/lib/accessLog";

export async function GET(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { itemId } = await params;

    const item = await prisma.payrollItem.findUnique({
      where: { id: BigInt(itemId) },
      include: {
        user: { select: { workerName: true, birthDate: true } },
        run: { select: { agencyId: true, yearMonth: true, finalizedAt: true, agency: { select: { name: true } } } },
      },
    });

    if (!item) return NextResponse.json({ success: false, message: "항목을 찾을 수 없습니다." }, { status: 404 });
    if (item.run.agencyId !== scope.agencyId) {
      return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
    }

    // 개인정보 접속기록 — 급여명세서 PDF 출력
    await logAccess(req, scope, { subjectType: "Worker", subjectId: item.workerId, subjectLabel: item.user?.workerName ?? null, resource: "payslip", action: "print" });

    const payload = buildPayslipPayload(
      {
        agencyName: item.run.agency?.name ?? "",
        workerName: item.user?.workerName ?? "",
        workerBirth: item.user?.birthDate ?? "",
        yearMonth: item.run.yearMonth,
        payDate: item.run.finalizedAt ? item.run.finalizedAt.toISOString().slice(0, 10) : "",
      },
      {
        grossPay: Number(item.grossPay),
        totalDeduction: Number(item.totalDeduction),
        netPay: Number(item.netPay),
        workedDays: item.workedDays,
        workedMinutes: item.workedMinutes,
        breakdown: item.breakdown,
      },
    );

    const buf = await renderPdfToBuffer({ documentType: "PAYSLIP", payload });
    const fileName = encodeURIComponent(`임금명세서_${payload.workerName}_${payload.yearMonth}.pdf`);

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${fileName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    console.error("[admin/payroll/payslip]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
