// app/api/sign/[token]/route.ts
// 사업체담당자 즉석 서명 제출 (공개 API — 인증 불필요)
// GET  → 토큰 정보 조회 (서명 페이지 진입 시)
// POST → 서명 이미지 저장

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { validateSignatureImage } from "@/lib/imageValidation";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "signatures";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
  const { token } = await params;
  const rec = await prisma.siteSignToken.findUnique({
    where: { token: token },
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
  } catch (e: any) {
    console.error("[sign/token GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
  const { token } = await params;
  const rec = await prisma.siteSignToken.findUnique({
    where: { token: token },
    include: { assignment: { select: { agencyId: true } } },
  });

  if (!rec) return NextResponse.json({ success: false, message: "유효하지 않은 링크입니다." }, { status: 404 });
  if (new Date() > new Date(rec.expiresAt)) return NextResponse.json({ success: false, message: "만료된 링크입니다." }, { status: 410 });
  if (rec.usedAt) return NextResponse.json({ success: false, message: "이미 서명이 완료되었습니다." }, { status: 409 });

  const agencyId = rec.assignment?.agencyId;
  if (agencyId) {
    const planCheck = await checkAgencyPlanAccess(agencyId, "SITE_MANAGER_SIGN");
    if (!planCheck.allowed) {
      return NextResponse.json({ success: false, message: "사업체 담당자 서명 기능은 STANDARD 플랜 이상에서 사용 가능합니다." }, { status: 403 });
    }
  }

  const formData = await request.formData();
  const imageBlob = formData.get("signature") as Blob | null;
  const imgCheck = await validateSignatureImage(imageBlob as Blob);
  if (!imgCheck.valid)
    return NextResponse.json({ success: false, message: imgCheck.error }, { status: 400 });

  const fileName = `sign-tokens/${token}/signature_${Date.now()}.png`;

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

  await prisma.siteSignToken.update({
    where: { token: token },
    data: { signatureUrl: publicUrl, usedAt: new Date() },
  });

  return NextResponse.json({ success: true, signatureUrl: publicUrl });
  } catch (e: any) {
    console.error("[sign/token POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
