// lib/pilot/purge.ts
// 파일럿 초기화(전량 삭제) — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §10 (v5 개정판)
//
// ★삭제의 유일한 근거는 레지스트리다. 이름 접두어·생성 날짜 추정은 금지다
//  (Prisma `startsWith`가 `_`를 LIKE 와일드카드로 넘겨 한글 기관명까지 매칭한 사고가 있었다).
//
// ★실행은 3단계다(§10-1). 전체를 하나의 트랜잭션으로 묶지 않는다 —
//  Storage 삭제는 외부 HTTP 호출이라 DB 트랜잭션과 원자적으로 묶을 수 없고,
//  긴 트랜잭션 안에서 외부 API를 부르면 커넥션을 점유한 채 타임아웃에 걸린다.
//
//    [1] 트랜잭션 밖 : Storage prefix 나열(외부 호출) + 읽기 전용 수집
//    [2] 트랜잭션    : 잠금 → 재수집·정합 확인 → STORAGE_OBJECT 기록 → DB 삭제
//    [3] 트랜잭션 밖 : Storage 객체 삭제 → 전부 성공이면 Pilot 삭제, 실패분은 보존(재시도 목록)
//
// ★이 경로는 `audit()`를 부르지 않는다(§10-2-2). AuditEvent는 Prisma 확장 자동기록이 아니라
//  라우트가 명시 호출하는 방식이므로, 부르지 않으면 이 대량 삭제는 감사행을 한 줄도 만들지 않는다.
//  남기면 삭제 직후 파일럿을 가리키는 행이 다시 생겨 "흔적 0"과 충돌한다.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { PilotError } from "./resources";
import { storageKey } from "./registry";

const SIG_BUCKET = "signatures";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ─────────────────────────────────────────────────────────────
// 수집 — 레지스트리 + 감사 축에 필요한 자식 id + Storage 경로 근거
// ─────────────────────────────────────────────────────────────

/** 삭제 대상 범위. 레지스트리에서 나온 것과, 그 자식 중 **감사기록에 남는 것**만 담는다. */
export interface PilotScope {
  pilotId: bigint;
  pilotName: string;
  agencyId: bigint | null;
  siteIds: bigint[];
  traineeIds: bigint[];
  placementIds: bigint[];
  workerIds: bigint[];
  assignmentIds: bigint[];
  // ★자식 5종 — Cascade로 사라지지만 감사기록에 entityType으로 남으므로 id가 필요하다(§10-2).
  //  코드가 실제 쓰는 entityType에 없는 자식(TraineeLogTask·DocumentVersion·DocumentSubmissionLog·
  //  AttendanceIssue·SiteHolidayRequest·SiteContact·SiteBasePoint)은 수집하지 않는다.
  attendanceIds: bigint[];
  traineeLogIds: bigint[];
  editRequestIds: bigint[];
  docRunIds: bigint[];
  siteHolidayIds: bigint[];
  // ★Storage `sign-tokens/{token}/`의 유일한 근거. SiteAssignment Cascade로 사라지면 끝이다(F20).
  signTokens: string[];
  /** DB 행이 가리키는 서명 경로(신·구 포맷 모두 정규화). */
  dbStoragePaths: string[];
}

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * `lib/signatureImage.signaturePathFromStored`와 **같은 규칙**의 최소 복제.
 *
 * ★그 파일은 `import "server-only"`라 검증 스크립트(tsx)에서 import하면 실행 자체가 안 된다.
 *  운영 파일을 고치지 않는다는 규율(파일럿 제1원칙) 때문에 그쪽을 손대는 대신 여기서 복제한다.
 *  파일럿이 만드는 값은 항상 신 포맷(경로)이고, 구 포맷 분기는 방어용이다.
 */
function storagePathFrom(stored?: string | null): string | null {
  if (!stored) return null;
  if (stored.startsWith("data:")) return null;
  const pub = `/object/public/${SIG_BUCKET}/`;
  let i = stored.indexOf(pub);
  if (i >= 0) return decodeURIComponent(stored.slice(i + pub.length).split("?")[0]);
  const signed = `/object/sign/${SIG_BUCKET}/`;
  i = stored.indexOf(signed);
  if (i >= 0) return decodeURIComponent(stored.slice(i + signed.length).split("?")[0]);
  if (!/^https?:\/\//i.test(stored)) return stored.replace(/^\/+/, "") || null;
  return null; // 서명 버킷과 무관한 http URL
}

/** 레지스트리 → 자원 id. 삭제의 유일한 근거다. */
async function registryIds(db: DbClient, pilotId: bigint) {
  const rows = await db.pilotResource.findMany({
    where: { pilotId },
    select: { kind: true, resourceKey: true },
    orderBy: { id: "asc" },
  });
  const of = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => BigInt(r.resourceKey));
  return {
    agencyIds: of("AGENCY"),
    siteIds: of("SITE"),
    traineeIds: of("TRAINEE"),
    placementIds: of("PLACEMENT"),
    workerIds: of("WORKER"),
    assignmentIds: of("ASSIGNMENT"),
    storageKeys: rows.filter((r) => r.kind === "STORAGE_OBJECT").map((r) => r.resourceKey),
  };
}

