// POST /api/admin/pilots/[sessionId]/resources — 파일럿 사업체·훈련생 생성
//   body.kind = "site" | "trainee"
//
// ★훈련생 생성은 새 API 표면이다. 기존 admin/trainees는 매니저 전용이라 파일럿에서 쓸 수 없다.
//  스코핑(회차 기관 소속 현장에만 생성)은 lib/pilot/resources.ts가 강제한다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { createPilotSite, createPilotTrainee } from "@/lib/pilot/resources";
import { audit } from "@/lib/audit";

function parseYmd(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { sessionId: raw } = await ctx.params;
    const pilotSessionId = parseBigInt(raw);
    if (!pilotSessionId) {
      return NextResponse.json({ success: false, message: "잘못된 회차 ID입니다." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind ?? "").trim();

    if (kind === "site") {
      const companyName = String(body?.companyName ?? "").trim();
      const address = String(body?.address ?? "").trim();
      const gpsLat = Number(body?.gpsLat);
      const gpsLon = Number(body?.gpsLon);
      if (!companyName || !address) {
        return NextResponse.json({ success: false, message: "사업체명과 주소를 입력해주세요." }, { status: 400 });
      }
      if (!Number.isFinite(gpsLat) || !Number.isFinite(gpsLon)) {
        return NextResponse.json({ success: false, message: "주소 좌표가 필요합니다." }, { status: 400 });
      }

      const r = await createPilotSite({
        pilotSessionId, companyName, address,
        detailAddress: String(body?.detailAddress ?? "").trim() || null,
        gpsLat, gpsLon,
        businessContactName: String(body?.businessContactName ?? "").trim() || null,
        businessContactPhone: String(body?.businessContactPhone ?? "").replace(/-/g, "").trim() || null,
        businessContactEmail: String(body?.businessContactEmail ?? "").trim() || null,
      });
      if (!r.ok) {
        return NextResponse.json({ success: false, message: r.message, reason: r.code }, { status: r.status });
      }
      await audit(scope, {
        entityType: "Site", entityId: r.value.id, action: "create",
        after: { companyName, pilotSessionId: pilotSessionId.toString() },
      });
      return NextResponse.json({ success: true, site: { id: r.value.id.toString(), companyName: r.value.companyName } });
    }

    if (kind === "trainee") {
      const siteId = parseBigInt(body?.siteId);
      const name = String(body?.name ?? "").trim();
      const gender = String(body?.gender ?? "").trim();
      const disabilityType = String(body?.disabilityType ?? "").trim();
      const severity = String(body?.severity ?? "").trim();
      if (!siteId) {
        return NextResponse.json({ success: false, message: "사업체를 선택해주세요." }, { status: 400 });
      }
      if (!name || !gender || !disabilityType || !severity) {
        return NextResponse.json({ success: false, message: "훈련생 필수 정보를 입력해주세요." }, { status: 400 });
      }

      const r = await createPilotTrainee({
        pilotSessionId, siteId, name, gender, disabilityType, severity,
        birthDate: String(body?.birthDate ?? "").trim() || null,
        phoneNumber: String(body?.phoneNumber ?? "").replace(/-/g, "").trim() || null,
        guardianPhoneNumber: String(body?.guardianPhoneNumber ?? "").replace(/-/g, "").trim() || null,
        placementStartDate: parseYmd(body?.placementStartDate) ?? undefined,
      });
      if (!r.ok) {
        return NextResponse.json({ success: false, message: r.message, reason: r.code }, { status: r.status });
      }
      await audit(scope, {
        entityType: "Trainee", entityId: r.value.id, action: "create",
        after: { name, siteId: siteId.toString(), pilotSessionId: pilotSessionId.toString() },
      });
      return NextResponse.json({ success: true, trainee: { id: r.value.id.toString(), name: r.value.name } });
    }

    return NextResponse.json({ success: false, message: "kind는 site 또는 trainee여야 합니다." }, { status: 400 });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/[sessionId]/resources POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
