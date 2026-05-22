// app/api/worker/contracts/route.ts
// 직무지도원 계약서 조회 및 서명 API

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const WORK_TYPE_LABELS: Record<string, string> = {
  AM:       "오전 4시간 (09:00~12:00)",
  PM:       "오후 4시간 (13:00~17:00)",
  FULL_DAY: "전일 8시간 (09:00~18:00)",
  CUSTOM:   "직접 지정",
};

// GET: 토큰으로 계약서 조회 (비로그인 허용 — 카카오 링크 접근)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ success: false, message: "토큰이 없습니다." }, { status: 400 });
  }

  const contract = await prisma.employmentContract.findUnique({
    where: { signToken: token },
    include: {
      user: { select: { userName: true, phoneNumber: true } },
      agency: { select: { name: true, address: true, phoneNumber: true } },
    },
  });

  if (!contract) {
    return NextResponse.json({ success: false, message: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  if (new Date() > contract.tokenExpiresAt) {
    return NextResponse.json({ success: false, message: "만료된 링크입니다. 관리자에게 재발급을 요청하세요." }, { status: 410 });
  }

  const workTypeLabel = contract.workType ? (WORK_TYPE_LABELS[contract.workType] ?? contract.workType) : "미정";
  const customTimeStr = contract.workType === "CUSTOM" && contract.customWorkStart && contract.customWorkEnd
    ? ` (${contract.customWorkStart}~${contract.customWorkEnd})`
    : "";

  return NextResponse.json({
    success: true,
    data: {
      id: String(contract.id),
      status: contract.status,
      coachName: contract.user.userName,
      coachPhone: contract.user.phoneNumber,
      agencyName: contract.agency.name,
      agencyAddress: contract.agency.address,
      agencyPhone: contract.agency.phoneNumber,
      contractStart: contract.contractStart.toISOString().slice(0, 10),
      contractEnd: contract.contractEnd.toISOString().slice(0, 10),
      siteName: contract.siteName,
      workTypeLabel: workTypeLabel + customTimeStr,
      commuteGuidanceIncluded: contract.commuteGuidanceIncluded,
      // 직무지도원이 직접 입력한 내용 (관리자가 미입력 시)
      coachFilledSiteName: contract.coachFilledSiteName,
      coachFilledWorkType: contract.coachFilledWorkType,
      coachSignedAt: contract.coachSignedAt?.toISOString() ?? null,
      adminSignedAt: contract.adminSignedAt?.toISOString() ?? null,
      coachSignatureUrl: contract.coachSignatureUrl,
      adminMemo: contract.adminMemo,
    },
  });
}

// POST: 직무지도원 서명 처리
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, signatureUrl, coachFilledSiteName, coachFilledWorkType } = body;

  if (!token || !signatureUrl) {
    return NextResponse.json({ success: false, message: "필수 항목이 없습니다." }, { status: 400 });
  }

  const contract = await prisma.employmentContract.findUnique({
    where: { signToken: token },
  });

  if (!contract) {
    return NextResponse.json({ success: false, message: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  if (new Date() > contract.tokenExpiresAt) {
    return NextResponse.json({ success: false, message: "만료된 링크입니다." }, { status: 410 });
  }

  if (contract.status !== "PENDING") {
    return NextResponse.json({ success: false, message: "이미 서명이 완료된 계약서입니다." }, { status: 409 });
  }

  await prisma.employmentContract.update({
    where: { id: contract.id },
    data: {
      status: "SIGNED",
      coachSignedAt: new Date(),
      coachSignatureUrl: signatureUrl,
      coachFilledSiteName: coachFilledSiteName || null,
      coachFilledWorkType: coachFilledWorkType || null,
    },
  });

  return NextResponse.json({ success: true, message: "서명이 완료되었습니다." });
}