/**
 * 파일럿 범위 수집. 읽기 전용이므로 트랜잭션 안팎 모두에서 쓴다.
 *
 * ★자식 id와 `SiteSignToken.token`은 **아무것도 지우기 전에** 뽑아야 한다.
 *  배정을 지우면 Cascade로 사라져 감사기록 축과 Storage 경로의 근거가 동시에 없어진다.
 */
export async function collectPilotScope(db: DbClient, pilotId: bigint): Promise<PilotScope> {
  const pilot = await db.pilot.findUnique({ where: { id: pilotId }, select: { id: true, name: true } });
  if (!pilot) throw new PilotError(404, "PILOT_NOT_FOUND", "파일럿을 찾을 수 없습니다.");

  const reg = await registryIds(db, pilotId);
  const assignmentIds = reg.assignmentIds;

  const attendances = assignmentIds.length
    ? await db.dailyAttendance.findMany({ where: { assignmentId: { in: assignmentIds } }, select: { id: true } })
    : [];
  const attendanceIds = attendances.map((a) => a.id);

  const [logs, editRequests, runs, holidays, tokens] = await Promise.all([
    attendanceIds.length
      ? db.traineeLog.findMany({ where: { attendanceId: { in: attendanceIds } }, select: { id: true } })
      : Promise.resolve([]),
    attendanceIds.length
      ? db.attendanceEditRequest.findMany({ where: { attendanceId: { in: attendanceIds } }, select: { id: true } })
      : Promise.resolve([]),
    assignmentIds.length
      ? db.documentRun.findMany({
          where: { assignmentId: { in: assignmentIds } },
          select: { id: true, managerSignatureUrl: true, agencySignatureUrl: true },
        })
      : Promise.resolve([]),
    assignmentIds.length
      ? db.siteHoliday.findMany({ where: { assignmentId: { in: assignmentIds } }, select: { id: true } })
      : Promise.resolve([]),
    assignmentIds.length
      ? db.siteSignToken.findMany({
          where: { assignmentId: { in: assignmentIds } },
          select: { token: true, signatureUrl: true },
        })
      : Promise.resolve([]),
  ]);

  // 서명 경로(DB 참조 기반) — prefix 나열과 합집합을 이룬다.
  const workers = reg.workerIds.length
    ? await db.worker.findMany({ where: { id: { in: reg.workerIds } }, select: { signatureUrl: true } })
    : [];
  const versions = runs.length
    ? await db.documentVersion.findMany({ where: { runId: { in: runs.map((r) => r.id) } }, select: { pdfUrl: true } })
    : [];

  const dbStoragePaths = Array.from(
    new Set(
      [
        ...workers.map((w) => w.signatureUrl),
        ...tokens.map((t) => t.signatureUrl),
        ...runs.map((r) => r.managerSignatureUrl),
        ...runs.map((r) => r.agencySignatureUrl),
        // ★DocumentVersion.pdfUrl은 `worker/docs/submit:120`이 ""로 넣는다(파일 미저장).
        //  지시서 초안의 "DocumentVersion 경로 확보"는 오기였지만, 값이 들어오는 경로가 생길
        //  경우를 대비해 방어적으로만 훑는다.
        ...versions.map((v) => v.pdfUrl),
      ]
        .map(storagePathFrom)
        .filter((p): p is string => !!p),
    ),
  );

  return {
    pilotId,
    pilotName: pilot.name,
    agencyId: reg.agencyIds[0] ?? null,
    siteIds: reg.siteIds,
    traineeIds: reg.traineeIds,
    placementIds: reg.placementIds,
    workerIds: reg.workerIds,
    assignmentIds,
    attendanceIds,
    traineeLogIds: logs.map((l) => l.id),
    editRequestIds: editRequests.map((e) => e.id),
    docRunIds: runs.map((r) => r.id),
    siteHolidayIds: holidays.map((h) => h.id),
    signTokens: tokens.map((t) => t.token),
    dbStoragePaths,
  };
}

// ─────────────────────────────────────────────────────────────
// 감사·접속 기록 축 (§10-2-1)
// ─────────────────────────────────────────────────────────────

/**
 * AuditEvent 삭제 축.
 *
 * ★`agencyId` 축은 **항상 0건**이다 — `auditActorFrom`은 MANAGER scope에서만 agencyId를 채우는데
 *  파일럿은 Manager를 만들지 않는다. 보험으로만 남긴다.
 * ★`entityId` 단독 매칭 금지 — 테이블별 id라 값이 겹친다. 반드시 `entityType`과 쌍으로 건다.
 */
