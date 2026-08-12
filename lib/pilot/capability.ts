// lib/pilot/capability.ts
// 파일럿 문서의 외부 유출 차단 판정 — v1.8 §3.2·§8, §12 6단계.
//
// ★★설계 원칙(사용자 지시, 2026-08-12): **파일럿 때문에 기존 운영 서비스가 흔들려서는 안 된다.**
//
//  그래서 이 파일에는 "허용해주는" 코드가 없다. 파일럿 직무지도원의 기능 권한은
//  기존 `worker.planType`(운영자 개인 부여) 그대로 쓴다 — planGuard.ts 주석이 말하는
//  "초기 직무지도원 테스트/특례용" 경로가 정확히 그 용도로 이미 존재한다.
//  덕분에 preview·generate·서명 라우트는 **한 줄도 고치지 않는다**.
//
//  여기 남은 것은 차단 판정뿐이다. 차단은 새 라우트를 파서 대신할 수 없다 —
//  막을 경로 위에 있어야만 성립하기 때문에, 이것만 기존 파일에 손을 댄다.
//
//  두 함수 모두 **비파일럿이면 false/0**을 돌려준다. 기존 흐름에 어떤 판단도 더하지 않는다.

import { prisma } from "@/lib/prisma";

export type PilotAssignmentState =
  | { isPilot: false }
  | { isPilot: true; sessionActive: boolean };

/**
 * 배정 하나가 파일럿 회차 소속인가.
 *
 * 차단 판정에는 회차 상태(ACTIVE 여부)가 아니라 **소속 여부**만 쓴다.
 * 회차가 끝났다고 파일럿 문서를 위탁기관에 제출할 수 있게 되면 안 되기 때문이다.
 */
export async function getPilotAssignmentState(assignmentId: bigint): Promise<PilotAssignmentState> {
  const a = await prisma.siteAssignment.findUnique({
    where: { id: assignmentId },
    select: { pilotSessionId: true, pilotSession: { select: { status: true } } },
  });
  if (!a?.pilotSessionId) return { isPilot: false };
  return { isPilot: true, sessionActive: a.pilotSession?.status === "ACTIVE" };
}

/** 문서 run 중 파일럿 배정에 속한 건수. 0이 아니면 외부 전송을 막는다(§3.2). */
export async function countPilotRuns(runIds: bigint[]): Promise<number> {
  if (runIds.length === 0) return 0;
  return prisma.documentRun.count({
    where: { id: { in: runIds }, assignment: { pilotSessionId: { not: null } } },
  });
}
