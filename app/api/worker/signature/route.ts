// app/api/worker/signature/route.ts
// 전자서명 저장/조회/삭제 API
// 서명 이미지 → Supabase Storage 업로드 → users.signature_url 업데이트

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { checkPlanAccess } from "@/lib/planGuard";
import { prisma } from "@/lib/prisma";
import { validateSignatureImage } from "@/lib/imageValidation";
import { signatureDisplayUrl } from "@/lib/signatureImage";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "signatures";

// ── 서명 조회 ────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const user = await prisma.worker.findUnique({
      where: { id: BigInt(session.workerId) },
      select: { signatureUrl: true },
    });

    return NextResponse.json({ success: true, signatureUrl: await signatureDisplayUrl(user?.signatureUrl) });
  } catch (error: any) {
    console.error("[signature GET]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// ── 서명 저장 ────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    // 🔐 PREMIUM 체크
    const planCheck = await checkPlanAccess(BigInt(session.workerId), "PDF_SIGN");
    if (!planCheck.allowed) {
      return NextResponse.json({ success: false, message: planCheck.message }, { status: 403 });
    }

    const formData = await request.formData();
    const imageBlob = formData.get("signature") as Blob | null;

    const imgCheck = await validateSignatureImage(imageBlob!);
    if (!imgCheck.valid) {
      return NextResponse.json({ success: false, message: imgCheck.error }, { status: 400 });
    }

    const workerId = session.workerId;
    const fileName = `${workerId}/signature_${Date.now()}.png`;

    // 기존 서명 삭제 (있으면)
    const existing = await prisma.worker.findUnique({
      where: { id: BigInt(workerId) },
      select: { signatureUrl: true },
    });

    if (existing?.signatureUrl) {
      const oldPath = extractStoragePath(existing.signatureUrl);
      if (oldPath) await deleteFromStorage(oldPath);
    }

    // Supabase Storage 업로드
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${fileName}`;
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "image/png",
        "x-upsert": "true",
      },
      body: imageBlob,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      console.error("[signature] Storage 업로드 실패:", err);
      return NextResponse.json({ success: false, message: "서명 저장에 실패했습니다." }, { status: 500 });
    }

    // 서명 객체 경로만 저장(비공개 버킷). 표시=signed URL, PDF=imageToDataUri(service-role).
    //  (공개 URL을 저장하지 않는다 — 버킷 private이라 직접 접근 불가·의미 없음)
    await prisma.worker.update({
      where: { id: BigInt(workerId) },
      data: { signatureUrl: fileName },
    });

    return NextResponse.json({ success: true, signatureUrl: await signatureDisplayUrl(fileName) });
  } catch (error: any) {
    console.error("[signature POST]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// ── 서명 삭제 ────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const user = await prisma.worker.findUnique({
      where: { id: BigInt(session.workerId) },
      select: { signatureUrl: true },
    });

    if (user?.signatureUrl) {
      const path = extractStoragePath(user.signatureUrl);
      if (path) await deleteFromStorage(path);
    }

    await prisma.worker.update({
      where: { id: BigInt(session.workerId) },
      data: { signatureUrl: null },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[signature DELETE]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// ── 유틸 ─────────────────────────────────────────────────
function extractStoragePath(url: string): string | null {
  try {
    // 구(공개 URL)·신(signed URL)·신포맷(경로) 모두 처리 — 서명 저장 포맷 전환 대응.
    const pub = `/object/public/${BUCKET}/`;
    let i = url.indexOf(pub);
    if (i >= 0) return url.slice(i + pub.length).split("?")[0];
    const signed = `/object/sign/${BUCKET}/`;
    i = url.indexOf(signed);
    if (i >= 0) return url.slice(i + signed.length).split("?")[0];
    if (!/^https?:\/\//i.test(url) && !url.startsWith("data:")) return url.replace(/^\/+/, "");
    return null;
  } catch {
    return null;
  }
}

async function deleteFromStorage(path: string): Promise<void> {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;
  await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
}