function auditWhere(s: PilotScope): Prisma.AuditEventWhereInput | null {
  const pairs: [string, bigint[]][] = [
    ["Pilot", [s.pilotId]],
    ["Agency", s.agencyId ? [s.agencyId] : []],
    ["Site", s.siteIds],
    ["Trainee", s.traineeIds],
    ["Worker", s.workerIds],
    ["SiteAssignment", s.assignmentIds],
    ["DailyAttendance", s.attendanceIds],
    ["TraineeLog", s.traineeLogIds],
    ["DocumentRun", s.docRunIds],
    ["AttendanceEditRequest", s.editRequestIds],
    ["SiteHoliday", s.siteHolidayIds],
  ];
  const or: Prisma.AuditEventWhereInput[] = pairs
    .filter(([, ids]) => ids.length > 0)
    .map(([entityType, ids]) => ({ entityType, entityId: { in: ids.map(String) } }));
  if (s.workerIds.length) or.push({ actorType: "WORKER", actorId: { in: s.workerIds } });
  if (s.agencyId) or.push({ agencyId: s.agencyId });
  return or.length ? { OR: or } : null;
}

/**
 * AccessLog 삭제 축. `subjectId`는 String 컬럼이라 문자열로 비교한다.
 *
 * ★`subjectId=null`인 요약형 기록(예: "현장 훈련생 목록 3명")은 귀속 판별이 구조적으로 불가능하다.
 *  파일럿 대상자의 성명·연락처가 들어가지 않으므로 삭제 대상에서 빠지는 것이 정상이다(§10-2-1).
 */
function accessWhere(s: PilotScope): Prisma.AccessLogWhereInput | null {
  const pairs: [string, bigint[]][] = [
    ["Worker", s.workerIds],
    ["Trainee", s.traineeIds],
    ["DocumentRun", s.docRunIds],
  ];
  const or: Prisma.AccessLogWhereInput[] = pairs
    .filter(([, ids]) => ids.length > 0)
    .map(([subjectType, ids]) => ({ subjectType, subjectId: { in: ids.map(String) } }));
  if (s.agencyId) or.push({ agencyId: s.agencyId });
  return or.length ? { OR: or } : null;
}

/** ApiCallLog 삭제 축. ★agencyId·workerId 둘 다 SetNull이라 **부모보다 먼저** 지워야 한다. */
function apiCallWhere(s: PilotScope): Prisma.ApiCallLogWhereInput | null {
  const or: Prisma.ApiCallLogWhereInput[] = [];
  if (s.workerIds.length) or.push({ workerId: { in: s.workerIds } });
  if (s.agencyId) or.push({ agencyId: s.agencyId });
  return or.length ? { OR: or } : null;
}

// ─────────────────────────────────────────────────────────────
// preflight — 0이 아니면 [명시 삭제 승격] 또는 [중단]
// ─────────────────────────────────────────────────────────────

export interface PurgeBlocker {
  label: string;
  count: number;
  reason: string;
}

/**
 * 중단 사유 조사(§10-5). **추정으로 건너뛰지 않는다.**
 *
 * 두 부류다:
 *  · 설계 위반 — 파일럿이 만들지 않기로 한 것이 실재한다(계약·급여·연차·Manager 등)
 *  · 경계 침범 — 레지스트리 밖 자원이거나, 외부 운영 행이 파일럿 자원을 가리킨다
 * 어느 쪽이든 **사람이 판단해야 하므로 자동 삭제하지 않는다.**
 */
