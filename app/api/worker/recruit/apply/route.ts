// app/api/worker/recruit/apply/route.ts
// 워커/user 가 공고에 직무지도 신청
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { parseBigInt } from "@/lib/adminScope";

export async function POST(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const b = await req.json();
    const postId = parseBigInt(b.recruitPostId);
    if (!postId) return NextResponse.json({ success: false, message: "공고 ID가 필요합니다." }, { status: 400 });

    const post = await prisma.recruitPost.findUnique({ where: { id: postId }, select: { id: true, status: true, profession: true } });
    if (!post) return NextResponse.json({ success: false, message: "공고를 찾을 수 없습니다." }, { status: 404 });
    if (post.status !== "OPEN") return NextResponse.json({ success: false, message: "마감된 공고입니다." }, { status: 409 });

    // 자격 증빙 — 이 직종 자격이 저장돼 있으면 재사용(재요구 X), 없으면 이번 신청 시 입력 필수 → 저장
    const saved = await prisma.workerProfession.findUnique({
      where: { workerId_profession: { workerId, profession: post.profession } },
    });
    if (!saved) {
      const certNumber = b.certNumber != null ? String(b.certNumber).trim() : "";
      if (!certNumber) {
        return NextResponse.json(
          { success: false, reason: "CERT_REQUIRED", profession: post.profession, message: "이 공고 직종의 자격 증빙을 입력해주세요." },
          { status: 400 },
        );
      }
      const experienceYears = Math.max(0, Math.min(60, Number(b.experienceYears) || 0));
      const count = await prisma.workerProfession.count({ where: { workerId } });
      await prisma.workerProfession.create({
        data: { workerId, profession: post.profession, certNumber, experienceYears, isPrimary: count === 0, verifyStatus: "PENDING" },
      });
    }

    const message = b.message != null ? String(b.message).trim().slice(0, 1000) : null;

    // 이미 신청한 경우: WITHDRAWN이면 재신청(PENDING), 아니면 409
    const existing = await prisma.recruitApplication.findUnique({
      where: { recruitPostId_workerId: { recruitPostId: postId, workerId } },
    });
    if (existing) {
      if (existing.status === "WITHDRAWN") {
        await prisma.recruitApplication.update({
          where: { id: existing.id },
          data: { status: "PENDING", message, decidedAt: null },
        });
        return NextResponse.json({ success: true, reapplied: true });
      }
      return NextResponse.json({ success: false, message: "이미 신청한 공고입니다." }, { status: 409 });
    }

    await prisma.recruitApplication.create({
      data: { recruitPostId: postId, workerId, message, status: "PENDING" },
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[worker/recruit/apply POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
