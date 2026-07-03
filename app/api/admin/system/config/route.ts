// app/api/admin/system/config/route.ts
// 시스템 운영자 전용: 시스템 파라미터(SystemConfig) 조회/수정. CONFIG_REGISTRY 정의 키만 허용.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { audit } from "@/lib/audit";
import { CONFIG_REGISTRY, listConfigs, invalidateConfigCache } from "@/lib/systemConfig";

const SPEC = Object.fromEntries(CONFIG_REGISTRY.map(s => [s.key, s]));

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const items = await listConfigs();
    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    const body = await req.json().catch(() => ({}));
    const { key, value } = body;

    const spec = SPEC[key];
    if (!spec) return NextResponse.json({ success: false, message: "알 수 없는 설정 키입니다." }, { status: 400 });

    let v = String(value ?? "").trim();
    if (spec.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) return NextResponse.json({ success: false, message: "숫자를 입력하세요." }, { status: 400 });
      if (spec.min != null && n < spec.min) return NextResponse.json({ success: false, message: `${spec.min} 이상이어야 합니다.` }, { status: 400 });
      if (spec.max != null && n > spec.max) return NextResponse.json({ success: false, message: `${spec.max} 이하여야 합니다.` }, { status: 400 });
      v = String(Math.round(n));
    }

    await prisma.systemConfig.upsert({
      where: { key },
      update: { value: v },
      create: { key, value: v },
    });
    invalidateConfigCache();

    await audit(scope, { entityType: "SystemConfig", entityId: key, action: "update", summary: `${key} 변경`, after: { key, value: v } });

    return NextResponse.json({ success: true, message: "저장되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[system/config PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
