// app/api/admin/signature/route.ts
// 에이전시 관리자(AdminUser) 서명 등록/조회/삭제
// (위탁기관/공단 담당자 = 에이전시 관리자가 서명 미리 등록)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { prisma } from "@/lib/prisma";
import { validateSignatureImage } from "@/lib/imageValidation";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "signatures";

export async function GET(request: NextRequest) {
  try {
    const scope = await requireAdminSession(request);
    const admin = await prisma.adminUser.findUnique({
      where: { id: scope.userId },
      select: { signatureUrl: true, displayName: true } as any,
    });
    return NextResponse.json({ success: true, signatureUrl: (admin as any)?.signatureUrl ?? null, displayName: (admin as any)?.displayName });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const scope = await requireAdminSession(request);
    const formData = await request.formData();
    const imageBlob = formData.get("signature") as Blob | null;

    const imgCheck = await validateSignatureImage(imageBlob!);
    if (!imgCheck.valid)
      return NextResponse.json({ success: false, message: imgCheck.error }, { status: 400 });

    // 기존 서명 삭제
    const existing = await prisma.adminUser.findUnique({
      where: { id: scope.userId },
      select: { signatureUrl: true } as any,
    });
    if ((existing as any)?.signatureUrl) {
      const oldPath = extractPath((existing as any).signatureUrl);
      if (oldPath) await deleteStorage(oldPath);
    }

    const fileName = `admin/${scope.userId}/signature_${Date.now()}.png`;
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
      console.error("[admin/signature] 업로드 실패:", await uploadRes.text());
      return NextResponse.json({ success: false, message: "서명 저장 실패" }, { status: 500 });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`;
    await prisma.adminUser.update({
      where: { id: scope.userId },
      data: { signatureUrl: publicUrl } as any,
    });

    return NextResponse.json({ success: true, signatureUrl: publicUrl });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const scope = await requireAdminSession(request);
    const admin = await prisma.adminUser.findUnique({
      where: { id: scope.userId },
      select: { signatureUrl: true } as any,
    });
    if ((admin as any)?.signatureUrl) {
      const path = extractPath((admin as any).signatureUrl);
      if (path) await deleteStorage(path);
    }
    await prisma.adminUser.update({
      where: { id: scope.userId },
      data: { signatureUrl: null } as any,
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

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
