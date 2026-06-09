// app/api/survey/[token]/route.ts
// 만족도 조사 응답 (사업체 담당자, 비로그인 토큰 접근)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  return NextResponse.json({
    success: true,
    data: {
      status: s.status,
      workerName: s.worker?.workerName ?? "",
      agencyName: s.agency?.name ?? "",
      siteName: s.siteName,
      recipientName: s.recipientName,
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

  // 점수 검증 (각 1~5)
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
  const comment = typeof body.comment === "string" ? body.comment.slice(0, 1000) : null;

  await prisma.satisfactionSurvey.update({
    where: { id: s.id },
    data: { scores, overallScore: overall, comment, status: "RESPONDED", respondedAt: new Date() },
  });

  return NextResponse.json({ success: true, message: "응답이 제출되었습니다. 감사합니다." });
}
