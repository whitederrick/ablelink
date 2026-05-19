// app/api/admin/auth/login/route.ts
// 관리자 로그인 API 핸들러입니다.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { attachAdminSessionCookieToResponse } from "@/lib/adminCookies";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const loginId = String(body?.loginId || "").trim();
    const password = String(body?.password || "");

    if (!loginId || !password) {
      return NextResponse.json(
        { success: false, message: "loginId/password가 필요합니다." },
        { status: 400 }
      );
    }

    const admin = await prisma.adminUser.findUnique({ where: { loginId } });
    if (!admin || !admin.isActive) {
      return NextResponse.json(
        { success: false, message: "계정이 없거나 비활성화 상태입니다." },
        { status: 401 }
      );
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      return NextResponse.json(
        { success: false, message: "비밀번호가 올바르지 않습니다." },
        { status: 401 }
      );
    }

    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    // ✅ 응답에 세션 쿠키를 부착 (NextResponse.cookies 사용)
    // - AGENCY role인 경우, agencyName으로 Agency.id를 조회해 agencyId를 토큰에 같이 실어줍니다.
    const res = NextResponse.json({ success: true });

    let agencyId: string | null = null;
    if (admin.role === "AGENCY") {
      const agencyName = String(admin.agencyName || "").trim();
      if (agencyName) {
        const agency = await prisma.agency.findUnique({
          where: { name: agencyName },
          select: { id: true },
        });
        agencyId = agency ? agency.id.toString() : null;
      }
    }

    await attachAdminSessionCookieToResponse(res, {
      sub: admin.id.toString(),
      role: admin.role,
      loginId: admin.loginId,
      agencyId, // ✅ 추가
      agencyName: admin.agencyName,
    } as any);

    return res;
  } catch (e: any) {
    console.error("[ADMIN_LOGIN_ERROR]", e);
    return NextResponse.json(
      { success: false, message: e?.message || "서버 에러" },
      { status: 500 }
    );
  }
}
