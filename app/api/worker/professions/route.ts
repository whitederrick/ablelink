// app/api/worker/professions/route.ts
// 직무지도원/인력의 보유 직종 자격 관리 (정보 수정에서 조회·추가증명·수정·삭제)
// - 추가/수정 시 verifyStatus=PENDING 으로 운영자 재검증 대기
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

const PROFESSIONS = ["JOB_COACH", "CAREGIVER", "ACTIVITY_ASSISTANT"] as const;

function serialize(p: any) {
  return {
    id: p.id.toString(),
    profession: p.profession,
    certNumber: p.certNumber ?? null,
    certifiedAt: p.certifiedAt ? p.certifiedAt.toISOString().slice(0, 10) : null,
    experienceYears: p.experienceYears,
    isPrimary: p.isPrimary,
    verifyStatus: p.verifyStatus,
    verifiedAt: p.verifiedAt?.toISOString() ?? null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);
    const rows = await prisma.workerProfession.findMany({ where: { workerId }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
    return NextResponse.json({ success: true, professions: rows.map(serialize) });
  } catch (e: any) {
    console.error("[worker/professions GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// 추가 직종 증명 등록 (이미 REJECTED면 재제출, PENDING/VERIFIED면 409)
export async function POST(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const b = await req.json();
    const profession = String(b.profession ?? "");
    if (!PROFESSIONS.includes(profession as any)) return NextResponse.json({ success: false, message: "직종을 선택해주세요." }, { status: 400 });
    const certNumber = b.certNumber != null ? String(b.certNumber).trim() || null : null;
    const experienceYears = Math.max(0, Math.min(60, Number(b.experienceYears) || 0));
    const certifiedAt = b.certifiedAt ? new Date(b.certifiedAt) : null;

    const existing = await prisma.workerProfession.findUnique({ where: { workerId_profession: { workerId, profession: profession as any } } });
    if (existing) {
      if (existing.verifyStatus !== "REJECTED") {
        return NextResponse.json({ success: false, message: "이미 등록된 직종입니다." }, { status: 409 });
      }
      // 반려된 자격 재제출 → PENDING 재검증
      await prisma.workerProfession.update({
        where: { id: existing.id },
        data: { certNumber, experienceYears, certifiedAt, verifyStatus: "PENDING", verifiedAt: null, verifiedByAdminId: null },
      });
      return NextResponse.json({ success: true, resubmitted: true });
    }

    const count = await prisma.workerProfession.count({ where: { workerId } });
    await prisma.workerProfession.create({
      data: { workerId, profession: profession as any, certNumber, experienceYears, certifiedAt, isPrimary: count === 0, verifyStatus: "PENDING" },
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[worker/professions POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// 자격 정보 수정 (자격번호/경력 변경 → 재검증 PENDING)
export async function PATCH(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const b = await req.json();
    const profession = String(b.profession ?? "");
    const existing = await prisma.workerProfession.findUnique({ where: { workerId_profession: { workerId, profession: profession as any } } });
    if (!existing) return NextResponse.json({ success: false, message: "등록되지 않은 직종입니다." }, { status: 404 });

    await prisma.workerProfession.update({
      where: { id: existing.id },
      data: {
        certNumber: b.certNumber != null ? String(b.certNumber).trim() || null : existing.certNumber,
        experienceYears: b.experienceYears != null ? Math.max(0, Math.min(60, Number(b.experienceYears) || 0)) : existing.experienceYears,
        certifiedAt: b.certifiedAt ? new Date(b.certifiedAt) : existing.certifiedAt,
        verifyStatus: "PENDING", verifiedAt: null, verifiedByAdminId: null, // 변경 시 재검증
      },
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[worker/professions PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const { searchParams } = new URL(req.url);
    const profession = String(searchParams.get("profession") ?? "");
    const existing = await prisma.workerProfession.findUnique({ where: { workerId_profession: { workerId, profession: profession as any } } });
    if (!existing) return NextResponse.json({ success: false, message: "등록되지 않은 직종입니다." }, { status: 404 });

    await prisma.workerProfession.delete({ where: { id: existing.id } });
    // 대표직종을 지웠으면 남은 것 중 하나를 대표로 승격
    if (existing.isPrimary) {
      const next = await prisma.workerProfession.findFirst({ where: { workerId }, orderBy: { createdAt: "asc" } });
      if (next) await prisma.workerProfession.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[worker/professions DELETE]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
