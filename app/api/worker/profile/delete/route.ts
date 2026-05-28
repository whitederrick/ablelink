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

    const user = await prisma.user.findUnique({
      where: { id: BigInt(session.userId) },
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
    await prisma.user.update({
      where: { id: user.id },
      data: {
        loginId:        anonymousId,
        userName:       "탈퇴한 회원",
        phoneNumber:    anonymousId,
        password:       anonymousId,
        status:         "RESIGNED",
        signatureUrl:   null,
        verifyCode:     null,
        verifyCodeExpiresAt: null,
        consentTermsAt:   null,
        consentPrivacyAt:  null,
        consentLocationAt: null,
      },
    });

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
