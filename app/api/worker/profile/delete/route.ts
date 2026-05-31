// DELETE /api/worker/profile/delete — 회원 탈퇴
// 비밀번호 확인 후 PII 익명화 + 세션 쿠키 삭제
// (출퇴근·일지 기록은 에이전시 운영 기록이므로 보존, 개인정보만 제거)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { getWorkerSessionFromReq, WORKER_COOKIE } from "@/app/worker/_lib/session";

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "signatures";

function extractStoragePath(url: string): string | null {
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

async function deleteStorageFile(path: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    });
  } catch {
    // 스토리지 삭제 실패는 non-fatal — 익명화는 계속 진행
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const body = await request.json();
    const password = String(body?.password ?? "");
    if (!password) return NextResponse.json({ success: false, message: "비밀번호를 입력해주세요." }, { status: 400 });

    const user = await prisma.worker.findUnique({
      where: { id: BigInt(session.workerId) },
      select: { id: true, password: true, status: true, signatureUrl: true },
    });
    if (!user) return NextResponse.json({ success: false, message: "사용자를 찾을 수 없습니다." }, { status: 404 });

    const valid = await verifyPassword(password, user.password);
    if (!valid) return NextResponse.json({ success: false, message: "비밀번호가 올바르지 않습니다." }, { status: 400 });

    // Supabase Storage 서명 이미지 실제 삭제 (개인정보보호)
    if (user.signatureUrl) {
      const path = extractStoragePath(user.signatureUrl);
      if (path) await deleteStorageFile(path);
    }

    const anonymousId = `deleted_${user.id}_${Date.now()}`;

    // PII 익명화 (출퇴근·일지 기록은 에이전시 운영 기록으로 보존)
    await prisma.worker.update({
      where: { id: user.id },
      data: {
        loginId:        anonymousId,
        workerName:       "탈퇴한 회원",
        phoneNumber:    anonymousId,
        password:       anonymousId,
        status:         "RESIGNED",
        signatureUrl:   null,
        // 본인인증·온보딩 잔여값 제거
        ciKey:          null,   // 실명 연계 식별자 — 탈퇴 시 반드시 파기
        pendingLoginId: null,   // 변경 대기 중이던 이메일
        verifyCode:     null,
        verifyCodeExpiresAt: null,
        // 거주지·자기소개 등 매칭용 PII 제거
        residenceAddress: null,
        residenceLat:     null,
        residenceLon:     null,
        bio:              null,
        consentTermsAt:   null,
        consentPrivacyAt:  null,
        consentLocationAt: null,
        // 마켓플레이스: 더 이상 검색·컨택 노출되지 않도록
        openToOffers:     false,
      },
    });

    // 마켓플레이스 잔여 처리: 자격 cert(준PII) 파기, 진행중 신청/제안 정리
    await prisma.workerProfession.updateMany({ where: { workerId: user.id }, data: { certNumber: null, certDocUrl: null } });
    await prisma.recruitApplication.updateMany({ where: { workerId: user.id, status: "PENDING" }, data: { status: "WITHDRAWN" } });
    await prisma.talentOffer.updateMany({ where: { workerId: user.id, status: "PENDING" }, data: { status: "DECLINED", decidedAt: new Date() } });

    const res = NextResponse.json({ success: true });
    res.cookies.set(WORKER_COOKIE, "", {
      httpOnly: true, secure: process.env.NODE_ENV === "production",
      sameSite: "lax", maxAge: 0, path: "/",
    });
    return res;
  } catch (err) {
    console.error("[profile/delete]", err);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
