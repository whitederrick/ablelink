// app/api/worker/docs/inperson-sign/route.ts
// 사업체 담당자 인-퍼슨(폰 전달) 서명 저장 API
// 직무지도원이 인증된 상태에서 호출 → 담당자가 폰에 직접 서명

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "signatures";

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const formData = await request.formData();
    const imageBlob = formData.get("signature") as Blob | null;
    const docType    = (formData.get("docType")    as string || "").trim();
    const periodStart = (formData.get("periodStart") as string || "").trim();
    const periodEnd   = (formData.get("periodEnd")   as string || "").trim();
    const signerName  = (formData.get("signerName")  as string || "사업체 담당자").trim();

    if (!imageBlob || imageBlob.size === 0) {
      return NextResponse.json({ success: false, message: "서명 이미지가 없습니다." }, { status: 400 });
    }
    if (!docType || !periodStart || !periodEnd) {
      return NextResponse.json({ success: false, message: "문서 정보가 누락되었습니다." }, { status: 400 });
    }

    const userId = BigInt(session.userId);
    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
      orderBy: { assignedAt: "desc" },
    });
    if (!assignment) {
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 404 });
    }

    // Supabase Storage 업로드
    const fileName = `inperson/${assignment.id}/${docType}_${periodStart}_${Date.now()}.png`;
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
      console.error("[inperson-sign] 업로드 실패:", await uploadRes.text());
      return NextResponse.json({ success: false, message: "서명 저장에 실패했습니다." }, { status: 500 });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`;

    // 기존 미사용 토큰 무효화
    await prisma.siteSignToken.deleteMany({
      where: { assignmentId: assignment.id, docType, periodStart, periodEnd, signRole: "company_manager", usedAt: null },
    });

    // SiteSignToken에 즉시 서명 완료로 기록
    const token = randomUUID();
    const now = new Date();
    await prisma.siteSignToken.create({
      data: {
        token,
        docType,
        assignmentId: assignment.id,
        periodStart,
        periodEnd,
        signRole: "company_manager",
        signerName,
        signatureUrl: publicUrl,
        usedAt: now,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return NextResponse.json({ success: true, token, signatureUrl: publicUrl });
  } catch (error: any) {
    console.error("[inperson-sign]", error);
    return NextResponse.json({ success: false, message: error.message || "서버 오류" }, { status: 500 });
  }
}
