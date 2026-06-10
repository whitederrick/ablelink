// 직무지도원 평가 질문지 — 목록 조회 + 신규 생성 (시스템 운영자 전용)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const forms = await prisma.jobCoachEvalForm.findMany({
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      include: { categories: { include: { questions: { select: { maxScore: true } } } } },
    });
    return NextResponse.json({
      success: true,
      forms: forms.map(f => {
        const questions = f.categories.flatMap(c => c.questions);
        return {
          id: f.id.toString(),
          title: f.title,
          description: f.description ?? "",
          isActive: f.isActive,
          includeOpinion: f.includeOpinion,
          categoryCount: f.categories.length,
          questionCount: questions.length,
          totalScore: questions.reduce((s, q) => s + q.maxScore, 0),
          updatedAt: f.updatedAt.toISOString(),
        };
      }),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const body = await req.json();
    const title = String(body?.title ?? "").trim();
    if (!title) return NextResponse.json({ success: false, message: "질문지 제목을 입력해주세요." }, { status: 400 });

    const form = await prisma.jobCoachEvalForm.create({
      data: { title, description: body?.description?.trim() || null },
    });
    return NextResponse.json({ success: true, id: form.id.toString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
