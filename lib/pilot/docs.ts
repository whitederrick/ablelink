// lib/pilot/docs.ts
// 파일럿 전용 문서 payload — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §9
//
// ★★기존 `lib/pdf/pdfkitRenderer.ts` 와 `app/api/worker/docs/**` 는 **한 줄도 고치지 않는다.**
//  "이름 자리를 넓히는 것"을 렌더러의 전역 fallback 으로 넣으면 정상 운영 PDF 가 전부 바뀐다.
//  파일럿은 **payload 에 문자열을 넣어서 전달**할 뿐이고 렌더러는 받은 것을 그대로 그린다.
//
// ★위탁기관 담당자 슬롯은 문서마다 다르다(F22). 파일럿이 제공하는 3종은 **전부 govAgent** 다.
//  `agencyAgent` 는 종합평가 2종 전용이므로 파일럿은 건드리지 않는다.
//
// ★사업체 담당자 이름은 `Site.businessContactName` 에서 **명시적으로** 넣는다(F25b).
//  기존 경로는 서명 토큰의 `signerName` 을 쓰므로 토큰이 없는 파일럿에서는 빈 문자열이 된다.
//  ★단 서명 이미지(`imageUrl`)는 만들지도 넣지도 않는다 — 대면 서명 흐름은 그대로 둔다.

import { prisma } from "@/lib/prisma";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { buildAttendanceSheetPayload } from "@/lib/docs/attendanceSheetPayload";
import { trainingDailyLogPayload, adaptationDailyLogPayload } from "@/lib/docs/traineeDocPayload";
import { findTraineeAtSiteInPeriod } from "@/lib/docs/traineeSiteGuard";
import { dbKey } from "./registry";
import { PilotError } from "./resources";
import { PILOT_DOC_TYPES, PILOT_HANDWRITE_BLANK, type PilotDocType } from "./docConstants";

// ★상수의 정의는 `./docConstants` 가 갖는다 — 검증 스윕이 prisma·supabase 를 끌어오지 않도록
//  분리했다. 소비처 편의를 위해 여기서 재수출한다.
export { PILOT_DOC_TYPES, PILOT_HANDWRITE_BLANK } from "./docConstants";
export type { PilotDocType } from "./docConstants";

/** 훈련생 선택이 필요한 문서. */
const TRAINEE_DOCS = new Set<string>(["TRAINING_DAILY_LOG", "ADAPTATION_DAILY_LOG"]);

/**
 * 접근 검증 **2단**. 워커 세션만으로는 부족하다.
 *
 *  ① `workerId` 와 `assignmentId` 가 **같은 파일럿**의 레지스트리에 등록돼 있는가
 *  ② 그 배정이 **실제로 그 워커의 것**인가(레지스트리와 실물의 불일치 차단)
 *
 * 비파일럿 워커가 이 경로로 자기 문서를 뽑을 수 없어야 한다 → 미등록이면 404.
 */
export async function assertPilotDocAccess(workerId: bigint, assignmentId: bigint) {
  const [wRes, aRes] = await Promise.all([
    prisma.pilotResource.findUnique({
      where: { kind_resourceKey: { kind: "WORKER", resourceKey: dbKey(workerId) } },
      select: { pilotId: true },
    }),
    prisma.pilotResource.findUnique({
      where: { kind_resourceKey: { kind: "ASSIGNMENT", resourceKey: dbKey(assignmentId) } },
      select: { pilotId: true },
    }),
  ]);
  if (!wRes || !aRes) throw new PilotError(404, "NOT_PILOT", "파일럿 문서 대상이 아닙니다.");
  if (wRes.pilotId !== aRes.pilotId) throw new PilotError(404, "NOT_PILOT", "파일럿 문서 대상이 아닙니다.");

  const assignment = await prisma.siteAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true, workerId: true, siteId: true, workType: true, commuteGuidanceIncluded: true,
      customWorkStart: true, customWorkEnd: true, attendanceButtonExempt: true, stepStart: true,
      site: { select: { id: true, companyName: true, businessContactName: true } },
    },
  });
  // ★레지스트리에 있어도 실제 소유가 다르면 거부한다.
  if (!assignment || assignment.workerId !== workerId || !assignment.site) {
    throw new PilotError(404, "NOT_PILOT", "파일럿 문서 대상이 아닙니다.");
  }
  return { pilotId: wRes.pilotId, assignment };
}

export interface PilotDocInput {
  workerId: bigint;
  assignmentId: bigint;
  docType: string;
  start: string;
  end: string;
  traineeId?: string | null;
}

/**
 * 파일럿 문서 payload 를 만든다. **PDF 를 그리는 데 필요한 것만** 조립하고
 * DocumentRun·DocumentVersion·서명 토큰·Storage 는 **아무것도 만들지 않는다**(§9 미리보기·다운로드 전용).
 */
