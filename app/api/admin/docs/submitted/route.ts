// app/api/admin/docs/submitted/route.ts
// 문서 조회(/manager/docs)에서 '공단 제출(SUBMITTED)' 완료 문서를 제외하기 위한 조회.
// 선택 기간과 겹치는 SUBMITTED DocumentRun들의 키(workerId:docType:traineeId)를 반환한다.
// 제출본은 '공단 제출 내역'에서 확인하므로 문서 조회 미리보기에서는 가린다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const { searchParams } = new URL(req.url);
    const periodStart = searchParams.get("periodStart");
    const periodEnd = searchParams.get("periodEnd");
    if (!periodStart || !periodEnd) {
      return NextResponse.json({ success: false, message: "기간이 필요합니다." }, { status: 400 });
    }

    // 기간 겹침: run.periodStart <= 선택끝 && run.periodEnd >= 선택시작
    // ★P2: DocumentRun.periodStart/End는 KST(+09:00)로 저장(worker/docs/submit)되므로 경계도 KST로 비교해야 한다.
    //  UTC 경계면 9h 스큐로 '다음 기간' run까지 겹침에 걸려, 미제출 출근부가 '제출됨'으로 가려지고 공단 제출이 누락된다.
    const startBound = new Date(`${periodStart}T00:00:00.000+09:00`);
    const endBound = new Date(`${periodEnd}T23:59:59.999+09:00`);

    const runs = await prisma.documentRun.findMany({
      where: {
        ...(scope.agencyId ? { agencyId: scope.agencyId } : {}),
        govStatus: "SUBMITTED",
        periodStart: { lte: endBound },
        periodEnd: { gte: startBound },
      },
      select: { workerId: true, docType: true, traineeId: true, siteId: true },
    });

    // ★siteId 포함 — 멀티현장 워커는 현장별 행이므로, A현장 제출이 B현장 행까지 '제출됨'으로 가리면 안 된다.
    //  (소비처는 /manager/docs 단일 — 클라 submittedKey와 형식 동기.)
    const keys = runs.map(
      (r) => `${r.workerId.toString()}:${r.docType}:${r.traineeId != null ? r.traineeId.toString() : ""}:${r.siteId.toString()}`,
    );

    return NextResponse.json({ success: true, keys: Array.from(new Set(keys)) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/docs/submitted]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
