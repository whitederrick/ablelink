// app/api/admin/signature/route.ts
// 위탁기관 관리자(Admin) 서명 등록/조회/삭제
// (위탁기관/공단 담당자 = 위탁기관 관리자가 서명 미리 등록)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { prisma } from "@/lib/prisma";
import { validateSignatureImage } from "@/lib/imageValidation";
import { signatureDisplayUrl } from "@/lib/signatureImage";
import { isManagerSignatureInUse } from "@/lib/docs/managerSignatureFile";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "signatures";

export async function GET(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);
    const manager = await prisma.manager.findUnique({
      where: { id: scope.managerId },
      select: { signatureUrl: true, displayName: true },
    });
    return NextResponse.json({ success: true, signatureUrl: await signatureDisplayUrl(manager?.signatureUrl), displayName: manager?.displayName });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);
    const formData = await request.formData();
    const imageBlob = formData.get("signature") as Blob | null;

    const imgCheck = await validateSignatureImage(imageBlob!);
    if (!imgCheck.valid)
      return NextResponse.json({ success: false, message: imgCheck.error }, { status: 400 });

    const existing = await prisma.manager.findUnique({
      where: { id: scope.managerId },
      select: { signatureUrl: true },
    });

    const fileName = `admin/${scope.managerId}/signature_${Date.now()}.png`;
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
    await prisma.manager.update({
      where: { id: scope.managerId },
      data: { signatureUrl: publicUrl },
    });

    // 새 서명이 저장된 뒤에 옛 파일 정리(업로드 실패 시 기존 서명 보존).
    //  이미 서명된 문서가 참조 중인 파일은 지우지 않는다(서명 칸이 빈 채로 발송되던 P1).
    if (existing?.signatureUrl && existing.signatureUrl !== publicUrl) {
      const oldPath = extractPath(existing.signatureUrl);
      if (oldPath && !(await isManagerSignatureInUse(existing.signatureUrl))) await deleteStorage(oldPath);
    }

    return NextResponse.json({ success: true, signatureUrl: await signatureDisplayUrl(publicUrl) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);
    const manager = await prisma.manager.findUnique({
      where: { id: scope.managerId },
      select: { signatureUrl: true },
    });
    await prisma.manager.update({
      where: { id: scope.managerId },
      data: { signatureUrl: null },
    });
    // 계정 서명 해제 후 파일 정리 — 이미 서명된 문서가 참조 중이면 파일은 남긴다.
    if (manager?.signatureUrl) {
      const path = extractPath(manager.signatureUrl);
      if (path && !(await isManagerSignatureInUse(manager.signatureUrl))) await deleteStorage(path);
    }
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
