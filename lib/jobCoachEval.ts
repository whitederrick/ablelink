// lib/jobCoachEval.ts
// 직무지도원 역량 평가표(운영자 소유) — 활성 평가표 스냅샷 + 채점 공용 로직.
//  · 만족도 평가 요청 시점에 활성 평가표를 스냅샷해 SatisfactionSurvey.formSnapshot 에 저장(이후 기준 변경에도 안정).
//  · 사업체 담당자가 문항을 1~5로 답하면 (응답/5)×배점으로 환산, 카테고리·전체(0~100) 채점.
import { prisma } from "@/lib/prisma";

export type EvalSnapshotQuestion = { text: string; maxScore: number };
export type EvalSnapshotCategory = { name: string; weight: number; questions: EvalSnapshotQuestion[] };
export type EvalSnapshot = { formId: string; title: string; includeOpinion: boolean; categories: EvalSnapshotCategory[] };
export type CategoryScore = { name: string; weight: number; score: number };

// 답안 키 = "{카테고리index}_{문항index}" → 1~5
export type EvalAnswers = Record<string, number>;

const FORM_INCLUDE = { categories: { orderBy: { sortOrder: "asc" as const }, include: { questions: { orderBy: { sortOrder: "asc" as const } } } } };

function toSnapshot(f: any): EvalSnapshot | null {
  if (!f || !f.categories?.length) return null;
  return {
    formId: f.id.toString(),
    title: f.title,
    includeOpinion: f.includeOpinion,
    categories: f.categories.map((c: any) => ({
      name: c.name,
      weight: c.questions.reduce((s: number, q: any) => s + q.maxScore, 0),
      questions: c.questions.map((q: any) => ({ text: q.text, maxScore: q.maxScore })),
    })),
  };
}

export async function getActiveFormSnapshot(): Promise<EvalSnapshot | null> {
  const f = await prisma.jobCoachEvalForm.findFirst({ where: { isActive: true }, include: FORM_INCLUDE });
  return toSnapshot(f);
}

// 특정 평가표로 스냅샷(없거나 빈 폼이면 활성 평가표 폴백)
export async function getFormSnapshotById(formId: bigint | null | undefined): Promise<EvalSnapshot | null> {
  if (formId == null) return getActiveFormSnapshot();
  const f = await prisma.jobCoachEvalForm.findUnique({ where: { id: formId }, include: FORM_INCLUDE });
  return toSnapshot(f) ?? getActiveFormSnapshot();
}

// 평가표 선택 목록(활성 우선). 매니저·운영자 발송 모달의 평가표 선택용.
export async function listEvalForms(): Promise<{ id: string; title: string; isActive: boolean; questionCount: number }[]> {
  const forms = await prisma.jobCoachEvalForm.findMany({
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    include: { categories: { include: { questions: { select: { id: true } } } } },
  });
  return forms
    .filter(f => f.categories.some(c => c.questions.length > 0))
    .map(f => ({ id: f.id.toString(), title: f.title, isActive: f.isActive, questionCount: f.categories.reduce((s, c) => s + c.questions.length, 0) }));
}

// 스냅샷 타입 가드(런타임 JSON 검증용 — 최소한)
export function isEvalSnapshot(v: any): v is EvalSnapshot {
  return !!v && Array.isArray(v.categories) && v.categories.every((c: any) => Array.isArray(c?.questions));
}

// 모든 문항이 1~5로 답해졌는지 검증
export function validateAnswers(snap: EvalSnapshot, answers: EvalAnswers): boolean {
  for (let ci = 0; ci < snap.categories.length; ci++) {
    const c = snap.categories[ci];
    for (let qi = 0; qi < c.questions.length; qi++) {
      const v = Number(answers[`${ci}_${qi}`]);
      if (!Number.isInteger(v) || v < 1 || v > 5) return false;
    }
  }
  return true;
}

// 카테고리별·전체(0~100) 환산 점수
export function scoreSurvey(snap: EvalSnapshot, answers: EvalAnswers): { categoryScores: CategoryScore[]; totalScore: number } {
  const categoryScores = snap.categories.map((c, ci) => {
    let earned = 0;
    c.questions.forEach((q, qi) => {
      const a = Number(answers[`${ci}_${qi}`]);
      const v = Number.isFinite(a) ? Math.min(5, Math.max(0, a)) : 0;
      earned += (v / 5) * q.maxScore;
    });
    return { name: c.name, weight: c.weight, score: Math.round(earned * 10) / 10 };
  });
  const totalScore = Math.round(categoryScores.reduce((s, c) => s + c.score, 0));
  return { categoryScores, totalScore };
}
