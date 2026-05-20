// app/api/sign/[token]/route.ts
// 사업체담당자 즉석 서명 제출 (공개 API — 인증 불필요)
// GET  → 토큰 정보 조회 (서명 페이지 진입 시)
// POST → 서명 이미지 저장

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "signatures";

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const rec = await (prisma as any).siteSignToken.findUnique({
    where: { token: params.token },
    include: { assignment: { include: { site: true } } },
  });

  if (!rec) return NextResponse.json({ success: false, message: "유효하지 않은 링크입니다." }, { status: 404 });
  if (new Date() > new Date(rec.expiresAt)) return NextResponse.json({ success: false, message: "만료된 링크입니다.", expired: true }, { status: 410 });
  if (rec.usedAt) return NextResponse.json({ success: false, message: "이미 서명이 완료된 링크입니다.", signed: true }, { status: 409 });

  const roleLabel: Record<string, string> = {
    company_manager: "사업체 담당자",
    gov_agent: "(공단/위탁기관) 담당자",
  };

  return NextResponse.json({
    success: true,
    docType: rec.docType,
    signRole: rec.signRole,
    roleLabel: roleLabel[rec.signRole] ?? rec.signRole,
    signerName: rec.signerName,
    companyName: rec.assignment?.site?.companyName ?? "",
    periodStart: rec.periodStart,
    periodEnd: rec.periodEnd,
    expiresAt: rec.expiresAt,
  });
}

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const rec = await (prisma as any).siteSignToken.findUnique({
    where: { token: params.token },
  });

  if (!rec) return NextResponse.json({ success: false, message: "유효하지 않은 링크입니다." }, { status: 404 });
  if (new Date() > new Date(rec.expiresAt)) return NextResponse.json({ success: false, message: "만료된 링크입니다." }, { status: 410 });
  if (rec.usedAt) return NextResponse.json({ success: false, message: "이미 서명이 완료되었습니다." }, { status: 409 });

  const formData = await request.formData();
  const imageBlob = formData.get("signature") as Blob | null;
  if (!imageBlob || imageBlob.size === 0)
    return NextResponse.json({ success: false, message: "서명 이미지가 없습니다." }, { status: 400 });
  if (imageBlob.size > 500 * 1024)
    return NextResponse.json({ success: false, message: "서명 이미지가 너무 큽니다." }, { status: 400 });

  const fileName = `sign-tokens/${params.token}/signature_${Date.now()}.png`;

  const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${fileName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "image/png",
      "x-upsert": "true",
    },
    body: imageBlob,
  });

  if (!uploadRes.ok) {
    console.error("[sign/token] 업로드 실패:", await uploadRes.text());
    return NextResponse.json({ success: false, message: "서명 저장에 실패했습니다." }, { status: 500 });
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`;

  await (prisma as any).siteSignToken.update({
    where: { token: params.token },
    data: { signatureUrl: publicUrl, usedAt: new Date() },
  });

  return NextResponse.json({ success: true, signatureUrl: publicUrl });
}
