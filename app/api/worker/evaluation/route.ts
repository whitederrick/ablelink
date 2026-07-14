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
  if (!/^\d+$/.test(String(traineeId))) return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 }); // 미검증 BigInt() → 500 방지
  const existing = await prisma.traineeEvaluation.findFirst({
    where: { traineeId: BigInt(traineeId), writerId: BigInt(session.workerId), evalType, ...(periodStart ? { periodStart } : {}), ...(periodEnd ? { periodEnd } : {}) },
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
  if (!/^\d+$/.test(String(traineeId))) return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
  // ★입력 검증: evalType enum·기간 형식·JSON 크기 상한(임의 문자열/거대 payload 저장 방지, placement 쿼리 Invalid Date 방지)
  if (!["TRAINING", "ADAPTATION"].includes(String(evalType))) return NextResponse.json({ success: false, message: "잘못된 평가 유형입니다." }, { status: 400 });
  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  if (!YMD.test(String(periodStart)) || !YMD.test(String(periodEnd))) return NextResponse.json({ success: false, message: "기간 형식이 올바르지 않습니다." }, { status: 400 });
  if (JSON.stringify(scores ?? {}).length > 20000 || JSON.stringify(comments ?? {}).length > 20000) return NextResponse.json({ success: false, message: "평가 내용이 너무 큽니다." }, { status: 400 });

  // P3(IDOR): traineeId가 이 워커의 배정 현장에 해당 기간 재적한 훈련생인지 검증한다.
  //  (기존엔 traineeId+writerId만 봐서 타 현장 훈련생 ID 주입 시 평가가 섞일 여지가 있었다.)
  const engagements = await prisma.siteAssignment.findMany({
    where: { workerId: BigInt(session.workerId), status: { in: ["ACCEPTED", "ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"] } },
    select: { siteId: true },
  });
  const siteIds = [...new Set(engagements.map((a) => a.siteId))];
  const enrolled = siteIds.length > 0 && await prisma.traineePlacement.findFirst({
    where: {
      traineeId: BigInt(traineeId),
      siteId: { in: siteIds },
      startDate: { lte: new Date(periodEnd + "T23:59:59+09:00") },
      OR: [{ endDate: null }, { endDate: { gte: new Date(periodStart + "T00:00:00+09:00") } }],
    },
    select: { id: true },
  });
  if (!enrolled) return NextResponse.json({ success: false, message: "평가 대상 훈련생을 찾을 수 없습니다." }, { status: 403 });

  const existing = await prisma.traineeEvaluation.findFirst({
    where: { traineeId: BigInt(traineeId), writerId: BigInt(session.workerId), evalType, periodStart, periodEnd },
  });
  const data = { traineeId: BigInt(traineeId), writerId: BigInt(session.workerId), evalType, periodStart, periodEnd, scores: scores || defaultAllScores(), comments: comments || {}, updatedAt: new Date() };
  const result = existing
    ? await prisma.traineeEvaluation.update({ where: { id: existing.id }, data })
    : await prisma.traineeEvaluation.create({ data });
  return NextResponse.json({ success: true, id: result.id.toString() });
}