export async function findPurgeBlockers(db: DbClient, s: PilotScope): Promise<PurgeBlocker[]> {
  const out: PurgeBlocker[] = [];
  const push = (label: string, count: number, reason: string) => {
    if (count > 0) out.push({ label, count, reason });
  };

  const agencyId = s.agencyId;
  const w = s.workerIds;
  const sites = s.siteIds;

  if (agencyId) {
    const [manager, contract, payContract, payrollRun, deduction, leaveEntry, leaveReq, survey, group, mInvite, ticket, signup] =
      await Promise.all([
        db.manager.count({ where: { agencyId } }),
        db.employmentContract.count({ where: { OR: [{ agencyId }, ...(w.length ? [{ workerId: { in: w } }] : [])] } }),
        db.payContract.count({ where: { OR: [{ agencyId }, ...(w.length ? [{ workerId: { in: w } }] : [])] } }),
        db.payrollRun.count({ where: { agencyId } }),
        db.agencyDeduction.count({ where: { agencyId } }),
        db.annualLeaveEntry.count({ where: { OR: [{ agencyId }, ...(w.length ? [{ workerId: { in: w } }] : [])] } }),
        db.annualLeaveRequest.count({ where: { OR: [{ agencyId }, ...(w.length ? [{ workerId: { in: w } }] : [])] } }),
        db.satisfactionSurvey.count({ where: { OR: [{ agencyId }, ...(w.length ? [{ workerId: { in: w } }] : [])] } }),
        db.noticeGroup.count({ where: { agencyId } }),
        db.managerInvite.count({ where: { agencyId } }),
        db.supportTicket.count({ where: { agencyId } }),
        db.managerSignupRequest.count({ where: { agencyId } }),
      ]);

    push("Manager", manager, "파일럿은 위탁기관 담당자 계정을 만들지 않는다 — 설계 위반이라 사람이 판단해야 한다.");
    push("EmploymentContract", contract, "근로계약은 만들지 않기로 했다(F28). 연차 자동적립 회피 전제가 깨진다.");
    push("PayContract", payContract, "급여 기준은 만들지 않기로 했다(F28).");
    push("PayrollRun", payrollRun, "급여는 기관 플랜(STANDARD)으로 막혀 있어야 한다(F5).");
    push("AgencyDeduction", deduction, "급여 공제 설정이 존재한다 — 급여 경로가 열렸다는 신호다.");
    push("AnnualLeaveEntry", leaveEntry, "근로계약이 없으면 적립 후보에서 빠져야 한다(F12).");
    push("AnnualLeaveRequest", leaveReq, "연차 신청이 존재한다 — 근로계약이 만들어졌을 가능성이 있다.");
    push("SatisfactionSurvey", survey, "만족도 자동발송은 기본 OFF다. 존재하면 경로를 확인해야 한다.");
    push("NoticeGroup", group, "Manager 부재라 생성 경로가 없어야 한다.");
    push("ManagerInvite", mInvite, "Manager 부재라 생성 경로가 없어야 한다.");
    push("SupportTicket", ticket, "Manager 부재라 생성 경로가 없어야 한다.");
    push("ManagerSignupRequest", signup, "전용 기관으로 위탁기관 가입 신청이 들어와 있다.");

    // ★레지스트리 밖 자원 = 기록 누락. 레지스트리가 삭제의 유일한 근거이므로 자동 진행하면 안 된다.
    const [strayS, strayA] = await Promise.all([
      db.site.count({ where: { agencyId, ...(sites.length ? { id: { notIn: sites } } : {}) } }),
      db.siteAssignment.count({ where: { agencyId, ...(s.assignmentIds.length ? { id: { notIn: s.assignmentIds } } : {}) } }),
    ]);
    push("레지스트리 밖 Site", strayS, "전용 기관 소속인데 레지스트리에 없다 — 기록 누락이라 삭제 근거가 없다.");
    push("레지스트리 밖 SiteAssignment", strayA, "전용 기관 소속인데 레지스트리에 없다 — 기록 누락이라 삭제 근거가 없다.");
  }

  if (sites.length) {
    const [strayP, strayT, recruit, offerSite, merged] = await Promise.all([
      db.traineePlacement.count({
        where: { siteId: { in: sites }, ...(s.placementIds.length ? { id: { notIn: s.placementIds } } : {}) },
      }),
      db.trainee.count({
        where: { currentSiteId: { in: sites }, ...(s.traineeIds.length ? { id: { notIn: s.traineeIds } } : {}) },
      }),
      db.recruitPost.count({ where: { siteId: { in: sites } } }),
      db.talentOffer.count({ where: { siteId: { in: sites } } }),
      db.site.count({ where: { mergedToSiteId: { in: sites } } }),
    ]);
    push("레지스트리 밖 TraineePlacement", strayP, "파일럿 현장에 레지스트리 밖 재적이 있다 — 삭제 근거가 없다.");
    push("레지스트리 밖 Trainee", strayT, "파일럿 현장에 레지스트리 밖 훈련생이 재적돼 있다 — 삭제 근거가 없다.");
    push("RecruitPost(파일럿 현장 참조)", recruit, "외부 공고가 파일럿 현장을 가리킨다 — 지우면 외부 행이 조용히 수정된다(SetNull).");
    push("TalentOffer(파일럿 현장 참조)", offerSite, "외부 제안이 파일럿 현장을 가리킨다 — 지우면 외부 행이 조용히 수정된다(SetNull).");
    push("Site.mergedToSiteId(파일럿 현장 참조)", merged, "외부 현장이 파일럿 현장을 병합 대상으로 가리킨다.");
  }

  if (w.length) {
    const [payrollItem, review, application, offer] = await Promise.all([
      db.payrollItem.count({ where: { workerId: { in: w } } }),
      db.workerReview.count({ where: { workerId: { in: w } } }),
      db.recruitApplication.count({ where: { workerId: { in: w } } }),
      db.talentOffer.count({ where: { workerId: { in: w } } }),
    ]);
    push("PayrollItem", payrollItem, "급여 항목이 존재한다 — 급여 경로가 열렸다는 신호다.");
    push("WorkerReview", review, "외부 기관이 파일럿 워커를 평가했다 — Cascade로 조용히 사라진다.");
    push("RecruitApplication", application, "파일럿 워커가 외부 공고에 지원했다 — Cascade로 외부 공고의 지원 행이 사라진다.");
    push("TalentOffer(워커 대상)", offer, "외부 기관이 파일럿 워커에게 제안했다 — Cascade로 조용히 사라진다.");
  }

  return out;
}

