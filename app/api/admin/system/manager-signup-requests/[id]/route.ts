// app/api/admin/system/manager-signup-requests/[id]/route.ts
// 시스템 운영자 전용: 관리자 가입 신청 상세 조회 + 승인/반려

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
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

    // ★상태 재확인을 조건부 claim으로(TOCTOU): 위 :104 가드는 트랜잭션 밖 read라, 두 운영자가 같은 신청을 동시
    //  처리하면 approve가 Agency·Manager(로그인 가능) 생성 후 reject가 status를 덮어 '반려인데 실사용 가능 계정
    //  잔존'이 된다(크리덴셜 발급). updateMany({status:PENDING}) claim으로 직렬화, count===0이면 이미 처리됨(409).
    class AlreadyProcessed extends Error {}

    if (action === "reject") {
      const claim = await prisma.managerSignupRequest.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: { status: "REJECTED", reviewNote, reviewedAt: now, reviewedById: scope.adminId },
      });
      if (claim.count === 0) return NextResponse.json({ success: false, message: "이미 처리된 신청입니다." }, { status: 409 });
      const updated = await prisma.managerSignupRequest.findUnique({ where: { id: requestId } });
      return NextResponse.json({ success: true, item: toDetail(updated!, null) });
    }

    // action === "approve"
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
      // ★claim 먼저 — 실패(이미 처리)면 Agency·Manager 생성 전에 중단.
      const claim = await tx.managerSignupRequest.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: { status: "APPROVED", reviewNote, reviewedAt: now, reviewedById: scope.adminId },
      });
      if (claim.count === 0) throw new AlreadyProcessed();
      // 1. Agency 생성
      // 이미 같은 이름의 위탁기관가 있을 수 있으므로 확인
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
    } catch (e) {
      if (e instanceof AlreadyProcessed) return NextResponse.json({ success: false, message: "이미 처리된 신청입니다." }, { status: 409 });
      // ★E-4 경합: 위 Agency는 findUnique(name) → create의 TOCTOU다. 같은 기관명 신청 2건을 동시에
      //  승인하면 둘 다 findUnique에서 null을 보고 create해 unique(name) 위반(P2002)이 난다.
      //  Manager.loginId도 같은 클래스(findUnique → create).
      //  트랜잭션 안에서 P2002를 잡아 재조회하는 복구는 불가능하다 — Postgres는 오류 발생 시점에 트랜잭션을
      //  abort하므로 이후 쿼리가 전부 실패한다. 대신 트랜잭션이 통째로 롤백되면서 claim(status=APPROVED)도
      //  함께 되돌아가 PENDING으로 복원되므로, 재시도하면 이번엔 findUnique가 상대가 만든 행을 찾아 정상 승인된다.
      //  → 데이터 훼손 없는 순수 경합이므로 500(서버 오류)이 아니라 409(재시도 가능)로 알린다.
      if ((e as { code?: string })?.code === "P2002") {
        return NextResponse.json(
          { success: false, message: "다른 승인 처리와 동시에 실행되어 반영되지 않았습니다. 잠시 후 다시 시도해주세요." },
          { status: 409 },
        );
      }
      throw e;
    }

    return NextResponse.json({ success: true, item: toDetail(result, null) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/manager-signup-requests/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
