// app/api/worker/payroll/[itemId]/payslip/route.ts
// GET: 직무지도원 본인 급여명세서 PDF(교부 수신). 확정(FINALIZED)된 본인 항목만.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { renderPdfToBuffer } from "@/lib/pdf";
import { buildPayslipPayload } from "@/lib/payroll/payslipPayload";

export async function GET(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { itemId } = await params;
    const item = await prisma.payrollItem.findUnique({
      where: { id: BigInt(itemId) },
      include: {
        user: { select: { workerName: true, birthDate: true, bankName: true, accountNumber: true, accountHolder: true } },
        run: { select: { status: true, yearMonth: true, finalizedAt: true, agency: { select: { name: true, businessNumber: true, representativeName: true, address: true, phoneNumber: true } } } },
      },
    });

    if (!item || item.workerId !== BigInt(session.workerId)) {
      return NextResponse.json({ success: false, message: "항목을 찾을 수 없습니다." }, { status: 404 });
    }
    // 본인이라도 확정 전 명세서는 교부 대상 아님(초안 비공개).
    if (item.run.status !== "FINALIZED") {
      return NextResponse.json({ success: false, message: "확정되지 않은 급여입니다." }, { status: 403 });
    }

    const payload = buildPayslipPayload(
      {
        agencyName: item.run.agency?.name ?? "",
        workerName: item.user?.workerName ?? "",
        workerBirth: item.user?.birthDate ?? "",
        yearMonth: item.run.yearMonth,
        payDate: item.run.finalizedAt ? item.run.finalizedAt.toISOString().slice(0, 10) : "",
        employerBizNo: item.run.agency?.businessNumber ?? null,
        employerRepName: item.run.agency?.representativeName ?? null,
        employerAddress: item.run.agency?.address ?? null,
        employerPhone: item.run.agency?.phoneNumber ?? null,
        bankName: item.user?.bankName ?? null,
        accountNumber: item.user?.accountNumber ?? null,
        accountHolder: item.user?.accountHolder ?? null,
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
    console.error("[worker/payroll/payslip]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
