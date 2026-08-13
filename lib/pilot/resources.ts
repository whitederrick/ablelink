// lib/pilot/resources.ts
// 파일럿 전용 자원 생성 — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §8
//
// ★파일럿은 실운영 전 소수 직무지도원 사용성 테스트다. Agency·Site·Trainee·재적·Worker·Assignment를
//  **전부 새로 만들고** 끝나면 전부 지운다. **실제 기관·기존 Worker·기존 Site·기존 Trainee는
//  재사용하지 않는다.** 재사용을 금지하면 급여·연차 오염과 "삭제할지 보존할지" 분류가 동시에 사라진다.
//
// ★모든 DB 자원 생성은 레지스트리 기록과 **같은 트랜잭션**이다(§7). 기록 없이 생성되면 영원히 못 지운다.
// ★기존 운영 화면·API를 재사용하거나 수정하지 않는다. 여기서 완결한다.

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { dbKey, recordDbResource } from "./registry";

/** 라우트가 상태코드로 그대로 옮길 수 있는 판별 오류. */
export class PilotError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "PilotError";
  }
}

/** 파일럿에서 허용하는 근무형태. ★`CUSTOM`은 제외한다 — 시각이 없으면 computeWorkTimes가
 *  에러 없이 조용히 09:00~18:00로 대체해(FALLBACK) 잘못된 출근부를 만들고도 신호가 없다. */
export const PILOT_WORK_TYPES = ["AM", "PM", "FULL_DAY"] as const;
export type PilotWorkType = (typeof PILOT_WORK_TYPES)[number];

const PHONE_RE = /^01[0-9]{8,9}$/;

function normPhone(v: unknown): string {
  return String(v ?? "").replace(/[^0-9]/g, "").trim();
}
function reqStr(v: unknown, label: string, min = 1): string {
  const s = String(v ?? "").trim();
  if (s.length < min) throw new PilotError(400, "INVALID_INPUT", `${label}을(를) 입력해 주세요.`);
  return s;
}
function reqDate(v: unknown, label: string): Date {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new PilotError(400, "INVALID_DATE", `${label}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  const d = new Date(`${s}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) throw new PilotError(400, "INVALID_DATE", `${label}이(가) 올바르지 않습니다.`);
  return d;
}

// ─────────────────────────────────────────────────────────────
// 파일럿 + 전용 Agency
// ─────────────────────────────────────────────────────────────

/**
 * 파일럿 1건과 그 **전용 Agency**를 만든다.
 *
 * ★기관 `planType`은 **STANDARD**다. 급여는 PRO 전용 기능이라 이 등급에서 막히고,
 *  문서·PDF·서명은 열린다. 급여 DRAFT cron이 이 기관을 건너뛴다.
 * ★위탁기관 Manager 계정·근로계약·급여기준·이메일 수신처는 만들지 않는다.
 */
export async function createPilot(input: { name: unknown; note?: unknown; agencyName: unknown }) {
  const name = reqStr(input.name, "파일럿 이름", 2);
  const agencyName = reqStr(input.agencyName, "기관명", 2);
  const note = String(input.note ?? "").trim() || null;

  const dup = await prisma.agency.findUnique({ where: { name: agencyName }, select: { id: true } });
  if (dup) throw new PilotError(409, "AGENCY_NAME_TAKEN", "같은 이름의 기관이 이미 있습니다. 다른 이름을 써 주세요.");

  return prisma.$transaction(async (tx) => {
    const pilot = await tx.pilot.create({ data: { name, note }, select: { id: true, name: true } });
    const agency = await tx.agency.create({
      data: { name: agencyName, planType: "STANDARD", isActive: true },
      select: { id: true, name: true },
    });
    await recordDbResource(tx, pilot.id, "AGENCY", agency.id);
    return { pilotId: pilot.id, pilotName: pilot.name, agencyId: agency.id, agencyName: agency.name };
  });
}

/** 파일럿의 전용 Agency id. 레지스트리가 유일한 근거다(이름·날짜 추정 금지). */
export async function getPilotAgencyId(pilotId: bigint): Promise<bigint> {
  const row = await prisma.pilotResource.findFirst({
    where: { pilotId, kind: "AGENCY" },
    select: { resourceKey: true },
    orderBy: { id: "asc" },
  });
  if (!row) throw new PilotError(404, "PILOT_NOT_FOUND", "파일럿 또는 전용 기관을 찾을 수 없습니다.");
  return BigInt(row.resourceKey);
}

