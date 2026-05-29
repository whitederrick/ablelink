// 에이전시 관리자: 훈련생 목록 조회 + 신규 등록
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  try {
    const scope    = await requireAdminSession(req);
    const agencyId = requireAgencyScope(scope);
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");

    const sites = await prisma.site.findMany({
      where: { agencyId, ...(siteId ? { id: BigInt(siteId) } : {}) },
      include: {
        trainees: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return NextResponse.json({
      success: true,
      trainees: sites.flatMap(s =>
        s.trainees.map(t => ({
          id:                  t.id.toString(),
          siteId:              s.id.toString(),
          siteName:            s.companyName,
          name:                t.name,
          gender:              t.gender,
          birthDate:           t.birthDate ?? null,
          phoneNumber:         t.phoneNumber ?? null,
          guardianPhoneNumber: t.guardianPhoneNumber ?? null,
          disabilityType:      t.disabilityType,
          severity:            t.severity,
          status:              t.status,
          note:                t.note ?? null,
          createdAt:           t.createdAt.toISOString(),
        }))
      ),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope    = await requireAdminSession(req);
    const agencyId = requireAgencyScope(scope);

    const body = await req.json();
    const { siteId, name, gender, birthDate, phoneNumber, guardianPhoneNumber,
            disabilityType, severity, note } = body;

    if (!siteId || !name?.trim() || !gender || !disabilityType || !severity)
      return NextResponse.json({ success: false, message: "필수 항목이 누락되었습니다." }, { status: 400 });

    const site = await prisma.site.findUnique({ where: { id: BigInt(siteId) } });
    if (!site || site.agencyId !== agencyId)
      return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });

    const trainee = await prisma.trainee.create({
      data: {
        currentSiteId:       BigInt(siteId),
        name:                name.trim(),
        gender,
        birthDate:           birthDate || null,
        phoneNumber:         phoneNumber || null,
        guardianPhoneNumber: guardianPhoneNumber || null,
        disabilityType,
        severity,
        note:                note?.trim() || null,
        status:              "TRAINING",
      },
    });

    return NextResponse.json({ success: true, id: trainee.id.toString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
