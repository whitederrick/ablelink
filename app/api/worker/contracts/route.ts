// app/api/worker/contracts/route.ts
// 직무지도원 계약서 조회 및 서명 API

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAlimtalk } from "@/lib/kakao";
import { hash } from "bcryptjs";
import { randomInt } from "crypto";

const WORK_TYPE_LABELS: Record<string, string> = {
  AM:       "오전 4시간 (09:00~12:00)",
  PM:       "오후 4시간 (13:00~17:00)",
  FULL_DAY: "전일 8시간 (09:00~18:00)",
  CUSTOM:   "직접 지정",
};

// GET: 토큰으로 계약서 조회 (비로그인 허용 — 카카오 링크 접근)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ success: false, message: "토큰이 없습니다." }, { status: 400 });
  }

  const contract = await prisma.employmentContract.findUnique({
    where: { signToken: token },
    include: {
      user: { select: { workerName: true, phoneNumber: true } },
      agency: { select: { name: true, address: true, phoneNumber: true } },
    },
  });

  if (!contract) {
    return NextResponse.json({ success: false, message: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  if (new Date() > contract.tokenExpiresAt) {
    return NextResponse.json({ success: false, message: "만료된 링크입니다. 관리자에게 재발급을 요청하세요." }, { status: 410 });
  }

  const workTypeLabel = contract.workType ? (WORK_TYPE_LABELS[contract.workType] ?? contract.workType) : "미정";
  const customTimeStr = contract.workType === "CUSTOM" && contract.customWorkStart && contract.customWorkEnd
    ? ` (${contract.customWorkStart}~${contract.customWorkEnd})`
    : "";

  return NextResponse.json({
    success: true,
    data: {
      id: String(contract.id),
      status: contract.status,
      workerName: contract.user.workerName,
      workerPhone: contract.user.phoneNumber,
      agencyName: contract.agency.name,
      agencyAddress: contract.agency.address,
      agencyPhone: contract.agency.phoneNumber,
      contractStart: contract.contractStart.toISOString().slice(0, 10),
      contractEnd: contract.contractEnd.toISOString().slice(0, 10),
      siteName: contract.siteName,
      workTypeLabel: workTypeLabel + customTimeStr,
      commuteGuidanceIncluded: contract.commuteGuidanceIncluded,
      // 직무지도원이 직접 입력한 내용 (관리자가 미입력 시)
      workerFilledSiteName: contract.workerFilledSiteName,
      workerFilledWorkType: contract.workerFilledWorkType,
      workerSignedAt: contract.workerSignedAt?.toISOString() ?? null,
      adminSignedAt: contract.adminSignedAt?.toISOString() ?? null,
      workerSignatureUrl: contract.workerSignatureUrl,
    },
  });
}

// POST: 직무지도원 서명 처리
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, signatureUrl, workerFilledSiteName, workerFilledWorkType } = body;

  if (!token || !signatureUrl) {
    return NextResponse.json({ success: false, message: "필수 항목이 없습니다." }, { status: 400 });
  }
  if (typeof token !== "string" || token.length > 128) {
    return NextResponse.json({ success: false, message: "잘못된 토큰입니다." }, { status: 400 });
  }
  if (!signatureUrl.startsWith("data:image/")) {
    return NextResponse.json({ success: false, message: "잘못된 서명 형식입니다." }, { status: 400 });
  }
  if (signatureUrl.length > 2 * 1024 * 1024) {
    return NextResponse.json({ success: false, message: "서명 이미지가 너무 큽니다." }, { status: 400 });
  }
  if (workerFilledSiteName && (typeof workerFilledSiteName !== "string" || workerFilledSiteName.length > 200)) {
    return NextResponse.json({ success: false, message: "사업체명이 너무 깁니다." }, { status: 400 });
  }
  if (workerFilledWorkType && (typeof workerFilledWorkType !== "string" || workerFilledWorkType.length > 100)) {
    return NextResponse.json({ success: false, message: "근무형태 값이 너무 깁니다." }, { status: 400 });
  }

  const contract = await prisma.employmentContract.findUnique({
    where: { signToken: token },
  });

  if (!contract) {
    return NextResponse.json({ success: false, message: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  if (new Date() > contract.tokenExpiresAt) {
    return NextResponse.json({ success: false, message: "만료된 링크입니다." }, { status: 410 });
  }

  if (contract.status !== "PENDING") {
    return NextResponse.json({ success: false, message: "이미 서명이 완료된 계약서입니다." }, { status: 409 });
  }

  const user = await prisma.worker.findUnique({
    where: { id: contract.workerId },
    select: { workerName: true, phoneNumber: true, isTemporary: true },
  });

  await prisma.employmentContract.update({
    where: { id: contract.id },
    data: {
      status: "SIGNED",
      workerSignedAt: new Date(),
      workerSignatureUrl: signatureUrl,
      workerFilledSiteName: workerFilledSiteName || null,
      workerFilledWorkType: workerFilledWorkType || null,
    },
  });

  // 서명 완료 후 카카오 알림 발송 (실패해도 서명 결과에 영향 없음)
  try {
    if (user?.isTemporary) {
      await sendSignedNotificationNew(contract.workerId, user.phoneNumber, user.workerName);
    } else if (user) {
      await sendSignedNotificationExisting(user.phoneNumber, user.workerName);
    }
  } catch (e) {
    console.error("[contracts sign] 카카오 알림 발송 실패:", e);
  }

  return NextResponse.json({ success: true, message: "서명이 완료되었습니다." });
}

// ─── 읽기 쉬운 임시 비밀번호 생성 (crypto.randomInt — 예측 불가) ──
function generateTempPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // 혼동 문자(0/O, 1/l/I) 제외
  return Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join("");
}

// ─── 신규 직무지도원 서명 완료 알림 (임시 비밀번호 발급) ──────────
async function sendSignedNotificationNew(workerId: bigint, phone: string, name: string) {
  const templateCode = process.env.KAKAO_SIGNUP_TEMPLATE_CODE;
  const appUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://able-link.co.kr";
  const loginId = phone.replace(/-/g, "");

  if (!templateCode) {
    console.warn("[contracts sign] KAKAO_SIGNUP_TEMPLATE_CODE 미설정 — 임시 비밀번호 발급 건너뜀");
    return;
  }

  const tempPassword = generateTempPassword();
  await prisma.worker.update({ where: { id: workerId }, data: { password: await hash(tempPassword, 12) } });

  await sendAlimtalk({
    phone, name, templateCode,
    subject: "AbleLink 가입 안내",
    message: `안녕하세요 ${name}님,\n\n근로계약서 서명이 완료되었습니다.\nAbleLink 서비스를 이용하시려면 아래 정보로 로그인해 주세요.\n\n임시 아이디: ${loginId}\n임시 비밀번호: ${tempPassword}\n\n첫 로그인 후 아이디와 비밀번호를 변경해 주세요.\n\n${appUrl}/worker/login`,
    buttons: [{ name: "로그인하기", linkType: "WL", linkMo: `${appUrl}/worker/login`, linkPc: `${appUrl}/worker/login` }],
  });
}

// ─── 기존 직무지도원 서명 완료 알림 ─────────────────────────────
async function sendSignedNotificationExisting(phone: string, name: string) {
  const templateCode = process.env.KAKAO_CONTRACT_SIGNED_TEMPLATE_CODE;
  const appUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://able-link.co.kr";

  if (!templateCode) {
    console.warn("[contracts sign] KAKAO_CONTRACT_SIGNED_TEMPLATE_CODE 미설정 — 알림 건너뜀");
    return;
  }

  await sendAlimtalk({
    phone, name, templateCode,
    subject: "AbleLink 계약 안내",
    message: `안녕하세요 ${name}님,\n\n새 근로계약서 서명이 완료되었습니다.\nAbleLink에 기존 아이디로 로그인하여 확인해 주세요.\n\n${appUrl}/worker/login`,
    buttons: [{ name: "로그인하기", linkType: "WL", linkMo: `${appUrl}/worker/login`, linkPc: `${appUrl}/worker/login` }],
  });
}