/** 레지스트리에 등록된 자원인지 확인한다(교차 파일럿·비파일럿 자원 차단). */
async function assertOwned(pilotId: bigint, kind: "SITE" | "WORKER" | "TRAINEE", id: bigint) {
  const hit = await prisma.pilotResource.findUnique({
    where: { kind_resourceKey: { kind, resourceKey: dbKey(id) } },
    select: { pilotId: true },
  });
  if (!hit || hit.pilotId !== pilotId) {
    throw new PilotError(404, "NOT_PILOT_RESOURCE", "이 파일럿의 자원이 아닙니다.");
  }
}

// ─────────────────────────────────────────────────────────────
// 사업체(Site) + 사업체 담당자
// ─────────────────────────────────────────────────────────────

/**
 * 파일럿 전용 사업체를 만든다.
 *
 * ★`gpsLat`/`gpsLon`은 **필수(non-null)** 다. 주소 검색 결과가 이미 좌표를 갖고 있으므로
 *  화면은 선택 즉시 좌표를 채운다 — 지도 SDK가 실패해도 등록이 막히지 않아야 한다.
 * ★사업체 담당자의 단일 출처는 `Site.businessContact*`다. `SiteContact`는 만들지 않는다
 *  (문서 payload에 쓰이지 않는다).
 * ★이메일은 수집·저장하지 않는다 — 운영 환경은 외부 발송이 켜져 있어 수신처가 있으면
 *  오발송 경로가 된다.
 */
export async function createPilotSite(pilotId: bigint, input: {
  companyName: unknown; address: unknown; detailAddress?: unknown;
  gpsLat: unknown; gpsLon: unknown;
  businessContactName: unknown; businessContactPhone?: unknown;
}) {
  const agencyId = await getPilotAgencyId(pilotId);
  const companyName = reqStr(input.companyName, "사업체명", 2);
  const address = reqStr(input.address, "주소", 2);
  const detailAddress = String(input.detailAddress ?? "").trim() || null;
  const contactName = reqStr(input.businessContactName, "담당자 성명", 2);
  const contactPhoneRaw = normPhone(input.businessContactPhone);
  if (contactPhoneRaw && !PHONE_RE.test(contactPhoneRaw)) {
    throw new PilotError(400, "INVALID_PHONE", "담당자 연락처 형식이 올바르지 않습니다.");
  }

  const lat = Number(input.gpsLat), lon = Number(input.gpsLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) {
    throw new PilotError(400, "INVALID_COORD", "좌표가 필요합니다. 주소를 검색해 선택해 주세요.");
  }

  return prisma.$transaction(async (tx) => {
    const site = await tx.site.create({
      data: {
        agencyId, companyName, address, detailAddress,
        gpsLat: lat, gpsLon: lon,
        businessContactName: contactName,
        businessContactPhone: contactPhoneRaw || null,
        isVerified: false,
      },
      select: { id: true, companyName: true, address: true, gpsLat: true, gpsLon: true },
    });
    await recordDbResource(tx, pilotId, "SITE", site.id);
    return site;
  });
}

// ─────────────────────────────────────────────────────────────
// 훈련생 + 재적
// ─────────────────────────────────────────────────────────────

/**
 * 파일럿 전용 훈련생과 그 현장 재적을 **한 트랜잭션**에서 만든다.
 *
 * ★`Trainee`에는 `agencyId`가 없다 — Site 경유 재적으로만 기관에 연결된다.
 * ★★재적 인원이 서식을 바꾼다: 출근부 1:1 / 1:多는 "그 날짜에 그 현장에 재적한 훈련생 수"로
 *  날짜별 결정된다(2026-06-18 확정 규칙). 운영자가 몇 명을 재적시키느냐로 출력이 달라진다.
 */
