// app/api/admin/recruit-posts/route.ts
// 직무지도 매칭 마켓플레이스 — 수요측(에이전시 매니저/시스템 운영자=공단·플랫폼) 공고 등록·목록
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";

const PROFESSIONS = ["JOB_COACH", "CAREGIVER", "ACTIVITY_ASSISTANT"] as const;

function serialize(p: any) {
  return {
    id: p.id.toString(),
    title: p.title,
    companyName: p.companyName,
    profession: p.profession,
    taskName: p.taskName ?? null,
    address: p.address,
    detailAddress: p.detailAddress ?? null,
    lat: p.lat != null ? Number(p.lat) : null,
    lon: p.lon != null ? Number(p.lon) : null,
    region: p.region ?? null,
    workHours: p.workHours ?? null,
    workDays: p.workDays ?? null,
    payInfo: p.payInfo ?? null,
    headcount: p.headcount,
    description: p.description ?? null,
    status: p.status,
    contactName: p.contactName ?? null,
    contactPhone: p.contactPhone ?? null,
    applicationCount: p._count?.applications ?? undefined,
    createdAt: p.createdAt.toISOString(),
  };
}

// 목록 — 본인이 등록한 공고
export async function GET(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const where =
      session.kind === "manager"
        ? { OR: [{ createdByManagerId: session.managerId }, { agencyId: session.agencyId }] }
        : { createdByAdminId: session.adminId };

    const posts = await prisma.recruitPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { applications: true } } },
    });
    return NextResponse.json({ success: true, posts: posts.map(serialize) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/recruit-posts GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// 등록
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const b = await req.json();

    const title = String(b.title ?? "").trim();
    const companyName = String(b.companyName ?? "").trim();
    const address = String(b.address ?? "").trim();
    if (!title || !companyName || !address) {
      return NextResponse.json({ success: false, message: "제목·사업체명·주소는 필수입니다." }, { status: 400 });
    }
    const profession = PROFESSIONS.includes(b.profession) ? b.profession : "JOB_COACH";
    const headcount = Math.max(1, Math.min(999, parseInt(String(b.headcount ?? "1"), 10) || 1));

    const post = await prisma.recruitPost.create({
      data: {
        title,
        companyName,
        profession,
        taskName: b.taskName?.trim() || null,
        address,
        detailAddress: b.detailAddress?.trim() || null,
        lat: b.lat != null && b.lat !== "" ? Number(b.lat) : null,
        lon: b.lon != null && b.lon !== "" ? Number(b.lon) : null,
        region: b.region?.trim() || deriveRegion(address),
        workHours: b.workHours?.trim() || null,
        workDays: b.workDays?.trim() || null,
        payInfo: b.payInfo?.trim() || null,
        headcount,
        description: b.description?.trim() || null,
        contactName: b.contactName?.trim() || null,
        contactPhone: b.contactPhone?.trim() || null,
        agencyId: session.kind === "manager" ? session.agencyId : null,
        createdByManagerId: session.kind === "manager" ? session.managerId : null,
        createdByAdminId: session.kind === "admin" ? session.adminId : null,
      },
    });
    return NextResponse.json({ success: true, id: post.id.toString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/recruit-posts POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// 주소에서 대략 지역 라벨(시/도 + 시/군/구) 추출
function deriveRegion(address: string): string | null {
  const parts = address.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return parts[0] || null;
}
