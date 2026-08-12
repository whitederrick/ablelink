// GET /api/admin/pilots/options — 파일럿 화면 선택지 전용 경량 조회
//   ?kind=agencies            위탁기관 id·name만
//   ?kind=workers&q=검색어     직무지도원 id·성명·연락처만 (검색 필수, 상한 20)
//
// ★기존 목록 API(system/agencies·system/workers)를 드롭다운에 쓰지 않는다.
//  그쪽은 플랜·결제·직종·배정·현장·기관을 중첩해 최대 200명을 내려주는데,
//  선택지 하나 만들자고 **PII를 통째로 전송**하게 된다. 필요한 필드만 주는 경로를 따로 둔다.
//
// 워커는 검색어를 요구한다 — 전체 목록을 그냥 내려주면 같은 문제가 반복된다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

const WORKER_LIMIT = 20;

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const sp = new URL(req.url).searchParams;
    const kind = (sp.get("kind") ?? "").trim();

    if (kind === "agencies") {
      const rows = await prisma.agency.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
      return NextResponse.json({
        success: true,
        agencies: rows.map((a) => ({ id: a.id.toString(), name: a.name })),
      });
    }

    if (kind === "workers") {
      const q = (sp.get("q") ?? "").trim();
      // 검색어 없이 전체를 내려주지 않는다(PII 최소 노출).
      if (q.length < 2) {
        return NextResponse.json({ success: true, workers: [], needsQuery: true });
      }
      const rows = await prisma.worker.findMany({
        where: {
          status: "ACTIVE",
          OR: [
            { workerName: { contains: q } },
            { phoneNumber: { contains: q } },
            { loginId: { contains: q } },
          ],
        },
        orderBy: { workerName: "asc" },
        take: WORKER_LIMIT,
        select: { id: true, workerName: true, phoneNumber: true },
      });
      return NextResponse.json({
        success: true,
        workers: rows.map((w) => ({
          id: w.id.toString(),
          workerName: w.workerName,
          phoneNumber: w.phoneNumber,
        })),
      });
    }

    return NextResponse.json({ success: false, message: "kind는 agencies 또는 workers여야 합니다." }, { status: 400 });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/options]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
