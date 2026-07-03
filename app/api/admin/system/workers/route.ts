// 시스템 운영자 전용: 전체 직무지도원 조회 / 생성(promo 온보딩)
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { hashPassword } from "@/lib/password";
import { audit } from "@/lib/audit";

const PHONE_RE = /^01[0-9]{8,9}$/;

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() ?? "";
    const profession = searchParams.get("profession")?.trim() ?? "";
    const profValid = ["JOB_COACH", "CAREGIVER", "ACTIVITY_ASSISTANT"].includes(profession);

    const and: any[] = [];
    if (q) and.push({ OR: [
      { workerName: { contains: q } },
      { phoneNumber: { contains: q } },
      { loginId: { contains: q } },
    ] });
    // 직종(카테고리) 필터 — 해당 직종 자격을 보유한 인력만(배정 대상 후보)
    if (profValid) and.push({ professions: { some: { profession } } });

    const where = and.length ? { AND: and } : undefined;
    // 목록은 take 200 제한이지만, 상단 통계 카드/필터칩은 전체 기준이어야 함 → groupBy로 정확한 카운트 별도 산출.
    const [users, statusGroups] = await Promise.all([
      prisma.worker.findMany({
        where,
        include: {
          professions: { select: { profession: true, verifyStatus: true } },
          assignments: {
            where: { status: { in: ["ACTIVE", "ASSIGNED", "CONFIRMED"] } },
            include: {
              site: { select: { companyName: true, agency: { select: { id: true, name: true } } } },
            },
            take: 1,
            orderBy: { startDate: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.worker.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ]);
    const counts = {
      total: statusGroups.reduce((s, g) => s + g._count._all, 0),
      byStatus: Object.fromEntries(statusGroups.map(g => [g.status, g._count._all])) as Record<string, number>,
    };

    return NextResponse.json({
      success: true,
      counts,
      workers: users.map(u => {
        const asgn = u.assignments[0];
        return {
          id:          u.id.toString(),
          loginId:     u.loginId,
          workerName:    u.workerName,
          phoneNumber: u.phoneNumber,
          status:      u.status,
          planType:    u.planType,
          professions: u.professions.map(p => ({ profession: p.profession, verifyStatus: p.verifyStatus })),
          siteName:    asgn?.site?.companyName ?? null,
          agencyId:    asgn?.site?.agency?.id?.toString() ?? null,
          agencyName:  asgn?.site?.agency?.name ?? null,
          createdAt:   u.createdAt.toISOString(),
        };
      }),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// POST: 운영자가 직무지도원 계정 직접 생성 (자가가입 종료의 짝 — promo 온보딩).
// body: { workerName, phoneNumber, password(임시), planType? }
export async function POST(req: Request) {
  try {
    const scope = await requireAdminSession(req);

    const body = await req.json();
    const workerName  = String(body?.workerName ?? "").trim();
    const phoneNumber = String(body?.phoneNumber ?? "").replace(/-/g, "").trim();
    const password    = String(body?.password ?? "");
    const planType    = String(body?.planType ?? "FREE");

    if (workerName.length < 2) return NextResponse.json({ success: false, message: "이름은 2자 이상이어야 합니다." }, { status: 400 });
    if (!PHONE_RE.test(phoneNumber)) return NextResponse.json({ success: false, message: "올바른 휴대전화번호를 입력해주세요." }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ success: false, message: "임시 비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
    if (!["FREE", "STARTER", "STANDARD", "PRO", "PREMIUM"].includes(planType)) {
      return NextResponse.json({ success: false, message: "유효하지 않은 등급입니다." }, { status: 400 });
    }

    const existing = await prisma.worker.findUnique({ where: { loginId: phoneNumber } });
    if (existing) return NextResponse.json({ success: false, message: "이미 가입된 전화번호입니다." }, { status: 409 });

    const worker = await prisma.worker.create({
      data: {
        loginId:     phoneNumber,
        password:    await hashPassword(password),
        workerName,
        phoneNumber,
        role:        "WORKER",
        status:      "ACTIVE",
        planType:    planType as any,
        isTemporary: false,
      },
      select: { id: true, loginId: true, workerName: true },
    });


    await audit(scope, { entityType: "Worker", entityId: worker.id, action: "create", after: { workerName, phoneNumber, planType, status: "ACTIVE" } });

    return NextResponse.json({ success: true, message: "직무지도원 계정이 생성되었습니다.", worker: {
      id: worker.id.toString(), loginId: worker.loginId, workerName: worker.workerName,
    } });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
