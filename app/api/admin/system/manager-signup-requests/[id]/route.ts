// app/api/admin/system/manager-signup-requests/[id]/route.ts
// 시스템 운영자 전용: 관리자 가입 신청 상세 조회 + 승인/반려

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";

type Params = { params: Promise<{ id: string }> };

const BUCKET_NAME = "business-docs";
const SIGNED_URL_EXPIRES_SEC = 3600; // 1시간

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function resolveDocumentUrl(rawPath: string | null): Promise<string | null> {
  if (!rawPath) return null;
  // 이미 HTTP URL이면 그대로 반환 (구버전 데이터 호환)
  if (rawPath.startsWith("http")) return rawPath;
  // 파일 경로 → signed URL 생성
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(rawPath, SIGNED_URL_EXPIRES_SEC);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function toDetail(r: any, documentUrl: string | null) {
  return {
    id:                 String(r.id),
    agencyName:         r.agencyName,
    businessNumber:     r.businessNumber,
    businessNumberType: r.businessNumberType,
    loginId:            r.loginId,
    displayName:        r.displayName ?? null,
    phoneNumber:        r.phoneNumber ?? null,
    documentUrl,
    status:             r.status,
    ntsVerified:        r.ntsVerified,
    ntsBusinessName:    r.ntsBusinessName ?? null,
    reviewNote:         r.reviewNote ?? null,
    reviewedAt:         r.reviewedAt?.toISOString() ?? null,
    agencyId:           r.agencyId != null ? String(r.agencyId) : null,
    managerId:          r.managerId != null ? String(r.managerId) : null,
    createdAt:          r.createdAt.toISOString(),
    updatedAt:          r.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireAdminSession(req);

    const { id } = await params;
    const requestId = parseBigInt(id);
    if (!requestId) {
      return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    }

    const request = await prisma.managerSignupRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      return NextResponse.json({ success: false, message: "신청 내역을 찾을 수 없습니다." }, { status: 404 });
    }

    const documentUrl = await resolveDocumentUrl(request.documentUrl);
    return NextResponse.json({ success: true, item: toDetail(request, documentUrl) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/manager-signup-requests/[id] GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const scope = await requireAdminSession(req);

    const { id } = await params;
    const requestId = parseBigInt(id);
    if (!requestId) {
      return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    }

    const existing = await prisma.managerSignupRequest.findUnique({
      where: { id: requestId },
    });

    if (!existing) {
      return NextResponse.json({ success: false, message: "신청 내역을 찾을 수 없습니다." }, { status: 404 });
    }

    if (existing.status !== "PENDING") {
      return NextResponse.json(
        { success: false, message: "이미 처리된 신청입니다." },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const action     = String(body?.action ?? "").trim();
    const reviewNote = body?.reviewNote != null ? String(body.reviewNote).trim() : null;

    if (!["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { success: false, message: "action은 'approve' 또는 'reject'여야 합니다." },
        { status: 400 }
      );
    }

    const now = new Date();

    if (action === "reject") {
      const updated = await prisma.managerSignupRequest.update({
        where: { id: requestId },
        data: {
          status:      "REJECTED",
          reviewNote:  reviewNote,
          reviewedAt:  now,
          reviewedById: scope.adminId,
        },
      });
      return NextResponse.json({ success: true, item: toDetail(updated, null) });
    }

    // action === "approve"
    const result = await prisma.$transaction(async (tx) => {
      // 1. Agency 생성
      // 이미 같은 이름의 에이전시가 있을 수 있으므로 확인
      let agency = await tx.agency.findUnique({
        where: { name: existing.agencyName },
        select: { id: true },
      });

      if (!agency) {
        agency = await tx.agency.create({
          data: {
            name:           existing.agencyName,
            businessNumber: existing.businessNumber,
            planType:       "FREE",
          },
          select: { id: true },
        });
      }

      // 2. Manager 계정 생성
      // loginId 중복 확인
      const existingMgr = await tx.manager.findUnique({
        where: { loginId: existing.loginId },
        select: { id: true },
      });

      let manager;
      if (existingMgr) {
        manager = existingMgr;
      } else {
        manager = await tx.manager.create({
          data: {
            loginId:      existing.loginId,
            passwordHash: existing.passwordHash,
            displayName:  existing.displayName,
            agencyId:     agency.id,
            isActive:     true,
          },
          select: { id: true },
        });
      }

      // 3. ManagerSignupRequest 업데이트
      const updated = await tx.managerSignupRequest.update({
        where: { id: requestId },
        data: {
          status:       "APPROVED",
          reviewNote:   reviewNote,
          reviewedAt:   now,
          reviewedById: scope.adminId,
          agencyId:     agency.id,
          managerId:    manager.id,
        },
      });

      return updated;
    });

    return NextResponse.json({ success: true, item: toDetail(result, null) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/manager-signup-requests/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
