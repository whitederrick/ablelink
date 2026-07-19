// 위탁기관 관리자: 훈련생 목록 조회 + 신규 등록
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { audit } from "@/lib/audit";
import { logAccess } from "@/lib/accessLog";
import { MAX_TRAINEES_PER_WORKER } from "@/lib/rules";
import { openTraineePlacement } from "@/lib/traineePlacement";

export async function GET(req: NextRequest) {
  try {
    const scope    = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");

    if (siteId && !/^\d+$/.test(siteId)) return NextResponse.json({ success: false, message: "잘못된 현장 ID입니다." }, { status: 400 });
    const sites = await prisma.site.findMany({
      where: { agencyId, ...(siteId ? { id: BigInt(siteId) } : {}) },
      include: {
        trainees: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    // 접속기록(제8조): 훈련생 목록은 생년월일·보호자연락처·장애유형/정도(민감정보)를 노출 → 열람 1건 집계 기록.
    const traineeCount = sites.reduce((n, s) => n + s.trainees.length, 0);
    if (traineeCount > 0) {
      await logAccess(req, scope, {
        subjectType: "Trainee", subjectId: null, subjectLabel: `훈련생 목록 ${traineeCount}명`,
        resource: "disability", action: "view",
      });
    }

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
          phoneNumber:          t.phoneNumber ?? null,
          guardianPhoneNumber:  t.guardianPhoneNumber ?? null,
          guardianPhoneNumber2: t.guardianPhoneNumber2 ?? null,
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
    const scope    = await requireManagerSession(req);
    const agencyId = scope.agencyId;

    const body = await req.json().catch(() => ({}));
    const { siteId, name, gender, birthDate, phoneNumber, guardianPhoneNumber, guardianPhoneNumber2,
            disabilityType, severity, note } = body;

    if (!siteId || !/^\d+$/.test(String(siteId)) || !name?.trim() || !gender || !disabilityType || !severity)
      return NextResponse.json({ success: false, message: "필수 항목이 누락되었습니다." }, { status: 400 });

    const site = await prisma.site.findUnique({ where: { id: BigInt(siteId) } });
    if (!site || site.agencyId !== agencyId)
      return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });

    // 직무지도원 1명당(=현장당) 활성 훈련생 한도 (lib/rules.ts, 현재 5명·향후 조정 가능)
    const activeTrainees = await prisma.trainee.count({
      where: { currentSiteId: BigInt(siteId), status: "TRAINING" },
    });
    if (activeTrainees >= MAX_TRAINEES_PER_WORKER) {
      return NextResponse.json(
        { success: false, message: `직무지도원 1명당 훈련생은 최대 ${MAX_TRAINEES_PER_WORKER}명까지 배정할 수 있습니다.` },
        { status: 400 }
      );
    }

    // 훈련생 생성 + 현장배치 이력(ACTIVE) 동시 생성(급여 1:多·출근부 표기·목록·캘린더 근거)
    const trainee = await prisma.$transaction(async (tx) => {
      const t = await tx.trainee.create({
        data: {
          currentSiteId:       BigInt(siteId),
          name:                name.trim(),
          gender,
          birthDate:           birthDate || null,
          phoneNumber:          phoneNumber || null,
          guardianPhoneNumber:  guardianPhoneNumber || null,
          guardianPhoneNumber2: guardianPhoneNumber2 || null,
          disabilityType,
          severity,
          note:                note?.trim() || null,
          status:              "TRAINING",
        },
      });
      await openTraineePlacement(tx, t.id, BigInt(siteId), new Date());
      return t;
    });

    await audit(scope, { entityType: "Trainee", entityId: trainee.id, action: "create", after: { name: trainee.name, siteId: String(siteId), gender: trainee.gender, disabilityType: trainee.disabilityType, severity: trainee.severity, status: trainee.status } });
    return NextResponse.json({ success: true, id: trainee.id.toString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
