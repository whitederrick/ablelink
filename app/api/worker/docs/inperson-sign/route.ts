// app/api/worker/docs/inperson-sign/route.ts
// 사업체 담당자 인-퍼슨(폰 전달) 서명 저장 API
// 직무지도원이 인증된 상태에서 호출 → 담당자가 폰에 직접 서명

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { checkPlanAccess } from "@/lib/planGuard";
import { prisma } from "@/lib/prisma";
import { validateSignatureImage } from "@/lib/imageValidation";
import { signatureDisplayUrl } from "@/lib/signatureImage";
import { resolveDocAssignment } from "@/lib/docs/resolveDocAssignment";
import { normalizeDocType } from "@/lib/pdf";
import { randomUUID } from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "signatures";

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const workerId = BigInt(session.workerId);
    const planCheck = await checkPlanAccess(workerId, "SITE_MANAGER_SIGN");
    if (!planCheck.allowed) return NextResponse.json({ success: false, message: planCheck.message }, { status: 403 });

    const formData = await request.formData();
    const imageBlob = formData.get("signature") as Blob | null;
    // ★docType 표기 정규화(kebab↔SCREAMING 혼용 차단): 조회측(admin/docs/preview 등)이 normalizeDocType로
    //  SCREAMING 비교하므로 저장도 동일 정규화. 종전엔 원문 그대로 저장돼 kebab 호출자가 생기면 조회 불일치 잠복.
    const docType    = normalizeDocType((formData.get("docType") as string || "").trim());
    const periodStart = (formData.get("periodStart") as string || "").trim();
    const periodEnd   = (formData.get("periodEnd")   as string || "").trim();
    const signerNameRaw = (formData.get("signerName") as string || "").trim();

    // 공개 토큰 서명(sign/[token])과 동일한 이미지 검증(magic bytes MIME + 500KB 상한).
    // Content-Type 헤더는 위조 가능하므로 파일 내용 기반으로 확인.
    const imgCheck = await validateSignatureImage(imageBlob as Blob);
    if (!imgCheck.valid) {
      return NextResponse.json({ success: false, message: imgCheck.error }, { status: 400 });
    }
    if (!docType || !periodStart || !periodEnd) {
      return NextResponse.json({ success: false, message: "문서 정보가 누락되었습니다." }, { status: 400 });
    }

    // ★서명을 '선택 현장(assignmentId)'에 귀속 — 최신 배정을 임의로 고르면 다중현장 워커의 사업체 서명이
    //  엉뚱한 현장 문서에 붙는다(CD1). 문서 생성/미리보기와 동일한 resolveDocAssignment로 통일.
    let selAssignmentId: bigint | null = null;
    try { const raw = (formData.get("assignmentId") as string || "").trim(); selAssignmentId = raw ? BigInt(raw) : null; } catch { selAssignmentId = null; }
    const resolved = await resolveDocAssignment(workerId, selAssignmentId, { include: { site: { select: { businessContactName: true } } } });
    if (resolved.status === "ambiguous") {
      return NextResponse.json({ success: false, code: "SELECT_SITE", message: "여러 현장에 배정되어 있습니다. 현장을 선택한 뒤 서명해주세요." }, { status: 409 });
    }
    const assignment = resolved.status === "resolved" ? resolved.assignment : null;
    if (!assignment) {
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 404 });
    }

    // 서명자명 미입력 시 현장에 등록된 사업체 담당자명으로 자동 채움
    const signerName = signerNameRaw || assignment.site?.businessContactName || "사업체 담당자";

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

    // 서명 객체 경로만 저장(비공개 버킷). 표시=signed URL, PDF=imageToDataUri(service-role).
    const storedPath = fileName;

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
        signatureUrl: storedPath,
        usedAt: now,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return NextResponse.json({ success: true, token, signatureUrl: await signatureDisplayUrl(storedPath) });
  } catch (error: unknown) {
    console.error("[inperson-sign]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
