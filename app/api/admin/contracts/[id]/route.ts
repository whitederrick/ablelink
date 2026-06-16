// app/api/admin/contracts/[id]/route.ts
// 관리자: 계약서 상세 조회 + PDF 다운로드(?format=pdf)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { renderContractPdf } from "@/lib/contractPdf";

type Params = { params: Promise<{ id: string }> };

function serialize(c: any) {
  return {
    id: String(c.id),
    status: c.status,
    workerName: c.user?.workerName ?? "",
    workerPhone: c.user?.phoneNumber ?? "",
    workerAddress: c.workerFilledAddress || c.workerAddress || "",
    agencyName: c.agency?.name ?? "",
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
    employerBizName: c.employerBizName, employerPhone: c.employerPhone,
    employerAddress: c.employerAddress, employerRepName: c.employerRepName,
    specialClauses: Array.isArray(c.specialClauses) ? c.specialClauses : [],
    workerSignedAt: c.workerSignedAt?.toISOString() ?? null,
    adminSignedAt: c.adminSignedAt?.toISOString() ?? null,
    workerSignatureUrl: c.workerSignatureUrl,
    adminSignatureUrl: c.adminSignatureUrl,
    signToken: c.signToken,
    adminMemo: c.adminMemo,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const scope = await requireManagerSession(req);
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
    if (!c || c.agencyId !== scope.agencyId) {
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

    return NextResponse.json({ success: true, data: serialize(c) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/contracts/[id] GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
