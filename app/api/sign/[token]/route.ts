// app/api/sign/[token]/route.ts
// 사업체담당자 즉석 서명 제출 (공개 API — 인증 불필요)
// GET  → 토큰 정보 조회 (서명 페이지 진입 시)
// POST → 서명 이미지 저장

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAgencyPlanAccess, isSelfManagedAgency } from "@/lib/planGuard";
import { validateSignatureImage } from "@/lib/imageValidation";
import { signatureDisplayUrl } from "@/lib/signatureImage";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "signatures";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
  // 공개 API(인증 없음) — IP 기준 rate limit(토큰 열거·스토리지 남용 방어).
  //  H1: 서명 페이지 진입(GET)은 정상 트래픽 — 공유 IP(사무실 NAT/모바일 CGNAT) 뒤 여러 담당자가 월말에
  //  링크를 열 수 있어 로그인용(10/15분·30분차단) 정책을 공유하면 오차단된다. 느슨한 예산 + 짧은 차단.
  const rl = await checkRateLimit(`sign-get:${getClientIp(request)}`, { max: 60, windowSec: 15 * 60, blockSec: 5 * 60 });
  if (!rl.allowed) return NextResponse.json({ success: false, message: "요청이 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429 });

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
  // 공개 API(인증 없음) — IP 기준 rate limit(스토리지 업로드 DoS·남용 방어).
  //  H1: 제출(POST)은 쓰기라 GET보다 타이트하게 유지하되, 공유 IP 다수 담당자 서명 감안해 로그인 정책보다는 완화.
  const rl = await checkRateLimit(`sign-post:${getClientIp(request)}`, { max: 30, windowSec: 15 * 60, blockSec: 10 * 60 });
  if (!rl.allowed) return NextResponse.json({ success: false, message: "요청이 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429 });

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
    // 셀프등록(무소속 운영) 위탁기관는 기본 문서·서명 무료 허용
    if (!planCheck.allowed && !(await isSelfManagedAgency(agencyId))) {
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

  // 서명 객체 경로만 저장(비공개 버킷). 표시=signed URL, PDF=imageToDataUri(service-role).
  const storedPath = fileName;

  // ★원자적 1회 사용 처리: usedAt:null 조건부 update. 동시 제출 race에서 먼저 성공한 1건만 반영
  //   (초기 usedAt 체크만으로는 두 요청이 모두 통과해 마지막 서명이 덮어쓸 수 있음).
  const claim = await prisma.siteSignToken.updateMany({
    where: { token: token, usedAt: null },
    data: { signatureUrl: storedPath, usedAt: new Date() },
  });
  if (claim.count === 0) {
    return NextResponse.json({ success: false, message: "이미 서명이 완료되었습니다." }, { status: 409 });
  }

  return NextResponse.json({ success: true, signatureUrl: await signatureDisplayUrl(storedPath) });
  } catch (e: any) {
    console.error("[sign/token POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
