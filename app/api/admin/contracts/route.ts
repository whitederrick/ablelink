// app/api/admin/contracts/route.ts
// 근로계약서 생성/목록 조회

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess, checkQuota } from "@/lib/planGuard";
import { sendAlimtalk } from "@/lib/kakao";
import { randomUUID } from "crypto";
import { hash } from "bcryptjs";

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
    const scope = await requireManagerSession(req);
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const status = searchParams.get("status");

    const where: any = {};
    where.agencyId = scope.agencyId;
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
    const scope = await requireManagerSession(req);
    const body = await req.json();

    const {
      userId,       // 검색 팝업에서 선택한 기존 유저 ID (선택)
      manualName,   // 수동 입력: 이름
      manualPhone,  // 수동 입력: 전화번호
      contractStart, contractEnd,
      siteName, workType, commuteGuidanceIncluded,
      customWorkStart, customWorkEnd, adminMemo,
    } = body;

    if (!contractStart || !contractEnd) {
      throw new Error("VALIDATION:계약 시작일과 종료일은 필수입니다.");
    }

    const startDate = new Date(contractStart);
    const endDate   = new Date(contractEnd);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error("VALIDATION:날짜 형식이 올바르지 않습니다.");
    }
    if (endDate <= startDate) {
      throw new Error("VALIDATION:계약 종료일은 시작일보다 이후여야 합니다.");
    }

    // ─── 직무지도원 유저 확정 ─────────────────────────────────────
    let userIdBig: bigint;

    if (userId) {
      // 이력 검색에서 선택한 기존 유저
      try { userIdBig = BigInt(userId); }
      catch { throw new Error("VALIDATION:잘못된 userId입니다."); }
    } else {
      // 수동 입력: 이름 + 전화번호 필수
      const name  = (manualName  ?? "").trim();
      const phone = (manualPhone ?? "").trim();
      if (!name || !phone) {
        throw new Error("VALIDATION:직무지도원 이름과 전화번호는 필수입니다.");
      }
      if (!/^01[0-9]{1}-?[0-9]{3,4}-?[0-9]{4}$/.test(phone)) {
        throw new Error("VALIDATION:올바른 휴대폰 번호 형식이 아닙니다. (예: 01012345678)");
      }

      // 전화번호로 기존 유저 조회
      const existing = await prisma.worker.findFirst({
        where: { phoneNumber: phone },
        select: { id: true },
      });

      if (existing) {
        // 이미 등록된 유저
        userIdBig = existing.id;
      } else {
        // 신규 직무지도원 생성 — loginId는 항상 전화번호(하이픈 제거)
        const baseLogin = phone.replace(/-/g, "");
        const conflict  = await prisma.worker.findUnique({ where: { loginId: baseLogin } });
        const loginId   = conflict ? `${baseLogin}_${Date.now()}` : baseLogin;

        let newUser;
        try {
          newUser = await prisma.worker.create({
            data: {
              loginId,
              password: await hash(randomUUID(), 12), // 서명 완료 시 readable 임시 비밀번호로 교체됨
              userName: name,
              phoneNumber: phone,
              role: "COACH",
              status: "ACTIVE",
              isTemporary: true, // 최초 로그인 시 온보딩 플로우 강제
            },
          });
        } catch (e: any) {
          // loginId 레이스 컨디션(동시 요청) 대응: timestamp 충돌 시 재시도
          if (e?.code === "P2002") {
            newUser = await prisma.worker.create({
              data: {
                loginId: `${baseLogin}_${Date.now()}`,
                password: await hash(randomUUID(), 12),
                userName: name,
                phoneNumber: phone,
                role: "COACH",
                status: "ACTIVE",
                isTemporary: true,
              },
            });
          } else {
            throw e;
          }
        }
        userIdBig = newUser.id;
      }
    }

    // ─── agencyId 결정 ──────────────────────────────────────────
    const agencyId: bigint = scope.agencyId;

    // ─── 구독 플랜 + 한도 체크 ──────────────────────────────────
    const planCheck = await checkAgencyPlanAccess(agencyId, "CONTRACT_ONLINE");
    if (!planCheck.allowed) {
      return NextResponse.json({ success: false, message: planCheck.message, reason: planCheck.reason }, { status: 403 });
    }
    const quotaCheck = await checkQuota(agencyId, "coaches");
    if (!quotaCheck.allowed) {
      return NextResponse.json({
        success: false,
        message: `직무지도원 한도(${quotaCheck.max}명)에 도달했습니다. 플랜을 업그레이드해주세요.`,
        reason: "QUOTA_EXCEEDED",
      }, { status: 403 });
    }

    // ─── 계약서 생성 ────────────────────────────────────────────
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
        createdByManagerId: scope.managerId,
      },
    });

    // ─── 카카오 알림톡 발송 ─────────────────────────────────────
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://able-link.co.kr";
    const contractUrl = `${baseUrl}/contract/${signToken}`;
    let kakaoSent = false;
    let kakaoError: string | undefined;

    try {
      await sendKakaoAlimtalk({ userId: userIdBig, contractUrl, contractId: String(contract.id) });
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

// ── 카카오 알림톡: 계약서 서명 요청 ────────────────────────────
async function sendKakaoAlimtalk(params: { userId: bigint; contractUrl: string; contractId: string }) {
  const templateCode = process.env.KAKAO_CONTRACT_TEMPLATE_CODE;
  if (!templateCode) throw new Error("KAKAO_CONTRACT_TEMPLATE_CODE 미설정");

  const user = await prisma.worker.findUnique({
    where: { id: params.userId },
    select: { phoneNumber: true, userName: true },
  });
  if (!user) throw new Error("사용자를 찾을 수 없습니다.");

  await sendAlimtalk({
    phone: user.phoneNumber, name: user.userName,
    templateCode,
    subject: "근로계약서 서명 요청",
    message: `안녕하세요 ${user.userName}님,\n\nAbleLink 근로계약서 서명을 요청드립니다.\n아래 링크에서 확인 후 서명해 주세요.\n\n${params.contractUrl}\n\n링크는 7일간 유효합니다.`,
    buttons: [{ name: "계약서 서명하기", linkType: "WL", linkMo: params.contractUrl, linkPc: params.contractUrl }],
  });
}
