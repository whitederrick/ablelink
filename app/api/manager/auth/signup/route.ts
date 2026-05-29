// app/api/manager/auth/signup/route.ts
// 에이전시 관리자 자체 가입 신청 (인증 불필요)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyBusinessNumber } from "@/lib/ntsVerify";

function errToStatus(msg: string) {
  if (msg.startsWith("VALIDATION:")) return 400;
  if (msg === "CONFLICT") return 409;
  return 500;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const agencyName         = String(body?.agencyName ?? "").trim();
    const rawBno             = String(body?.businessNumber ?? "").trim();
    const businessNumberType = String(body?.businessNumberType ?? "BUSINESS").trim();
    const loginId            = String(body?.loginId ?? "").trim();
    const password           = String(body?.password ?? "");
    const displayName        = body?.displayName != null ? String(body.displayName).trim() : null;
    const phoneNumber        = body?.phoneNumber != null ? String(body.phoneNumber).trim() : null;
    const documentUrl        = body?.documentUrl != null ? String(body.documentUrl).trim() : null;

    // 입력 검증
    if (!agencyName) {
      return NextResponse.json({ success: false, message: "기관명은 필수입니다." }, { status: 400 });
    }

    const businessNumber = rawBno.replace(/-/g, "").trim();
    if (!/^\d{10}$/.test(businessNumber)) {
      return NextResponse.json(
        { success: false, message: "사업자등록번호(고유번호)는 하이픈 제거 후 10자리 숫자여야 합니다." },
        { status: 400 }
      );
    }

    if (loginId.length < 4) {
      return NextResponse.json(
        { success: false, message: "아이디는 4자 이상이어야 합니다." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { success: false, message: "비밀번호는 8자 이상이어야 합니다." },
        { status: 400 }
      );
    }

    // 중복 확인: loginId
    const [existingLoginId, existingBno] = await Promise.all([
      prisma.managerSignupRequest.findUnique({ where: { loginId }, select: { id: true } }),
      prisma.managerSignupRequest.findFirst({ where: { businessNumber }, select: { id: true } }),
    ]);

    if (existingLoginId) {
      return NextResponse.json(
        { success: false, message: "이미 사용 중인 아이디입니다." },
        { status: 409 }
      );
    }
    if (existingBno) {
      return NextResponse.json(
        { success: false, message: "이미 가입 신청된 사업자등록번호입니다." },
        { status: 409 }
      );
    }

    // Manager 테이블에서도 중복 확인
    const existingManager = await prisma.manager.findUnique({
      where: { loginId },
      select: { id: true },
    });
    if (existingManager) {
      return NextResponse.json(
        { success: false, message: "이미 사용 중인 아이디입니다." },
        { status: 409 }
      );
    }

    // 국세청 API 검증 (실패해도 진행)
    const ntsResult = await verifyBusinessNumber(businessNumber);
    const ntsVerified     = ntsResult.valid === true;
    const ntsBusinessName = ntsResult.businessName ?? null;

    // 비밀번호 해시
    const passwordHash = await bcrypt.hash(password, 12);

    // ManagerSignupRequest 생성
    const request = await prisma.managerSignupRequest.create({
      data: {
        agencyName,
        businessNumber,
        businessNumberType,
        documentUrl: documentUrl || null,
        loginId,
        passwordHash,
        displayName: displayName || null,
        phoneNumber: phoneNumber || null,
        ntsVerified,
        ntsBusinessName,
      },
      select: { id: true, ntsVerified: true, ntsBusinessName: true },
    });

    return NextResponse.json({
      success:         true,
      requestId:       String(request.id),
      ntsVerified:     request.ntsVerified,
      ntsBusinessName: request.ntsBusinessName,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[manager/auth/signup POST]", e);
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const loginId = (searchParams.get("loginId") || "").trim();

    if (!loginId) {
      return NextResponse.json(
        { success: false, message: "loginId 파라미터가 필요합니다." },
        { status: 400 }
      );
    }

    const request = await prisma.managerSignupRequest.findUnique({
      where: { loginId },
      select: {
        id:         true,
        agencyName: true,
        status:     true,
        reviewNote: true,
        createdAt:  true,
        reviewedAt: true,
      },
    });

    if (!request) {
      return NextResponse.json({ success: false, message: "신청 내역이 없습니다." }, { status: 404 });
    }

    return NextResponse.json({
      success:    true,
      requestId:  String(request.id),
      agencyName: request.agencyName,
      status:     request.status,
      reviewNote: request.reviewNote ?? null,
      createdAt:  request.createdAt.toISOString(),
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[manager/auth/signup GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
