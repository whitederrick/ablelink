import "server-only";
import { prisma } from "@/lib/prisma";

export async function logApiCall(
  userId: bigint,
  service: "GROQ_STT" | "GEMINI_LOG" | "GEMINI_BATCH",
  success: boolean,
) {
  try {
    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: "ACTIVE" },
      select: { agencyId: true },
      orderBy: { startDate: "desc" },
    });
    await prisma.apiCallLog.create({
      data: { agencyId: assignment?.agencyId ?? null, userId, service, success },
    });
  } catch {
    // 로깅 실패는 서비스에 영향 없음
  }
}
