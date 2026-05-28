import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

const DEFAULT_SCORES = () => Array.from({length:5}, () => ({ initial: "", final: "" }));
function defaultAllScores() {
  return {
    WORK_ATTITUDE:    DEFAULT_SCORES(),
    INTERPERSONAL:    DEFAULT_SCORES(),
    WORK_STYLE:       DEFAULT_SCORES(),
    WORK_PERFORMANCE: DEFAULT_SCORES(),
  };
}

export async function GET(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const traineeId   = searchParams.get("traineeId");
  const evalType    = searchParams.get("evalType");
  const periodStart = searchParams.get("periodStart");
  const periodEnd   = searchParams.get("periodEnd");
  if (!traineeId || !evalType) return NextResponse.json({ success: false, message: "traineeId, evalType 필요" }, { status: 400 });
  const existing = await prisma.traineeEvaluation.findFirst({
    where: { traineeId: BigInt(traineeId), writerId: BigInt(session.userId), evalType, ...(periodStart ? { periodStart } : {}), ...(periodEnd ? { periodEnd } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ success: true, evaluation: existing
    ? { id: existing.id.toString(), scores: existing.scores, comments: existing.comments, isConfirmed: existing.isConfirmed }
    : { scores: defaultAllScores(), comments: {}, isConfirmed: false } });
}

export async function POST(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });
  const { traineeId, evalType, periodStart, periodEnd, scores, comments } = await req.json();
  if (!traineeId || !evalType || !periodStart || !periodEnd) return NextResponse.json({ success: false, message: "필수값 누락" }, { status: 400 });
  const existing = await prisma.traineeEvaluation.findFirst({
    where: { traineeId: BigInt(traineeId), writerId: BigInt(session.userId), evalType, periodStart, periodEnd },
  });
  const data = { traineeId: BigInt(traineeId), writerId: BigInt(session.userId), evalType, periodStart, periodEnd, scores: scores || defaultAllScores(), comments: comments || {}, updatedAt: new Date() };
  const result = existing
    ? await prisma.traineeEvaluation.update({ where: { id: existing.id }, data })
    : await prisma.traineeEvaluation.create({ data });
  return NextResponse.json({ success: true, id: result.id.toString() });
}
