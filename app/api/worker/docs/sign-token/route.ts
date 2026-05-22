// app/api/worker/docs/sign-token/route.ts
// 사업체담당자 즉석 서명용 일회용 토큰 발급 (직무지도원이 요청)
// GET  → 기존 토큰 조회 (서명 완료 여부 확인용)
// POST → 토큰 발급 (QR/링크 생성용)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

// ── 토큰 조회 (서명 완료 여부 폴링용) ──────────────────
export async function GET(request: NextRequest) {
  const session = await getWorkerSessionFromReq(request);
  if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) return NextResponse.json({ success: false, message: "token 필요" }, { status: 400 });

  const rec = await prisma.siteSignToken.findUnique({
    where: { token },
    select: { signatureUrl: true, usedAt: true, expiresAt: true, signerName: true, signRole: true },
  });

  if (!rec) return NextResponse.json({ success: false, message: "유효하지 않은 토큰" }, { status: 404 });
  if (new Date() > new Date(rec.expiresAt)) return NextResponse.json({ success: false, message: "만료된 토큰", expired: true }, { status: 410 });

  return NextResponse.json({
    success: true,
    signed: !!rec.usedAt,
    signatureUrl: rec.signatureUrl,
    signerName: rec.signerName,
    signRole: rec.signRole,
    usedAt: rec.usedAt,
  });
}

// ── 토큰 발급 ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  const session = await getWorkerSessionFromReq(request);
  if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

  const body = await request.json();
  const { docType, periodStart, periodEnd, signRole, signerName } = body;
  // signRole: "company_manager" | "gov_agent"

  if (!docType || !periodStart || !periodEnd || !signRole)
    return NextResponse.json({ success: false, message: "필수 파라미터 누락" }, { status: 400 });

  // 현재 배정 확인
  const assignment = await prisma.siteAssignment.findFirst({
    where: { userId: BigInt(session.userId), status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
    orderBy: { assignedAt: "desc" },
  });
  if (!assignment) return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 404 });

  // 기존 미사용 토큰 무효화 (같은 조건)
  await prisma.siteSignToken.deleteMany({
    where: {
      assignmentId: assignment.id,
      docType,
      periodStart,
      periodEnd,
      signRole,
      usedAt: null,
    },
  });

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일

  await prisma.siteSignToken.create({
    data: {
      token,
      docType,
      assignmentId: assignment.id,
      periodStart,
      periodEnd,
      signRole,
      signerName: signerName || null,
      expiresAt,
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://able-link.co.kr";
  const signUrl = `${baseUrl}/sign/${token}`;

  return NextResponse.json({ success: true, token, signUrl, expiresAt });
}
