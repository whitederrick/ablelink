// 직무지도원 평가 질문지 — 상세 조회 / 저장(구조 교체·활성화) / 삭제 (시스템 운영자 전용)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession(req);
    const { id } = await params;
    const formId = parseBigInt(id);
    if (!formId) return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });

    const form = await prisma.jobCoachEvalForm.findUnique({
      where: { id: formId },
      include: {
        categories: {
          orderBy: { sortOrder: "asc" },
          include: { questions: { orderBy: { sortOrder: "asc" } } },
        },
      },
    });
    if (!form) return NextResponse.json({ success: false, message: "질문지를 찾을 수 없습니다." }, { status: 404 });

    return NextResponse.json({
      success: true,
      form: {
        id: form.id.toString(),
        title: form.title,
        description: form.description ?? "",
        isActive: form.isActive,
        includeOpinion: form.includeOpinion,
        categories: form.categories.map(c => ({
          name: c.name,
          questions: c.questions.map(q => ({ text: q.text, maxScore: q.maxScore })),
        })),
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession(req);
    const { id } = await params;
    const formId = parseBigInt(id);
    if (!formId) return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });

    const exists = await prisma.jobCoachEvalForm.findUnique({ where: { id: formId }, select: { id: true } });
    if (!exists) return NextResponse.json({ success: false, message: "질문지를 찾을 수 없습니다." }, { status: 404 });

    const body = await req.json();

    // 활성/비활성 토글만 (구조 미포함)
    if (body?.action === "set-active") {
      const active = !!body.isActive;
      await prisma.$transaction(async tx => {
        if (active) await tx.jobCoachEvalForm.updateMany({ where: { id: { not: formId } }, data: { isActive: false } });
        await tx.jobCoachEvalForm.update({ where: { id: formId }, data: { isActive: active } });
      });
      return NextResponse.json({ success: true, message: active ? "활성 질문지로 설정했습니다." : "비활성화했습니다." });
    }

    // 전체 저장(메타 + 카테고리·문항 교체)
    const title = String(body?.title ?? "").trim();
    if (!title) return NextResponse.json({ success: false, message: "질문지 제목을 입력해주세요." }, { status: 400 });
    const categories: { name: string; questions: { text: string; maxScore: number }[] }[] = Array.isArray(body?.categories) ? body.categories : [];

    // 검증: 빈 카테고리명·문항·음수 배점 정리
    const clean = categories
      .map(c => ({
        name: String(c?.name ?? "").trim(),
        questions: (Array.isArray(c?.questions) ? c.questions : [])
          .map(q => ({ text: String(q?.text ?? "").trim(), maxScore: Math.max(0, Math.round(Number(q?.maxScore) || 0)) }))
          .filter(q => q.text),
      }))
      .filter(c => c.name);

    await prisma.$transaction(async tx => {
      await tx.jobCoachEvalForm.update({
        where: { id: formId },
        data: { title, description: body?.description?.trim() || null, includeOpinion: body?.includeOpinion !== false },
      });
      // 교체: 기존 카테고리(문항 cascade) 삭제 후 재생성
      await tx.jobCoachEvalCategory.deleteMany({ where: { formId } });
      for (let ci = 0; ci < clean.length; ci++) {
        const c = clean[ci];
        const cat = await tx.jobCoachEvalCategory.create({ data: { formId, name: c.name, sortOrder: ci } });
        if (c.questions.length > 0) {
          await tx.jobCoachEvalQuestion.createMany({
            data: c.questions.map((q, qi) => ({ categoryId: cat.id, text: q.text, maxScore: q.maxScore, sortOrder: qi })),
          });
        }
      }
    });

    const total = clean.flatMap(c => c.questions).reduce((s, q) => s + q.maxScore, 0);
    return NextResponse.json({ success: true, message: "저장되었습니다.", totalScore: total });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession(req);
    const { id } = await params;
    const formId = parseBigInt(id);
    if (!formId) return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });
    await prisma.jobCoachEvalForm.delete({ where: { id: formId } });
    return NextResponse.json({ success: true, message: "삭제되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
