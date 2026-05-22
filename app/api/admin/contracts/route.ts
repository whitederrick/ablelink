// app/api/admin/contracts/route.ts
// 근로계약서 생성/목록 조회

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";
import { randomUUID } from "crypto";

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN")    return 403;
  if (msg === "NOT_FOUND")    return 404;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

// GET: 계약서 목록
export async function GET(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const status = searchParams.get("status");

    const where: any = {};
    if (scope.role === "AGENCY") {
      where.agencyId = requireAgencyScope(scope);
    }
    if (userId) {
      try { where.userId = BigInt(userId); }
      catch { return NextResponse.json({ success: false, message: "잘못된 userId입니다." }, { status: 400 }); }
    }
    const VALID_STATUSES = ["PENDING", "SIGNED", "COMPLETED", "CANCELLED"];
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json({ success: false, message: "유효하지 않은 status입니다." }, { status: 400 });
      }
      where.status = status;
    }

    const rows = await prisma.employmentContract.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        user: { select: { userName: true, phoneNumber: true } },
      },
    });

    return NextResponse.json({
      success: true,
      items: rows.map(r => ({
        id: String(r.id),
        userId: String(r.userId),
        userName: r.user.userName,
        userPhone: r.user.phoneNumber,
        contractStart: r.contractStart.toISOString(),
        contractEnd: r.contractEnd.toISOString(),
        siteName: r.siteName,
        workType: r.workType,
        commuteGuidanceIncluded: r.commuteGuidanceIncluded,
        status: r.status,
        signToken: r.signToken,
        tokenExpiresAt: r.tokenExpiresAt.toISOString(),
        coachSignedAt: r.coachSignedAt?.toISOString() ?? null,
        adminSignedAt: r.adminSignedAt?.toISOString() ?? null,
        pdfUrl: r.pdfUrl,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: e?.message ?? "UNKNOWN" }, { status: errToStatus(e?.message) });
  }
}

// POST: 계약서 생성 및 카카오 알림톡 링크 발송
export async function POST(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    const body = await req.json();

    const {
      userId, contractStart, contractEnd,
      siteName, workType, commuteGuidanceIncluded,
      customWorkStart, customWorkEnd, adminMemo,
    } = body;

    if (!userId || !contractStart || !contractEnd) {
      throw new Error("VALIDATION:필수 항목을 입력해주세요.");
    }

    let userIdBig: bigint;
    try { userIdBig = BigInt(userId); }
    catch { throw new Error("VALIDATION:잘못된 userId입니다."); }

    const startDate = new Date(contractStart);
    const endDate   = new Date(contractEnd);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error("VALIDATION:날짜 형식이 올바르지 않습니다.");
    }
    if (endDate <= startDate) {
      throw new Error("VALIDATION:계약 종료일은 시작일보다 이후여야 합니다.");
    }

    let agencyId: bigint;
    if (scope.role === "AGENCY") {
      agencyId = requireAgencyScope(scope);
    } else {
      // ADMIN: userId의 배정에서 agencyId 추출
      const assignment = await prisma.siteAssignment.findFirst({
        where: { userId: userIdBig, status: { in: ["ACTIVE", "CONFIRMED", "ASSIGNED"] } },
        select: { agencyId: true },
      });
      if (!assignment?.agencyId) throw new Error("VALIDATION:에이전시 정보를 찾을 수 없습니다.");
      agencyId = assignment.agencyId;
    }

    const signToken = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일

    const contract = await prisma.employmentContract.create({
      data: {
        agencyId,
        userId: userIdBig,
        contractStart: startDate,
        contractEnd: endDate,
        siteName: siteName || null,
        workType: workType || null,
        commuteGuidanceIncluded: workType === "FULL_DAY" ? false : (commuteGuidanceIncluded !== false),
        customWorkStart: workType === "CUSTOM" ? customWorkStart : null,
        customWorkEnd:   workType === "CUSTOM" ? customWorkEnd   : null,
        adminMemo: adminMemo || null,
        signToken,
        tokenExpiresAt: expiresAt,
        status: "PENDING",
        createdByAdminId: scope.userId,
      },
    });

    // 카카오 알림톡 발송
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://able-link.co.kr";
    const contractUrl = `${baseUrl}/contract/${signToken}`;
    let kakaoSent = false;
    let kakaoError: string | undefined;

    try {
      await sendKakaoAlimtalk({
        userId: BigInt(userId),
        contractUrl,
        contractId: String(contract.id),
      });
      kakaoSent = true;
      await prisma.employmentContract.update({
        where: { id: contract.id },
        data: { tokenSentAt: new Date() },
      });
    } catch (err: any) {
      console.error("[contracts] 카카오 알림톡 발송 실패:", err?.message ?? err);
      kakaoError = "알림톡 발송에 실패했습니다. 링크를 직접 공유해주세요.";
    }

    return NextResponse.json({
      success: true,
      contractId: String(contract.id),
      signToken,
      contractUrl,
      kakaoSent,
      message: kakaoSent ? "알림톡이 발송되었습니다." : (kakaoError ?? "계약서가 생성되었습니다."),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[contracts POST]", e);
    return NextResponse.json({ success: false, message: e?.message ?? "UNKNOWN" }, { status: errToStatus(e?.message) });
  }
}

// ── 카카오 알림톡 발송 ──────────────────────────────────────────
async function sendKakaoAlimtalk(params: { userId: bigint; contractUrl: string; contractId: string }) {
  const apiKey = process.env.KAKAO_ALIMTALK_API_KEY;
  const senderKey = process.env.KAKAO_ALIMTALK_SENDER_KEY;
  const templateCode = process.env.KAKAO_CONTRACT_TEMPLATE_CODE;

  if (!apiKey || !senderKey || !templateCode) {
    throw new Error("카카오 알림톡 설정이 없습니다. 환경변수를 확인하세요.");
  }

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { phoneNumber: true, userName: true },
  });
  if (!user) throw new Error("사용자를 찾을 수 없습니다.");

  // 알리고 또는 솔라피 API 형식 (실제 사용 API에 맞게 조정 필요)
  const res = await fetch("https://kakaoapi.aligo.in/akv10/alimtalk/send/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      apikey: apiKey,
      userid: process.env.KAKAO_ALIMTALK_USERID || "",
      senderkey: senderKey,
      tpl_code: templateCode,
      sender: process.env.KAKAO_ALIMTALK_SENDER_PHONE || "",
      receiver_1: user.phoneNumber.replace(/-/g, ""),
      recvname_1: user.userName,
      subject_1: "근로계약서 서명 요청",
      message_1: `안녕하세요 ${user.userName}님,\n\nAbleLink 근로계약서 서명을 요청드립니다.\n아래 링크에서 확인 후 서명해 주세요.\n\n${params.contractUrl}\n\n링크는 7일간 유효합니다.`,
      button_1: JSON.stringify({
        button: [{ name: "계약서 서명하기", linkType: "WL", linkMo: params.contractUrl, linkPc: params.contractUrl }],
      }),
    }).toString(),
  });

  if (!res.ok) throw new Error(`알림톡 API 오류: ${res.status}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`알림톡 발송 실패: ${data.message}`);
}
