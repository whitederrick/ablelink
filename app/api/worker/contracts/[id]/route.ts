// app/api/worker/contracts/[id]/route.ts
// 직무지도원 본인 계약서 상세 + PDF 다운로드(?format=pdf)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { renderContractPdf } from "@/lib/contractPdf";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const { id } = await params;
    let cid: bigint;
    try { cid = BigInt(id); } catch { return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 }); }

    const c = await prisma.employmentContract.findUnique({
      where: { id: cid },
      include: {
        user: { select: { workerName: true, phoneNumber: true, birthDate: true } },
        agency: { select: { name: true, address: true, phoneNumber: true } },
      },
    });
    if (!c || c.workerId !== workerId) {
      return NextResponse.json({ success: false, message: "계약서를 찾을 수 없습니다." }, { status: 404 });
    }

    const format = new URL(req.url).searchParams.get("format");
    if (format === "pdf") {
      const buf = await renderContractPdf(c);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="contract_${c.id}.pdf"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: String(c.id),
        status: c.status,
        agencyName: c.agency?.name ?? "",
        workerName: c.user?.workerName ?? "",
        workerPhone: c.user?.phoneNumber ?? "",
        workerAddress: c.workerFilledAddress || c.workerAddress || "",
        contractStart: c.contractStart.toISOString().slice(0, 10),
        contractEnd: c.contractEnd.toISOString().slice(0, 10),
        workLocation: c.workLocation || c.siteName || c.workerFilledSiteName || "",
        jobDescription: c.jobDescription || "",
        workStartTime: c.workStartTime, workEndTime: c.workEndTime,
        breakStartTime: c.breakStartTime, breakEndTime: c.breakEndTime,
        workDaysPerWeek: c.workDaysPerWeek, weeklyHoliday: c.weeklyHoliday,
        wageType: c.wageType, wageAmount: c.wageAmount,
        bonusExists: c.bonusExists, bonusAmount: c.bonusAmount,
        extraPayExists: c.extraPayExists, extraPayDesc: c.extraPayDesc,
        overtimeRate: c.overtimeRate, wagePayday: c.wagePayday, wagePayMethod: c.wagePayMethod,
        employerBizName: c.employerBizName || c.agency?.name || "",
        employerPhone: c.employerPhone || c.agency?.phoneNumber || "",
        employerAddress: c.employerAddress || c.agency?.address || "",
        employerRepName: c.employerRepName || "",
        specialClauses: Array.isArray(c.specialClauses) ? c.specialClauses : [],
        workerSignedAt: c.workerSignedAt?.toISOString() ?? null,
        adminSignedAt: c.adminSignedAt?.toISOString() ?? null,
        workerSignatureUrl: c.workerSignatureUrl,
        createdAt: c.createdAt.toISOString(),
      },
    });
  } catch (e: any) {
    console.error("[worker/contracts/[id] GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
