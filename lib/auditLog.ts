import "server-only";
import { prisma } from "@/lib/prisma";

export async function logAudit(params: {
  adminId?: bigint | null;
  action: string;
  target?: string;
  detail?: Record<string, unknown> | string;
  ipAddress?: string;
}) {
  try {
    await prisma.systemAuditLog.create({
      data: {
        adminId:   params.adminId ?? null,
        action:    params.action,
        target:    params.target ?? null,
        detail:    params.detail
          ? (typeof params.detail === "string" ? params.detail : JSON.stringify(params.detail))
          : null,
        ipAddress: params.ipAddress ?? null,
      },
    });
  } catch {
    // 감사 로그 실패가 메인 작업을 막지 않도록
  }
}