export async function buildPilotDocPayload(input: PilotDocInput) {
  const { workerId, assignmentId, start, end, traineeId } = input;
  const docType = input.docType as PilotDocType;
  if (!(PILOT_DOC_TYPES as readonly string[]).includes(docType)) {
    throw new PilotError(400, "UNSUPPORTED_DOC", "파일럿에서는 출근부·훈련일지·적응지도 일지만 제공합니다.");
  }

  const { assignment, pilotId } = await assertPilotDocAccess(workerId, assignmentId);
  const site = assignment.site!;

  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { workerName: true, phoneNumber: true, loginId: true, signatureUrl: true },
  });
  // ★서명이 있을 때만 `lib/signatureImage` 를 로드한다.
  //  그 모듈은 `server-only` 를 import 하는데 tsx 가 이를 해석하지 못해(리포 전역 조건)
  //  정적 import 로 두면 검증 스크립트가 이 파일을 아예 불러올 수 없다.
  //  런타임 동작은 동일하다 — 서명이 없으면 원래도 undefined 였다.
  const workerImg = worker?.signatureUrl
    ? await (await import("@/lib/signatureImage")).imageToDataUri(worker.signatureUrl)
    : undefined;

  // ★위탁기관 담당자 = 이름을 모르는 대상이므로 **수기 공란**. 서명 이미지는 넣지 않는다.
  const govAgent = { name: PILOT_HANDWRITE_BLANK, imageUrl: undefined as string | undefined };
  // ★사업체 담당자 = 이름을 아는 대상이므로 **실명**. 서명 이미지는 만들지도 넣지도 않는다.
  const companyManager = { name: site.businessContactName ?? "", imageUrl: undefined as string | undefined };
  const workerSig = { name: worker?.workerName ?? "", imageUrl: workerImg };

  const docTimes = dailyDocTimes(assignment.workType, assignment.commuteGuidanceIncluded, assignment.customWorkStart, assignment.customWorkEnd);

  let trainee: { id: bigint; name: string } | null = null;
  if (TRAINEE_DOCS.has(docType)) {
    let tid: bigint | null = null;
    try { tid = traineeId ? BigInt(traineeId) : null; } catch { tid = null; }
    // IDOR 방지: 배정 현장 + 기간에 실제 재적한 훈련생만(기존 가드 재사용)
    trainee = tid ? await findTraineeAtSiteInPeriod(tid, site.id, start, end) : null;
    if (!trainee) throw new PilotError(400, "TRAINEE_REQUIRED", "훈련생을 선택해 주세요.");

    // ★★현장·기간만으로는 부족하다 — **훈련생도 같은 파일럿의 레지스트리에 있어야 한다.**
    //  파일럿 현장에 비파일럿 훈련생이 잘못 재적되면 위 가드는 통과한다(현장·기간이 맞으므로).
    //  그 이름이 PDF 에 박히고, 5단계 초기화는 레지스트리에 없는 그 훈련생을 지우지 못해
    //  "이름은 문서에 남았는데 데이터는 안 지워지는" 상태가 된다.
    //  파일럿은 전용 자원만 쓴다 — 실제 훈련생을 재사용하지 않는다.
    const tRes = await prisma.pilotResource.findUnique({
      where: { kind_resourceKey: { kind: "TRAINEE", resourceKey: dbKey(trainee.id) } },
      select: { pilotId: true },
    });
    if (!tRes || tRes.pilotId !== pilotId) {
      throw new PilotError(404, "NOT_PILOT", "파일럿 훈련생이 아닙니다.");
    }
  }

  if (docType === "ATTENDANCE_SHEET") {
    const { payload } = await buildAttendanceSheetPayload({
      workerId, start, end, siteId: site.id,
      companyName: site.companyName,
      workerName: worker?.workerName ?? "",
      workerPhone: worker?.phoneNumber ?? worker?.loginId ?? "",
      fallbackAssignment: {
        workType: assignment.workType ?? null,
        commuteGuidanceIncluded: assignment.commuteGuidanceIncluded ?? null,
        customWorkStart: assignment.customWorkStart ?? null,
        customWorkEnd: assignment.customWorkEnd ?? null,
        attendanceButtonExempt: assignment.attendanceButtonExempt ?? null,
      },
      signatures: { govAgent, companyManager, worker: workerSig },
    });
    return { payload, docType, companyName: site.companyName };
  }

  if (docType === "TRAINING_DAILY_LOG") {
    const logs = await prisma.traineeLog.findMany({
      where: { writerId: workerId, traineeId: trainee!.id, trainingType: { in: ["PRE", "FIELD"] }, attendance: { siteId: site.id, workDate: { gte: start, lte: end } } },
      include: { attendance: true, tasks: true }, orderBy: { attendance: { workDate: "asc" } },
    });
    const payload = trainingDailyLogPayload({
      traineeName: trainee!.name, companyName: site.companyName,
      preStartYmd: assignment.stepStart?.toISOString().slice(0, 10) || start,
      start, end, logs, docTimes,
      signatures: { govAgent, companyManager, worker: workerSig },
    });
    return { payload, docType, companyName: site.companyName };
  }

  // ADAPTATION_DAILY_LOG — ★이 문서에는 사업체 담당자 슬롯이 없다(서명 2행: 직무지도원·위탁기관 담당자).
  const logs = await prisma.traineeLog.findMany({
    where: { writerId: workerId, traineeId: trainee!.id, trainingType: "ADAPTATION", attendance: { siteId: site.id, workDate: { gte: start, lte: end } } },
    include: { attendance: true, tasks: true }, orderBy: { attendance: { workDate: "asc" } },
  });
  const payload = adaptationDailyLogPayload({
    traineeName: trainee!.name, companyName: site.companyName,
    start, end, logs, docTimes,
    signatures: { worker: workerSig, govAgent },
  });
  return { payload, docType, companyName: site.companyName };
}
