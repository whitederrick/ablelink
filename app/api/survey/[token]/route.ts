// app/api/survey/[token]/route.ts
// 만족도 조사 응답 (사업체 담당자, 비로그인 토큰 접근)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isEvalSnapshot, validateAnswers, scoreSurvey, type EvalSnapshot } from "@/lib/jobCoachEval";

type Params = { params: Promise<{ token: string }> };

const SCORE_KEYS = ["professionalism", "diligence", "communication", "support"] as const;

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  const s = await prisma.satisfactionSurvey.findUnique({
    where: { token },
    include: { worker: { select: { workerName: true } }, agency: { select: { name: true } } },
  });
  if (!s) return NextResponse.json({ success: false, message: "유효하지 않은 링크입니다." }, { status: 404 });
  if (s.status === "RESPONDED") return NextResponse.json({ success: true, data: { status: "RESPONDED", workerName: s.worker?.workerName ?? "" } });
  if (new Date() > s.expiresAt) return NextResponse.json({ success: false, message: "만료된 링크입니다." }, { status: 410 });

  // 역량 평가표 스냅샷이 있으면 동적 문항으로 렌더(없으면 레거시 4항목)
  const snap = isEvalSnapshot((s as any).formSnapshot) ? ((s as any).formSnapshot as EvalSnapshot) : null;

  return NextResponse.json({
    success: true,
    data: {
      status: s.status,
      workerName: s.worker?.workerName ?? "",
      agencyName: s.agency?.name ?? "",
      siteName: s.siteName,
      recipientName: s.recipientName,
      form: snap ? {
        title: snap.title,
        includeOpinion: snap.includeOpinion,
        categories: snap.categories.map(c => ({ name: c.name, questions: c.questions.map(q => ({ text: q.text })) })),
      } : null,
    },
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const body = await req.json();

  const s = await prisma.satisfactionSurvey.findUnique({ where: { token } });
  if (!s) return NextResponse.json({ success: false, message: "유효하지 않은 링크입니다." }, { status: 404 });
  if (s.status === "RESPONDED") return NextResponse.json({ success: false, message: "이미 응답이 완료되었습니다." }, { status: 409 });
  if (new Date() > s.expiresAt) return NextResponse.json({ success: false, message: "만료된 링크입니다." }, { status: 410 });

  const comment = typeof body.comment === "string" ? body.comment.slice(0, 1000) : null;
  const snap = isEvalSnapshot((s as any).formSnapshot) ? ((s as any).formSnapshot as EvalSnapshot) : null;

  // 응답 완료 시 요청자(작성 의뢰 매니저, 없으면 기관 활성 매니저)에게 알림 — 응답 추적 비대칭 해소.
  async function notifyResult() {
    try {
      const w = await prisma.worker.findUnique({ where: { id: s!.workerId }, select: { workerName: true } });
      const name = w?.workerName ?? "직무지도원";
      let managerIds: bigint[] = [];
      const by = (s as any).createdByManagerId as bigint | null;
      if (by) managerIds = [by];
      else if (s!.agencyId) {
        const mgrs = await prisma.manager.findMany({ where: { agencyId: s!.agencyId, isActive: true }, select: { id: true } });
        managerIds = mgrs.map(m => m.id);
      }
      if (managerIds.length === 0) return;
      await prisma.managerNotice.createMany({
        data: managerIds.map(mid => ({
          managerId: mid,
          title: `[평가 응답] ${name} 만족도 조사 응답 완료`,
          body: `${name} 직무지도원에 대한 만족도(역량) 평가 응답이 접수되었습니다. 결과를 확인해 주세요.`,
          link: "/manager/reports",
        })),
      });
    } catch (e) { console.warn("[survey respond] 요청자 알림 실패:", e); }
  }

  if (snap) {
    // 역량 평가표 채점 — 답안 키 "{ci}_{qi}" 각 1~5
    const answers: Record<string, number> = {};
    if (body.answers && typeof body.answers === "object") {
      for (const [k, v] of Object.entries(body.answers)) answers[k] = Number(v);
    }
    if (!validateAnswers(snap, answers)) {
      return NextResponse.json({ success: false, message: "모든 항목을 평가해 주세요." }, { status: 400 });
    }
    const { categoryScores, totalScore } = scoreSurvey(snap, answers);
    await prisma.satisfactionSurvey.update({
      where: { id: s.id },
      data: { scores: answers, comment, categoryScores: categoryScores as any, totalScore, status: "RESPONDED", respondedAt: new Date() } as any,
    });
    await notifyResult();
    return NextResponse.json({ success: true, message: "응답이 제출되었습니다. 감사합니다." });
  }

  // 레거시(평가표 미연결) 4항목 + 종합 만족도
  const scores: Record<string, number> = {};
  for (const k of SCORE_KEYS) {
    const v = Number(body.scores?.[k]);
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      return NextResponse.json({ success: false, message: "모든 항목을 평가해 주세요." }, { status: 400 });
    }
    scores[k] = v;
  }
  const overall = Number(body.overallScore);
  if (!Number.isInteger(overall) || overall < 1 || overall > 5) {
    return NextResponse.json({ success: false, message: "종합 만족도를 평가해 주세요." }, { status: 400 });
  }

  await prisma.satisfactionSurvey.update({
    where: { id: s.id },
    data: { scores, overallScore: overall, comment, status: "RESPONDED", respondedAt: new Date() },
  });

  await notifyResult();
  return NextResponse.json({ success: true, message: "응답이 제출되었습니다. 감사합니다." });
}