export async function createPilotTrainee(pilotId: bigint, input: {
  siteId: unknown; name: unknown; gender: unknown;
  disabilityType: unknown; severity: unknown;
  startDate: unknown; endDate?: unknown;
}) {
  const siteId = BigInt(String(input.siteId ?? "0"));
  // ★BigInt 리터럴(0n)은 tsconfig target 때문에 tsc·next build 양쪽에서 막힌다 — BigInt(0)를 쓴다.
  if (siteId <= BigInt(0)) throw new PilotError(400, "INVALID_INPUT", "사업체를 선택해 주세요.");
  await assertOwned(pilotId, "SITE", siteId);

  const name = reqStr(input.name, "훈련생 성명", 2);
  const gender = reqStr(input.gender, "성별");
  const disabilityType = reqStr(input.disabilityType, "장애유형");
  const severity = reqStr(input.severity, "중증도");
  const startDate = reqDate(input.startDate, "재적 시작일");
  const endDate = input.endDate ? reqDate(input.endDate, "재적 종료일") : null;
  if (endDate && endDate < startDate) throw new PilotError(400, "INVALID_RANGE", "재적 종료일이 시작일보다 빠릅니다.");

  return prisma.$transaction(async (tx) => {
    const trainee = await tx.trainee.create({
      data: { name, gender, disabilityType, severity, currentSiteId: siteId },
      select: { id: true, name: true },
    });
    await recordDbResource(tx, pilotId, "TRAINEE", trainee.id);

    const placement = await tx.traineePlacement.create({
      data: { traineeId: trainee.id, siteId, startDate, endDate },
      select: { id: true, startDate: true, endDate: true },
    });
    await recordDbResource(tx, pilotId, "PLACEMENT", placement.id);

    return { trainee, placement };
  });
}

// ─────────────────────────────────────────────────────────────
// 직무지도원 계정
// ─────────────────────────────────────────────────────────────

/**
 * 파일럿 참여 직무지도원 계정을 만든다.
 *
 * ★기존 운영자 경로(`POST /api/admin/system/workers`)와 **같은 규칙**을 쓴다 — 새 규칙을 만들지 않는다.
 *  · `loginId` = 휴대전화번호(하이픈 제거)
 *  · 비밀번호는 bcrypt 해시만 저장. ★평문을 어떤 컬럼에도 남기지 않는다
 *  · `planType` = STANDARD (문서·PDF·서명 개방, 급여는 PRO라 여전히 차단)
 *
 * ★사전조건: 이미 가입된 번호면 409다. **기존 Worker를 재사용하거나 수정하지 않는다** —
 *  파일럿 종료 시 원래 등급 복원을 놓치면 실제 워커가 공짜 유료등급을 갖는다.
 *  그 참여자는 파일럿 대상에서 제외하거나 본인 소유의 다른 번호를 쓴다.
 *
 * @returns 초기 비밀번호를 **이 응답에서 단 한 번만** 돌려준다. 이후 조회 수단은 없다.
 */
export async function createPilotWorker(pilotId: bigint, input: {
  workerName: unknown; phoneNumber: unknown; password: unknown;
}) {
  await getPilotAgencyId(pilotId); // 파일럿 존재 확인

  // ★부분완료 상태에서는 계정을 만들지 않는다(§10-3-2).
  //  Storage 삭제가 실패하면 DB 자원은 이미 지워졌는데 Pilot·레지스트리는 남는다(재시도 목록).
  //  이때 Site·Trainee·Assignment 생성은 삭제된 agencyId/siteId를 참조해 FK 위반으로 알아서 실패하지만,
  //  **Worker는 기관 FK가 없어 그대로 성공**한다 — 재시도 목록과 실제가 다시 어긋나는 유일한 구멍이다.
  //  `deleteError`가 남아 있다는 사실 자체가 "재시도 대기"라는 파생 상태이므로
  //  새 필드·새 전이 없이 막을 수 있다(§7 "상태 머신 없음" 유지).
  const purgePending = await prisma.pilotResource.count({ where: { pilotId, deleteError: { not: null } } });
  if (purgePending > 0) {
    throw new PilotError(409, "PURGE_PENDING",
      "초기화가 완료되지 않은 파일럿입니다. 남은 삭제 실패분을 처리한 뒤 다시 시도해 주세요.");
  }

  const workerName = reqStr(input.workerName, "성명", 2);
  const phoneNumber = normPhone(input.phoneNumber);
  if (!PHONE_RE.test(phoneNumber)) throw new PilotError(400, "INVALID_PHONE", "올바른 휴대전화번호를 입력해 주세요.");
  const password = String(input.password ?? "");
  if (password.length < 8) throw new PilotError(400, "WEAK_PASSWORD", "임시 비밀번호는 8자 이상이어야 합니다.");

  const exists = await prisma.worker.findUnique({ where: { loginId: phoneNumber }, select: { id: true } });
  if (exists) {
    throw new PilotError(409, "PHONE_TAKEN",
      "이미 가입된 전화번호입니다. 기존 계정은 재사용하지 않습니다 — 이 참여자는 제외하거나 본인 소유의 다른 번호를 사용해 주세요.");
  }

  const hashed = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    const worker = await tx.worker.create({
      data: {
        loginId: phoneNumber, password: hashed, workerName, phoneNumber, planType: "STANDARD",
        // ★운영자가 부여한 임시 비밀번호 → 최초 로그인 시 온보딩(비밀번호 변경) 강제.
        //  기본값이 false라 생략하면 임시 비밀번호가 그대로 영구 비밀번호가 된다.
        //  로그인 토큰이 이 값을 클레임으로 싣고(worker/auth/login) 서버 컴포넌트가
        //  /worker/onboarding으로 보낸다 — 기존 운영자 발급 경로와 같은 규칙이다.
        isTemporary: true,
      },
      select: { id: true, workerName: true, loginId: true, isTemporary: true },
    });
    await recordDbResource(tx, pilotId, "WORKER", worker.id);
    return worker;
  });
}

