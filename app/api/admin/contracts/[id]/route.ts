// app/api/admin/contracts/[id]/route.ts
// 관리자: 계약서 상세 조회 + PDF 다운로드(?format=pdf)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession, requireAdminOrManagerSession } from "@/lib/managerScope";
import { renderContractPdf } from "@/lib/contractPdf";
import { audit } from "@/lib/audit";
import { logAccess } from "@/lib/accessLog";

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
    // 매니저=본 기관만, 운영자=전체 기관 계약 조회(읽기·PDF)
    const session = await requireAdminOrManagerSession(req);
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
    if (!c || (session.kind === "manager" && c.agencyId !== session.agencyId)) {
      return NextResponse.json({ success: false, message: "계약서를 찾을 수 없습니다." }, { status: 404 });
    }

    const format = new URL(req.url).searchParams.get("format");
    // 개인정보 접속기록 — 근로계약서(성명·생년월일·계좌 등) 열람/출력
    await logAccess(req, session, { subjectType: "Worker", subjectId: c.workerId, subjectLabel: c.user?.workerName ?? null, resource: "contract", action: format === "pdf" ? "print" : "view" });
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

// 계약 취소 — 서명 전(PENDING) 계약만 CANCELLED로 전환. 서명 완료 계약은 법적 효력상 수정 불가(새 계약으로 대체).
// 생성 시점엔 배정 상태를 건드리지 않으므로(전이는 서명 시) 취소는 배정에 영향 없음.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    let cid: bigint;
    try { cid = BigInt(id); } catch { return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 }); }

    const body = await req.json().catch(() => ({}));
    if (body?.action !== "cancel") {
      return NextResponse.json({ success: false, message: "지원하지 않는 동작입니다." }, { status: 400 });
    }

    const c = await prisma.employmentContract.findUnique({
      where: { id: cid },
      select: { id: true, agencyId: true, workerId: true, status: true },
    });
    if (!c || c.agencyId !== scope.agencyId) {
      return NextResponse.json({ success: false, message: "계약서를 찾을 수 없습니다." }, { status: 404 });
    }
    if (c.status !== "PENDING") {
      return NextResponse.json({ success: false, message: "서명 전(대기) 상태의 계약만 취소할 수 있습니다." }, { status: 409 });
    }

    await prisma.employmentContract.update({ where: { id: cid }, data: { status: "CANCELLED" } });
    await audit(scope, { entityType: "EmploymentContract", entityId: cid, action: "update", summary: "계약 취소", payload: { changed: [{ field: "status", from: "PENDING", to: "CANCELLED" }] } });
    // 직무지도원에게 서명 링크를 이미 보냈을 수 있으므로 취소 안내(실패 무시)
    try {
      await prisma.workerNotice.create({
        data: { workerId: c.workerId, agencyId: scope.agencyId, title: "[계약] 근로계약서가 취소되었습니다", body: "위탁기관이 발송한 근로계약서 작성 요청이 취소되었습니다. 문의사항은 담당자에게 확인해주세요.", type: "INFO", link: "/worker/home" },
      });
    } catch { /* 알림 실패 무시 */ }

    return NextResponse.json({ success: true, message: "계약서가 취소되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/contracts/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