// ─────────────────────────────────────────────────────────────
// Storage — prefix 나열 + 삭제 (자체 함수·응답 검사)
// ─────────────────────────────────────────────────────────────

/**
 * signatures 버킷에서 파일럿 prefix를 나열한다(§7 개정판).
 *
 * ★"업로드 직후 레지스트리 등록"은 기각했다 — 기존 운영 라우트 수정을 요구하기 때문이다.
 *  대신 경로가 전부 결정적 prefix를 갖는다는 사실을 쓴다:
 *    `{workerId}/` · `inperson/{assignmentId}/` · `sign-tokens/{token}/`
 *  DB가 참조하지 않는 **고아 객체까지 회수**되므로 등록 방식보다 오히려 완전하다
 *  (`worker/signature:90`의 DB 갱신 실패로 남는 고아가 실제 사례다).
 */
export async function listPilotStorageObjects(s: PilotScope): Promise<string[]> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new PilotError(500, "STORAGE_ENV", "Storage 접근 설정(NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY)이 없습니다.");
  }
  const prefixes = [
    ...s.workerIds.map((id) => `${id}`),
    ...s.assignmentIds.map((id) => `inperson/${id}`),
    ...s.signTokens.map((t) => `sign-tokens/${t}`),
  ];

  const found = new Set<string>();
  for (const prefix of prefixes) {
    for (let offset = 0; ; offset += 100) {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${SIG_BUCKET}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
      });
      if (!res.ok) {
        throw new PilotError(502, "STORAGE_LIST_FAILED", `Storage 목록 조회 실패(${prefix}): ${res.status}`);
      }
      const rows = (await res.json()) as { name: string; id: string | null }[];
      // id=null은 하위 폴더 항목이다. 파일럿 경로는 한 단계뿐이라 파일만 담는다.
      for (const r of rows) if (r.id) found.add(`${prefix}/${r.name}`);
      if (rows.length < 100) break;
    }
  }
  for (const p of s.dbStoragePaths) found.add(p);
  return Array.from(found).sort();
}

/**
 * Storage 객체 1건 삭제. ★응답을 **검사한다**.
 *
 * ★운영 함수(`worker/signature/route.ts:135` `deleteFromStorage`)를 재사용하지 않는다 —
 *  그 함수는 `ok`를 검사하지 않아 4xx/5xx도 성공처럼 지나간다(§10-3-1, 백로그 이관).
 * ★404(이미 없음)는 성공으로 본다 — 재시도가 멱등이어야 한다.
 */
