// app/api/admin/worker-accounts/[id]/passbook/route.ts
// 매니저가 소속 직무지도원의 통장사본을 대신 등록(POST, multipart).
// 워커가 직접 못 올리는 경우(고령·장애 등) 인적 관리 상세 모달에서 사용.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { uploadPassbook, resolvePassbookUrl } from "@/lib/passbookStorage";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    const { id } = await params;
    let workerId: bigint;
    try { workerId = BigInt(id); } catch { return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 }); }

    // 자기 위탁기관 소속(배정 이력) 직무지도원만
    const owned = await prisma.worker.findFirst({
      where: { id: workerId, assignments: { some: { site: { agencyId } } } },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ success: false, message: "file 필드가 필요합니다." }, { status: 400 });
    }

    const result = await uploadPassbook(String(workerId), file);
    if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: result.status });

    await prisma.worker.update({ where: { id: workerId }, data: { passbookImageUrl: result.path } });
    const url = await resolvePassbookUrl(result.path);
    return NextResponse.json({ success: true, url, message: "통장사본이 저장되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/worker-accounts/[id]/passbook]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
