// app/api/recruit/auth/signup/route.ts
// 마켓플레이스 가벼운 회원가입 (기존 /worker/auth/signup 과 별개)
// 전화 OTP 인증 + 이름/비번/약관만. 자격 증빙은 "최초 신청 시"에 받는다(저장되면 재요구 X).
// professions는 선택(관심 직종 표기용, 미입력 가능). → Worker 생성 + 자동 로그인.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { signWorkerToken, WORKER_COOKIE } from "@/app/worker/_lib/session";

const PHONE_RE = /^01[0-9]{8,9}$/;
const PROFESSIONS = ["JOB_COACH", "CAREGIVER", "ACTIVITY_ASSISTANT"] as const;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const phone    = String(body?.phoneNumber ?? "").replace(/-/g, "").trim();
    const name     = String(body?.workerName ?? "").trim();
    const password = String(body?.password ?? "");
    const consentTerms    = body?.consentTerms    === true;
    const consentPrivacy  = body?.consentPrivacy  === true;
    const consentLocation = body?.consentLocation === true;
    const profsInput: any[] = Array.isArray(body?.professions) ? body.professions : [];

    if (!PHONE_RE.test(phone))  return NextResponse.json({ success: false, message: "올바른 휴대전화번호를 입력해주세요." }, { status: 400 });
    if (name.length < 2)        return NextResponse.json({ success: false, message: "이름은 2자 이상이어야 합니다." }, { status: 400 });
    if (password.length < 8)    return NextResponse.json({ success: false, message: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
    if (!consentTerms || !consentPrivacy)
      return NextResponse.json({ success: false, message: "필수 약관에 동의해주세요." }, { status: 400 });

    // 직종 정규화 (중복 제거, 유효값만)
    const seen = new Set<string>();
    const professions = profsInput
      .map((p) => ({
        profession: String(p?.profession ?? ""),
        certNumber: p?.certNumber != null ? String(p.certNumber).trim() : null,
        experienceYears: Number.isFinite(Number(p?.experienceYears)) ? Math.max(0, Math.min(60, Number(p.experienceYears))) : 0,
        certifiedAt: p?.certifiedAt ? new Date(p.certifiedAt) : null,
      }))
      .filter((p) => PROFESSIONS.includes(p.profession as any) && !seen.has(p.profession) && seen.add(p.profession));

    // 직종은 선택(관심 표기용) — 미선택 허용. 자격 증빙은 최초 신청 시 받음.

    // OTP 인증 완료 여부 (5분 TTL)
    const verified = await prisma.phoneVerification.findFirst({
      where: { phoneNumber: phone, verified: true },
      orderBy: { createdAt: "desc" },
    });
    if (!verified)
      return NextResponse.json({ success: false, message: "전화번호 인증을 먼저 완료해주세요." }, { status: 400 });
    if (Date.now() - verified.createdAt.getTime() > 5 * 60 * 1000)
      return NextResponse.json({ success: false, message: "인증이 만료되었습니다. 다시 인증해주세요." }, { status: 400 });

    // 중복(이미 가입) — 통합 모델: 같은 사람이면 로그인 안내
    const existing = await prisma.worker.findUnique({ where: { loginId: phone } });
    if (existing)
      return NextResponse.json({ success: false, message: "이미 가입된 전화번호입니다. 로그인해주세요." }, { status: 409 });

    const now = new Date();
    const hashed = await hashPassword(password);

    const user = await prisma.$transaction(async (tx) => {
      const w = await tx.worker.create({
        data: {
          loginId: phone, password: hashed, workerName: name, phoneNumber: phone,
          role: "WORKER", status: "ACTIVE", planType: "FREE", isTemporary: false,
          consentTermsAt:    consentTerms    ? now : null,
          consentPrivacyAt:  consentPrivacy  ? now : null,
          consentLocationAt: consentLocation ? now : null,
        },
      });
      await tx.workerProfession.createMany({
        data: professions.map((p, i) => ({
          workerId: w.id,
          profession: p.profession as any,
          certNumber: p.certNumber,
          certifiedAt: p.certifiedAt,
          experienceYears: p.experienceYears,
          isPrimary: i === 0,
          verifyStatus: "PENDING" as const,
        })),
      });
      return w;
    });

    await prisma.phoneVerification.deleteMany({ where: { phoneNumber: phone } });

    const token = await signWorkerToken({ workerId: user.id.toString(), workerName: user.workerName, isTemporary: false });
    const res = NextResponse.json({
      success: true,
      workerId: user.id.toString(),
      professions: professions.map((p) => p.profession),
    });
    res.cookies.set(WORKER_COOKIE, token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (err) {
    console.error("[recruit/auth/signup]", err);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
