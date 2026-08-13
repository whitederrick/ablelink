// app/api/admin/pilots/[pilotId]/workers/route.ts
// 파일럿 참여 직무지도원 계정 발급.
//
// ★초기 비밀번호는 **이 응답에서 단 한 번만** 돌려준다. DB에는 bcrypt 해시만 저장하며
//  평문을 어떤 컬럼에도 남기지 않는다. 이후 조회 수단은 없고 재설정만 가능하다.
// ★이미 가입된 번호면 409다 — 기존 Worker를 재사용하거나 수정하지 않는다.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { audit } from "@/lib/audit";
import { createPilotWorker } from "@/lib/pilot/resources";
import { toPilotResponse, parsePilotId } from "@/lib/pilot/httpError";

export async function POST(req: Request, { params }: { params: Promise<{ pilotId: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { pilotId } = await params;
    const id = parsePilotId(pilotId);
    const body = await req.json().catch(() => ({}));
    const worker = await createPilotWorker(id, body);

    await audit(scope, {
      entityType: "Worker",
      entityId: worker.id.toString(),
      action: "create",
      // ★감사 요약에 비밀번호·전화번호를 넣지 않는다.
      summary: `파일럿 직무지도원 계정 발급 (pilot #${pilotId})`,
    });

    return NextResponse.json({
      success: true,
      workerId: worker.id.toString(),
      workerName: worker.workerName,
      loginId: worker.loginId,
      // ★1회성 — 운영자가 이 화면에서 참여자에게 바로 전달한다. 다시 볼 수 없다.
      initialPassword: String(body?.password ?? ""),
    }, { status: 201 });
  } catch (e) {
    return toPilotResponse(e);
  }
}