/**
 * 전화번호 중복 **사전** 확인.
 *
 * ★계획서 §8-3: "화면은 등록 **전에** 중복을 조회해 알린다. 409를 만나고 나서 알려주는 방식은 안 된다."
 * ★존재 여부만 돌려준다 — 기존 계정의 성명·소속 등 어떤 정보도 노출하지 않는다.
 */
export async function checkPilotWorkerPhone(phoneNumber: unknown): Promise<{ available: boolean; phone: string }> {
  const phone = normPhone(phoneNumber);
  if (!PHONE_RE.test(phone)) throw new PilotError(400, "INVALID_PHONE", "올바른 휴대전화번호를 입력해 주세요.");
  const exists = await prisma.worker.findUnique({ where: { loginId: phone }, select: { id: true } });
  return { available: !exists, phone };
}

// ─────────────────────────────────────────────────────────────
// 배정
// ─────────────────────────────────────────────────────────────

/**
 * 파일럿 배정을 만든다.
 *
 * ★`attendanceButtonExempt: true` — 출퇴근 버튼·GPS·실제 타각 없이 기존 '일괄 작성'으로
 *  표준 근무시각 출근부 행을 만든다.
 * ★근무형태는 AM/PM/FULL_DAY만 받는다. 시각은 `computeWorkTimes()`가 단독 결정하는
 *  **사용자 확정 절대불변 규칙**이라 여기서 직접 입력받거나 재계산하지 않는다.
 */
export async function createPilotAssignment(pilotId: bigint, input: {
  workerId: unknown; siteId: unknown; workType: unknown;
  startDate: unknown; endDate: unknown; commuteGuidanceIncluded?: unknown;
}) {
  const agencyId = await getPilotAgencyId(pilotId);
  const workerId = BigInt(String(input.workerId ?? "0"));
  const siteId = BigInt(String(input.siteId ?? "0"));
  if (workerId <= BigInt(0) || siteId <= BigInt(0)) throw new PilotError(400, "INVALID_INPUT", "직무지도원과 사업체를 선택해 주세요.");
  await assertOwned(pilotId, "WORKER", workerId);
  await assertOwned(pilotId, "SITE", siteId);

  const workType = String(input.workType ?? "");
  if (!(PILOT_WORK_TYPES as readonly string[]).includes(workType)) {
    throw new PilotError(400, "INVALID_WORK_TYPE", "근무형태는 오전 4시간 · 오후 4시간 · 전일 8시간 중 하나여야 합니다.");
  }
  const startDate = reqDate(input.startDate, "배정 시작일");
  const endDate = reqDate(input.endDate, "배정 종료일");
  if (endDate < startDate) throw new PilotError(400, "INVALID_RANGE", "배정 종료일이 시작일보다 빠릅니다.");

  // FULL_DAY는 출퇴근지도를 강제로 포함하지 않는다(8시간 초과 금지) — computeWorkTimes가 무시하지만
  //  저장값도 규칙과 어긋나지 않게 맞춘다.
  const commute = workType === "FULL_DAY" ? false : input.commuteGuidanceIncluded !== false;

  return prisma.$transaction(async (tx) => {
    const asg = await tx.siteAssignment.create({
      data: {
        workerId, siteId, agencyId,
        status: "ACTIVE",
        startDate, endDate,
        workType,
        commuteGuidanceIncluded: commute,
        attendanceButtonExempt: true,
      },
      select: { id: true, workType: true, startDate: true, endDate: true },
    });
    await recordDbResource(tx, pilotId, "ASSIGNMENT", asg.id);
    return asg;
  });
}