async function deleteStorageObject(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SIG_BUCKET}/${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (res.ok || res.status === 404) return { ok: true };
    return { ok: false, error: `HTTP ${res.status} ${(await res.text()).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

// ─────────────────────────────────────────────────────────────
// 미리보기
// ─────────────────────────────────────────────────────────────

export interface PurgePreview {
  pilot: { id: string; name: string };
  agencyId: string | null;
  /** 레지스트리 자원(삭제의 근거) */
  registry: Record<string, number>;
  /** Cascade로 함께 사라지는 것 */
  cascade: Record<string, number>;
  /** 명시 삭제 대상 */
  explicit: Record<string, number>;
  /** Storage 객체 경로 */
  storage: string[];
  /** 0이 아니면 초기화를 실행하지 않는다 */
  blockers: PurgeBlocker[];
  /** 이전 실행의 Storage 삭제 실패분(재시도 대상) */
  retryPending: number;
  /** 참여자가 기존 /worker/docs 경로를 썼다는 신호(0이 정상) */
  signals: Record<string, number>;
}

/** 초기화 미리보기. **아무것도 지우지 않는다.** 실행 전 재확인용이다(§10-1 공통 규율). */
export async function previewPilotPurge(pilotId: bigint): Promise<PurgePreview> {
  const s = await collectPilotScope(prisma, pilotId);
  const [blockers, storage, counts, retryPending] = await Promise.all([
    findPurgeBlockers(prisma, s),
    listPilotStorageObjects(s),
    countTargets(prisma, s),
    prisma.pilotResource.count({ where: { pilotId, deleteError: { not: null } } }),
  ]);

  return {
    pilot: { id: s.pilotId.toString(), name: s.pilotName },
    agencyId: s.agencyId?.toString() ?? null,
    registry: {
      Agency: s.agencyId ? 1 : 0,
      Site: s.siteIds.length,
      Trainee: s.traineeIds.length,
      TraineePlacement: s.placementIds.length,
      Worker: s.workerIds.length,
      SiteAssignment: s.assignmentIds.length,
    },
    cascade: {
      DailyAttendance: s.attendanceIds.length,
      TraineeLog: s.traineeLogIds.length,
      AttendanceEditRequest: s.editRequestIds.length,
      DocumentRun: s.docRunIds.length,
      SiteHoliday: s.siteHolidayIds.length,
      SiteSignToken: s.signTokens.length,
    },
    explicit: counts,
    storage,
    blockers,
    retryPending,
    signals: { DocumentRun: s.docRunIds.length },
  };
}

/** 명시 삭제 대상의 현재 건수. */
async function countTargets(db: DbClient, s: PilotScope): Promise<Record<string, number>> {
  const aw = auditWhere(s), acw = accessWhere(s), apw = apiCallWhere(s);
  const [supervision, evaluation, invite, announcement, apiCall, audit, access] = await Promise.all([
    s.assignmentIds.length || s.traineeIds.length || s.placementIds.length
      ? db.traineeSupervision.count({ where: supervisionWhere(s) })
      : Promise.resolve(0),
    s.traineeIds.length || s.workerIds.length
      ? db.traineeEvaluation.count({ where: evaluationWhere(s) })
      : Promise.resolve(0),
    s.agencyId || s.siteIds.length ? db.workerInvite.count({ where: inviteWhere(s) }) : Promise.resolve(0),
    s.agencyId ? db.agencyAnnouncement.count({ where: { agencyId: s.agencyId } }) : Promise.resolve(0),
    apw ? db.apiCallLog.count({ where: apw }) : Promise.resolve(0),
    aw ? db.auditEvent.count({ where: aw }) : Promise.resolve(0),
    acw ? db.accessLog.count({ where: acw }) : Promise.resolve(0),
  ]);
  return {
    TraineeSupervision: supervision,
    TraineeEvaluation: evaluation,
    WorkerInvite: invite,
    AgencyAnnouncement: announcement,
    ApiCallLog: apiCall,
    AuditEvent: audit,
    AccessLog: access,
  };
}

/** ★RESTRICT라 배정·재적보다 먼저 지운다. 세 축 중 하나만 걸려도 대상이다. */
function supervisionWhere(s: PilotScope): Prisma.TraineeSupervisionWhereInput {
  const or: Prisma.TraineeSupervisionWhereInput[] = [];
  if (s.assignmentIds.length) or.push({ assignmentId: { in: s.assignmentIds } });
  if (s.traineeIds.length) or.push({ traineeId: { in: s.traineeIds } });
  if (s.placementIds.length) or.push({ placementId: { in: s.placementIds } });
  return { OR: or };
}

/**
 * ★조건은 **OR**다(§10-2). AND로 묶으면 교차 연결된 행이 남아 Trainee·Worker 삭제를 막는다.
 * `TraineeEvaluation`은 trainee·writer 양쪽 RESTRICT이고 Cascade 체인에도 없다.
 */
function evaluationWhere(s: PilotScope): Prisma.TraineeEvaluationWhereInput {
  const or: Prisma.TraineeEvaluationWhereInput[] = [];
  if (s.traineeIds.length) or.push({ traineeId: { in: s.traineeIds } });
  if (s.workerIds.length) or.push({ writerId: { in: s.workerIds } });
  return { OR: or };
}

/** ★실제 차단 지점은 `agencyId`(required→RESTRICT)다. `siteId`는 optional이라 SetNull이다. */
function inviteWhere(s: PilotScope): Prisma.WorkerInviteWhereInput {
  const or: Prisma.WorkerInviteWhereInput[] = [];
  if (s.agencyId) or.push({ agencyId: s.agencyId });
  if (s.siteIds.length) or.push({ siteId: { in: s.siteIds } });
  return { OR: or };
}

// ─────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────

export interface PurgeResult {
  pilot: { id: string; name: string };
  /** 종류별 실제 삭제 건수 */
  deleted: Record<string, number>;
  storage: { total: number; deleted: number; failed: { path: string; error: string }[] };
  /** 전부 성공해 Pilot·레지스트리까지 지웠는가 */
  completed: boolean;
  /** 삭제 후 재조회한 잔여 건수. 전부 0이어야 한다 */
  leftovers: Record<string, number>;
}

/**
 * 파일럿 전량 초기화.
 *
 * @param confirmName 파일럿 이름과 정확히 일치해야 실행한다(오클릭 방지 — 되돌릴 수 없는 작업).
 */
export async function purgePilot(pilotId: bigint, confirmName: unknown): Promise<PurgeResult> {
  // ── [1] 트랜잭션 밖 — 읽기 전용 수집 + Storage 나열(외부 호출)
  const pre = await collectPilotScope(prisma, pilotId);
  if (String(confirmName ?? "").trim() !== pre.pilotName) {
    throw new PilotError(400, "CONFIRM_MISMATCH", "확인을 위해 파일럿 이름을 정확히 입력해 주세요.");
  }
  const blockers = await findPurgeBlockers(prisma, pre);
  if (blockers.length > 0) {
    throw new PilotError(409, "PURGE_BLOCKED",
      `초기화를 중단했습니다 — 예상 밖 데이터가 있습니다: ${blockers.map((b) => `${b.label} ${b.count}건`).join(", ")}`);
  }
  const storagePaths = await listPilotStorageObjects(pre);

  // ── [2] 트랜잭션 — 잠금 → 재수집·정합 확인 → 기록 → 삭제
  const deleted = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM pilots WHERE id = ${pilotId} FOR UPDATE`;
    if (locked.length === 0) throw new PilotError(404, "PILOT_NOT_FOUND", "파일럿을 찾을 수 없습니다.");

    // ★잠금 안에서 다시 읽는다. [1]과 달라졌다면 그 사이 자원이 늘어난 것이므로
    //  Storage 나열 결과가 낡았다 — 중단하고 다시 시작하게 한다.
    const s = await collectPilotScope(tx, pilotId);
    if (!sameScope(pre, s)) {
      throw new PilotError(409, "SCOPE_CHANGED", "초기화 준비 중 파일럿 자원이 변경되었습니다. 다시 시도해 주세요.");
    }

    // ★Storage 경로를 레지스트리에 남긴다 — 삭제 실패 시 재시도 목록이 된다.
    if (storagePaths.length) {
      await tx.pilotResource.createMany({
        data: storagePaths.map((p) => ({
          pilotId,
          kind: "STORAGE_OBJECT" as const,
          resourceKey: storageKey(SIG_BUCKET, p),
        })),
        skipDuplicates: true,
      });
    }

    const n: Record<string, number> = {};
    const del = async (label: string, fn: () => Promise<{ count: number }>) => {
      n[label] = (await fn()).count;
    };

    // [파생 기록] ★ApiCallLog는 SetNull이라 부모보다 먼저여야 한다.
    const apw = apiCallWhere(s), aw = auditWhere(s), acw = accessWhere(s);
    if (apw) await del("ApiCallLog", () => tx.apiCallLog.deleteMany({ where: apw }));
    if (aw) await del("AuditEvent", () => tx.auditEvent.deleteMany({ where: aw }));
    if (acw) await del("AccessLog", () => tx.accessLog.deleteMany({ where: acw }));

    // [명시 삭제] 부모보다 먼저 지워야 하는 것
    if (s.assignmentIds.length || s.traineeIds.length || s.placementIds.length) {
      await del("TraineeSupervision", () => tx.traineeSupervision.deleteMany({ where: supervisionWhere(s) }));
    }
    if (s.traineeIds.length || s.workerIds.length) {
      await del("TraineeEvaluation", () => tx.traineeEvaluation.deleteMany({ where: evaluationWhere(s) }));
    }
    if (s.agencyId || s.siteIds.length) {
      await del("WorkerInvite", () => tx.workerInvite.deleteMany({ where: inviteWhere(s) }));
    }
    if (s.agencyId) {
      await del("AgencyAnnouncement", () => tx.agencyAnnouncement.deleteMany({ where: { agencyId: s.agencyId! } }));
    }

    // [부모 삭제] Cascade가 딸린 것을 뒤에
    //  SiteAssignment → DailyAttendance(→TraineeLog·AttendanceIssue·AttendanceEditRequest)
    //                 · DocumentRun(→DocumentVersion·DocumentSubmissionLog) · SiteHoliday · SiteSignToken
    if (s.assignmentIds.length) {
      await del("SiteAssignment", () => tx.siteAssignment.deleteMany({ where: { id: { in: s.assignmentIds } } }));
    }
    if (s.placementIds.length) {
      await del("TraineePlacement", () => tx.traineePlacement.deleteMany({ where: { id: { in: s.placementIds } } }));
    }
    if (s.traineeIds.length) {
      await del("Trainee", () => tx.trainee.deleteMany({ where: { id: { in: s.traineeIds } } }));
    }
    if (s.workerIds.length) {
      await del("Worker", () => tx.worker.deleteMany({ where: { id: { in: s.workerIds } } }));
    }
    if (s.siteIds.length) {
      await del("Site", () => tx.site.deleteMany({ where: { id: { in: s.siteIds } } }));
    }
    if (s.agencyId) {
      await del("Agency", () => tx.agency.deleteMany({ where: { id: s.agencyId! } }));
    }
    return n;
  }, { timeout: 120_000, maxWait: 20_000 });

  // ── [3] 트랜잭션 밖 — Storage 삭제 → 결과 반영
  const failed: { path: string; error: string }[] = [];
  let removed = 0;
  for (const path of storagePaths) {
    const r = await deleteStorageObject(path);
    const key = storageKey(SIG_BUCKET, path);
    if (r.ok) {
      removed++;
      await prisma.pilotResource.deleteMany({ where: { pilotId, kind: "STORAGE_OBJECT", resourceKey: key } });
    } else {
      failed.push({ path, error: r.error });
      // ★실패는 삼키지 않는다 — 사유를 남기고 행을 보존해 재시도 목록으로 쓴다.
      await prisma.pilotResource.updateMany({
        where: { pilotId, kind: "STORAGE_OBJECT", resourceKey: key },
        data: { deleteError: r.error },
      });
    }
  }

  // ★실패분이 있으면 Pilot을 지우지 않는다 — 지우면 Cascade로 재시도 목록까지 사라진다.
  const completed = failed.length === 0;
  if (completed) {
    await prisma.pilotResource.deleteMany({ where: { pilotId } });
    await prisma.pilot.delete({ where: { id: pilotId } });
  }

  // ★"정리 완료" 출력만 믿지 않는다 — 조회로 잔여 0을 재확인한다(§10-1 공통 규율).
  const leftovers = await recheckLeftovers(pre, completed);

  return {
    pilot: { id: pre.pilotId.toString(), name: pre.pilotName },
    deleted,
    storage: { total: storagePaths.length, deleted: removed, failed },
    completed,
    leftovers,
  };
}

