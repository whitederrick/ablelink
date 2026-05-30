import "server-only";
import { prisma } from "@/lib/prisma";

export async function logApiCall(
  workerId: bigint,
  service: "GROQ_STT" | "GEMINI_LOG" | "GEMINI_BATCH",
  success: boolean,
) {
  try {
    const assignment = await prisma.siteAssignment.findFirst({
      where: { workerId, status: "ACTIVE" },
      select: { agencyId: true },
      orderBy: { startDate: "desc" },
    });
    await prisma.apiCallLog.create({
      data: { agencyId: assignment?.agencyId ?? null, workerId, service, success },
    });
  } catch {
    // 로깅 실패는 서비스에 영향 없음
  }
}
