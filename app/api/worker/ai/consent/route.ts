// app/api/worker/ai/consent/route.ts
// AI 음성 국외이전 동의 상태 조회/기록.
//  · GET  → { consented: boolean, consentedAt: string|null }
//  · POST → 동의 시각 기록(멱등: 이미 동의면 기존 시각 유지)
// 국외이전 대상: Groq(미국·STT), Google Gemini(미국·문장 변환). 상세는 /privacy 국외이전 조항.
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const worker = await prisma.worker.findUnique({
      where: { id: BigInt(session.workerId) },
      select: { consentAiCrossBorderAt: true },
    });
    return NextResponse.json({
      success: true,
      consented: !!worker?.consentAiCrossBorderAt,
      consentedAt: worker?.consentAiCrossBorderAt?.toISOString() ?? null,
    });
  } catch (e: any) {
    console.error("[ai/consent GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const existing = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { consentAiCrossBorderAt: true },
    });
    // 이미 동의했으면 기존 시각 유지(멱등)
    if (existing?.consentAiCrossBorderAt) {
      return NextResponse.json({ success: true, consentedAt: existing.consentAiCrossBorderAt.toISOString() });
    }

    const now = new Date();
    await prisma.worker.update({ where: { id: workerId }, data: { consentAiCrossBorderAt: now } });
    try {
      await audit(
        { workerId: Number(workerId), loginId: (session as any).loginId ?? (session as any).workerName ?? null },
        { entityType: "Worker", entityId: workerId, action: "update", summary: "AI 음성 국외이전 동의", after: { consentAiCrossBorderAt: now.toISOString() } },
      );
    } catch { /* 감사 실패 무시 */ }

    return NextResponse.json({ success: true, consentedAt: now.toISOString() });
  } catch (e: any) {
    console.error("[ai/consent POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
