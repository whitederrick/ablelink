// app/api/sign-self/[token]/route.ts
// 스마트폰에서 본인 서명 제출 (공개 — 토큰이 인증 역할). 제출 시 해당 매니저 계정 서명에 저장.
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSignatureImage } from "@/lib/imageValidation";
import { getSelfSignToken, consumeSelfSignTokenAtomic } from "@/lib/selfSignToken";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "signatures";

function extractPath(url: string): string | null {
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}
async function deleteStorage(path: string) {
  await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
}

// GET — 토큰 유효성/표시 정보
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = await getSelfSignToken(token);
  if (!payload) return NextResponse.json({ success: false, message: "만료되었거나 유효하지 않은 링크입니다." }, { status: 410 });
  return NextResponse.json({ success: true, scope: payload.scope, name: payload.name ?? null });
}

// POST — 서명 이미지 제출 → 본인 계정 서명에 저장
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const payload = await getSelfSignToken(token);
    if (!payload) return NextResponse.json({ success: false, message: "만료되었거나 유효하지 않은 링크입니다." }, { status: 410 });

    const formData = await request.formData();
    const imageBlob = formData.get("signature") as Blob | null;
    const imgCheck = await validateSignatureImage(imageBlob!);
    if (!imgCheck.valid) return NextResponse.json({ success: false, message: imgCheck.error }, { status: 400 });

    // ★일회용 토큰을 저장 직전에 원자적으로 소비(GETDEL) — "조회 후 삭제" 레이스로 동시 제출이
    //  둘 다 서명을 저장하던 것을 방지(P2-1). 이미지 검증까지는 소비 전이라 검증 실패 시 재시도 가능.
    //  claim에 성공한(payload를 얻은) 요청만 이하 저장을 수행하고, 나머지는 410.
    const claimed = await consumeSelfSignTokenAtomic(token);
    if (!claimed) return NextResponse.json({ success: false, message: "이미 처리되었거나 만료된 링크입니다." }, { status: 410 });

    // 사업주(갑) 대표자 서명 — data URI로 agency.representativeSignatureUrl에 저장.
    // (계약서 PDF 렌더러가 data:image 만 임베드하므로 스토리지 URL이 아닌 data URI로 보관)
    if (claimed.scope === "agency-rep") {
      if (!claimed.agencyId) {
        return NextResponse.json({ success: false, message: "대상 위탁기관 정보가 없습니다." }, { status: 400 });
      }
      const buf = Buffer.from(await imageBlob!.arrayBuffer());
      const dataUrl = `data:${imgCheck.mime};base64,${buf.toString("base64")}`;
      if (dataUrl.length > 1_500_000) {
        return NextResponse.json({ success: false, message: "서명 이미지가 너무 큽니다." }, { status: 400 });
      }
      await prisma.agency.update({
        where: { id: BigInt(claimed.agencyId) },
        data: { representativeSignatureUrl: dataUrl },
      });
      return NextResponse.json({ success: true });
    }

    if (claimed.scope !== "manager") {
      return NextResponse.json({ success: false, message: "지원하지 않는 서명 유형입니다." }, { status: 400 });
    }
    const managerId = BigInt(claimed.id);

    // 기존 서명 삭제
    const existing = await prisma.manager.findUnique({ where: { id: managerId }, select: { signatureUrl: true } });
    if (existing?.signatureUrl) {
      const oldPath = extractPath(existing.signatureUrl);
      if (oldPath) await deleteStorage(oldPath);
    }

    const fileName = `admin/${managerId}/signature_${Date.now()}.png`;
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
      console.error("[sign-self] 업로드 실패:", await uploadRes.text());
      return NextResponse.json({ success: false, message: "서명 저장 실패" }, { status: 500 });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`;
    await prisma.manager.update({ where: { id: managerId }, data: { signatureUrl: publicUrl } });
    // (토큰은 위에서 원자적으로 소비됨 — 여기서 별도 삭제 불필요)

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[sign-self POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
