// app/api/app/assignments/[id]/reject/route.ts
// 직무지도원 배정 거절: ASSIGNED -> REJECTED
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function errToStatus(msg: string) {
  if (msg.startsWith("VALIDATION:")) return 400;
  if (msg === "NOT_FOUND") return 404;
  if (msg === "FORBIDDEN") return 403;
  return 500;
}

function isValidNumericId(s: string) {
  return /^[0-9]+$/.test(s);
}

async function getAssignmentId(params: Promise<{ id: string }>) {
  const p = await params;
  const idStr = String(p?.id ?? "").trim();
  if (!isValidNumericId(idStr)) throw new Error("VALIDATION:id");
  return BigInt(idStr);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const assignmentId = await getAssignmentId(params);
    const body = await req.json();

    const userIdStr = String(body.userId ?? "").trim();
    if (!isValidNumericId(userIdStr)) throw new Error("VALIDATION:userId");
    const userId = BigInt(userIdStr);

    const reason = body.reason != null ? String(body.reason).trim() : null;

    // ✅ 핵심: userId까지 where에 포함
    const a = await prisma.siteAssignment.findFirst({
      where: { id: assignmentId, userId },
      select: { id: true, status: true },
    });

    if (!a) throw new Error("NOT_FOUND");
    if (a.status !== "ASSIGNED") throw new Error("VALIDATION:status");

    const updated = await prisma.siteAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "REJECTED",
        rejectedAt: new Date(),
        statusReason: reason,
      },
      select: { id: true, status: true, rejectedAt: true },
    });

    return NextResponse.json({
      success: true,
      item: {
        id: String(updated.id),
        status: updated.status,
        rejectedAt: updated.rejectedAt,
      },
    });
  } catch (e: any) {
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
