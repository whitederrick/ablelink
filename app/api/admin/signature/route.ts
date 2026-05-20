// app/api/admin/signature/route.ts
// 에이전시 관리자(AdminUser) 서명 등록/조회/삭제
// (위탁기관/공단 담당자 = 에이전시 관리자가 서명 미리 등록)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getAdminSession } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "signatures";

// ── 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

  const admin = await prisma.adminUser.findUnique({
    where: { id: BigInt(session.adminId) },
    select: { signatureUrl: true, displayName: true },
  });

  return NextResponse.json({ success: true, signatureUrl: admin?.signatureUrl ?? null, displayName: admin?.displayName });
}

// ── 저장 ─────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

  const formData = await request.formData();
  const imageBlob = formData.get("signature") as Blob | null;

  if (!imageBlob || imageBlob.size === 0)
    return NextResponse.json({ success: false, message: "서명 이미지가 없습니다." }, { status: 400 });
  if (imageBlob.size > 500 * 1024)
    return NextResponse.json({ success: false, message: "서명이 너무 큽니다. (최대 500KB)" }, { status: 400 });

  const adminId = session.adminId;
  const fileName = `admin/${adminId}/signature_${Date.now()}.png`;

  // 기존 서명 삭제
  const existing = await prisma.adminUser.findUnique({
    where: { id: BigInt(adminId) },
    select: { signatureUrl: true },
  });
  if (existing?.signatureUrl) {
    const oldPath = extractPath(existing.signatureUrl);
    if (oldPath) await deleteStorage(oldPath);
  }

  // Supabase Storage 업로드
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
    where: { id: BigInt(adminId) },
    data: { signatureUrl: publicUrl } as any,
  });

  return NextResponse.json({ success: true, signatureUrl: publicUrl });
}

// ── 삭제 ─────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

  const admin = await prisma.adminUser.findUnique({
    where: { id: BigInt(session.adminId) },
    select: { signatureUrl: true },
  });
  if (admin?.signatureUrl) {
    const path = extractPath(admin.signatureUrl);
    if (path) await deleteStorage(path);
  }

  await prisma.adminUser.update({
    where: { id: BigInt(session.adminId) },
    data: { signatureUrl: null } as any,
  });

  return NextResponse.json({ success: true });
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