/** [1]과 [2]의 범위가 같은지 — 그 사이 자원이 늘거나 줄었으면 Storage 나열 결과가 낡았다. */
function sameScope(a: PilotScope, b: PilotScope): boolean {
  const key = (s: PilotScope) =>
    JSON.stringify([
      s.agencyId?.toString() ?? null,
      s.siteIds.map(String), s.traineeIds.map(String), s.placementIds.map(String),
      s.workerIds.map(String), s.assignmentIds.map(String),
      s.attendanceIds.map(String), s.docRunIds.map(String), s.signTokens,
    ]);
  return key(a) === key(b);
}

/** 삭제 후 잔여를 **재조회**한다. 전부 0이어야 한다. */
async function recheckLeftovers(s: PilotScope, completed: boolean): Promise<Record<string, number>> {
  const aw = auditWhere(s), acw = accessWhere(s), apw = apiCallWhere(s);
  const [agency, site, trainee, placement, worker, assignment, supervision, evaluation, invite, apiCall, audit, access, resource, pilot] =
    await Promise.all([
      s.agencyId ? prisma.agency.count({ where: { id: s.agencyId } }) : Promise.resolve(0),
      s.siteIds.length ? prisma.site.count({ where: { id: { in: s.siteIds } } }) : Promise.resolve(0),
      s.traineeIds.length ? prisma.trainee.count({ where: { id: { in: s.traineeIds } } }) : Promise.resolve(0),
      s.placementIds.length ? prisma.traineePlacement.count({ where: { id: { in: s.placementIds } } }) : Promise.resolve(0),
      s.workerIds.length ? prisma.worker.count({ where: { id: { in: s.workerIds } } }) : Promise.resolve(0),
      s.assignmentIds.length ? prisma.siteAssignment.count({ where: { id: { in: s.assignmentIds } } }) : Promise.resolve(0),
      s.assignmentIds.length || s.traineeIds.length || s.placementIds.length
        ? prisma.traineeSupervision.count({ where: supervisionWhere(s) }) : Promise.resolve(0),
      s.traineeIds.length || s.workerIds.length
        ? prisma.traineeEvaluation.count({ where: evaluationWhere(s) }) : Promise.resolve(0),
      s.agencyId || s.siteIds.length ? prisma.workerInvite.count({ where: inviteWhere(s) }) : Promise.resolve(0),
      apw ? prisma.apiCallLog.count({ where: apw }) : Promise.resolve(0),
      aw ? prisma.auditEvent.count({ where: aw }) : Promise.resolve(0),
      acw ? prisma.accessLog.count({ where: acw }) : Promise.resolve(0),
      prisma.pilotResource.count({ where: { pilotId: s.pilotId } }),
      prisma.pilot.count({ where: { id: s.pilotId } }),
    ]);

  return {
    Agency: agency, Site: site, Trainee: trainee, TraineePlacement: placement,
    Worker: worker, SiteAssignment: assignment,
    TraineeSupervision: supervision, TraineeEvaluation: evaluation, WorkerInvite: invite,
    ApiCallLog: apiCall, AuditEvent: audit, AccessLog: access,
    // 실패분이 남은 경우 재시도 목록이므로 0이 아닌 것이 정상이다.
    PilotResource: completed ? resource : 0,
    Pilot: completed ? pilot : 0,
  };
}