// ─────────────────────────────────────────────────────────────
// 조회
// ─────────────────────────────────────────────────────────────

/** 파일럿 목록 — 라벨과 자원 요약만. */
export async function listPilots() {
  const pilots = await prisma.pilot.findMany({
    orderBy: { id: "desc" },
    select: { id: true, name: true, note: true, createdAt: true, _count: { select: { resources: true } } },
  });
  return pilots.map((p) => ({
    id: p.id.toString(),
    name: p.name,
    note: p.note,
    createdAt: p.createdAt,
    resourceCount: p._count.resources,
  }));
}

/**
 * 파일럿 상세 — 레지스트리에 기록된 자원만 되짚어 읽는다.
 *
 * ★목록을 "기관 소속 전체"로 뽑지 않고 **레지스트리 id로** 조회한다.
 *  레지스트리가 삭제의 유일한 근거이므로, 화면이 보여주는 것과 지워질 것이 같아야 한다.
 *  기록이 누락된 자원은 화면에도 안 보여서 즉시 드러난다.
 */
export async function getPilotDetail(pilotId: bigint) {
  const pilot = await prisma.pilot.findUnique({
    where: { id: pilotId },
    select: { id: true, name: true, note: true, createdAt: true },
  });
  if (!pilot) throw new PilotError(404, "PILOT_NOT_FOUND", "파일럿을 찾을 수 없습니다.");

  const res = await prisma.pilotResource.findMany({
    where: { pilotId },
    select: { kind: true, resourceKey: true, deleteError: true },
    orderBy: { id: "asc" },
  });
  const idsOf = (k: string) => res.filter((r) => r.kind === k).map((r) => BigInt(r.resourceKey));

  const [agency] = await Promise.all([
    idsOf("AGENCY")[0]
      ? prisma.agency.findUnique({ where: { id: idsOf("AGENCY")[0] }, select: { id: true, name: true, planType: true } })
      : Promise.resolve(null),
  ]);

  const [sites, trainees, placements, workers, assignments] = await Promise.all([
    prisma.site.findMany({
      where: { id: { in: idsOf("SITE") } },
      select: { id: true, companyName: true, address: true, detailAddress: true, gpsLat: true, gpsLon: true, businessContactName: true, businessContactPhone: true },
      orderBy: { id: "asc" },
    }),
    prisma.trainee.findMany({
      where: { id: { in: idsOf("TRAINEE") } },
      select: { id: true, name: true, gender: true, disabilityType: true, severity: true, currentSiteId: true },
      orderBy: { id: "asc" },
    }),
    prisma.traineePlacement.findMany({
      where: { id: { in: idsOf("PLACEMENT") } },
      select: { id: true, traineeId: true, siteId: true, startDate: true, endDate: true },
      orderBy: { id: "asc" },
    }),
    prisma.worker.findMany({
      where: { id: { in: idsOf("WORKER") } },
      select: { id: true, workerName: true, loginId: true, planType: true, status: true },
      orderBy: { id: "asc" },
    }),
    prisma.siteAssignment.findMany({
      where: { id: { in: idsOf("ASSIGNMENT") } },
      select: { id: true, workerId: true, siteId: true, workType: true, startDate: true, endDate: true, attendanceButtonExempt: true, commuteGuidanceIncluded: true },
      orderBy: { id: "asc" },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const r of res) counts[r.kind] = (counts[r.kind] ?? 0) + 1;

  return {
    pilot: { id: pilot.id.toString(), name: pilot.name, note: pilot.note, createdAt: pilot.createdAt },
    agency: agency ? { id: agency.id.toString(), name: agency.name, planType: agency.planType } : null,
    sites: sites.map((s) => ({ ...s, id: s.id.toString(), gpsLat: String(s.gpsLat), gpsLon: String(s.gpsLon) })),
    trainees: trainees.map((t) => ({ ...t, id: t.id.toString(), currentSiteId: t.currentSiteId?.toString() ?? null })),
    placements: placements.map((p) => ({ ...p, id: p.id.toString(), traineeId: p.traineeId.toString(), siteId: p.siteId.toString() })),
    workers: workers.map((w) => ({ ...w, id: w.id.toString() })),
    assignments: assignments.map((a) => ({ ...a, id: a.id.toString(), workerId: a.workerId.toString(), siteId: a.siteId.toString() })),
    registry: { counts, deleteErrors: res.filter((r) => r.deleteError).length },
  };
}
