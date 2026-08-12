// lib/pilot/resources.ts
// 운영자의 파일럿 사업체·훈련생 생성 — v1.8 §2.1·§12 4단계(4-A 서버).
//
// ★훈련생 생성은 새 API 표면이다. 기존 `admin/trainees`는 requireManagerSession 전용이고
//  운영자용 경로가 리포에 없다(파일럿에는 위탁기관 담당자 계정이 없어 그 경로를 못 쓴다).
//  따라서 스코핑을 여기서 새로 정의한다 — 회차가 지정한 실재 위탁기관 소속 현장에만 만든다.
//
// ★회차가 새로 만든 자원은 `createdByPilotSessionId`로 출처를 남긴다. 참여(pilotSessionId)와
//  의미가 다르다 — 폐기 시 "이 회차가 만든 것"만 지우고 재사용한 기존 자원은 보존하기 위한 근거다.

import { prisma } from "@/lib/prisma";
import { acquirePilotSessionLock } from "@/lib/assignmentLock";
import { openTraineePlacement } from "@/lib/traineePlacement";

export type PilotResourceFailure =
  | "SESSION_NOT_FOUND"
  | "SESSION_LOCKED"
  | "SITE_NOT_IN_SESSION"
  | "INVALID_INPUT";

export type PilotResourceResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: PilotResourceFailure; message: string; status: number };

class ResourceAbort extends Error {
  constructor(readonly status: number, readonly reason: PilotResourceFailure, readonly detail: string) {
    super(reason);
  }
}
function fail(status: number, reason: PilotResourceFailure, detail: string): never {
  throw new ResourceAbort(status, reason, detail);
}
async function run<T>(fn: () => Promise<T>): Promise<PilotResourceResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof ResourceAbort) return { ok: false, code: e.reason, message: e.detail, status: e.status };
    throw e;
  }
}

/** 셋업 가능한 회차인지 확인하고 기관 id를 돌려준다. */
async function requireSetupSession(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  pilotSessionId: bigint,
): Promise<bigint> {
  const session = await tx.pilotSession.findUnique({
    where: { id: pilotSessionId },
    select: { status: true, agencyId: true },
  });
  if (!session) fail(404, "SESSION_NOT_FOUND", "파일럿 회차를 찾을 수 없습니다.");
  if (session.status !== "DRAFT" && session.status !== "READY") {
    fail(409, "SESSION_LOCKED", "이 회차는 설정을 추가할 수 있는 상태가 아닙니다.");
  }
  return session.agencyId;
}

export interface CreatePilotSiteInput {
  pilotSessionId: bigint;
  companyName: string;
  address: string;
  detailAddress?: string | null;
  gpsLat: number;
  gpsLon: number;
  businessContactName?: string | null;
  businessContactPhone?: string | null;
  businessContactEmail?: string | null;
}

/** 파일럿 사업체를 만든다. 회차 기관에 귀속되고 출처가 기록된다. */
export async function createPilotSite(input: CreatePilotSiteInput) {
  return run(async () =>
    prisma.$transaction(async (tx) => {
      await acquirePilotSessionLock(tx, input.pilotSessionId);
      const agencyId = await requireSetupSession(tx, input.pilotSessionId);

      if (input.companyName.trim().length < 2) {
        fail(400, "INVALID_INPUT", "사업체명을 2자 이상 입력해주세요.");
      }

      return tx.site.create({
        data: {
          companyName: input.companyName.trim(),
          address: input.address.trim(),
          detailAddress: input.detailAddress ?? null,
          gpsLat: input.gpsLat,
          gpsLon: input.gpsLon,
          agencyId,
          // 운영자가 파일럿용으로 만든 현장 — 정식 검증 대상이 아니다.
          isVerified: false,
          businessContactName: input.businessContactName ?? null,
          businessContactPhone: input.businessContactPhone ?? null,
          businessContactEmail: input.businessContactEmail ?? null,
          createdByPilotSessionId: input.pilotSessionId,
        },
        select: { id: true, companyName: true },
      });
    }),
  );
}

export interface CreatePilotTraineeInput {
  pilotSessionId: bigint;
  siteId: bigint;
  name: string;
  gender: string;
  disabilityType: string;
  severity: string;
  birthDate?: string | null;
  phoneNumber?: string | null;
  guardianPhoneNumber?: string | null;
  /** 재적 시작일. 기본은 회차 시작일. */
  placementStartDate?: Date;
}

/**
 * 파일럿 훈련생을 만들고 재적(TraineePlacement)까지 연다.
 *
 * ★재적을 함께 만드는 이유: 담당 관계(TraineeSupervision)가 재적을 필수로 요구하고,
 *  수락 시점 검증도 "배정 기간과 겹치는 재적"을 찾는다. 훈련생만 만들면 그 검증에서 막힌다.
 *  기존 운영도 훈련생 생성 시 배치 이력을 남기는 규율이다(lib/traineePlacement.ts).
 */
export async function createPilotTrainee(input: CreatePilotTraineeInput) {
  return run(async () =>
    prisma.$transaction(async (tx) => {
      await acquirePilotSessionLock(tx, input.pilotSessionId);
      const agencyId = await requireSetupSession(tx, input.pilotSessionId);

      if (input.name.trim().length < 2) {
        fail(400, "INVALID_INPUT", "훈련생 이름을 2자 이상 입력해주세요.");
      }

      const site = await tx.site.findUnique({
        where: { id: input.siteId },
        select: { id: true, agencyId: true },
      });
      // ★크로스테넌트 차단 — 회차 기관 소속 현장에만 훈련생을 만든다.
      //  운영자는 전 기관을 볼 수 있으므로 이 검사가 없으면 남의 기관 현장에 훈련생이 생긴다.
      if (!site || site.agencyId !== agencyId) {
        fail(403, "SITE_NOT_IN_SESSION", "이 회차의 위탁기관 소속 사업체가 아닙니다.");
      }

      const session = await tx.pilotSession.findUniqueOrThrow({
        where: { id: input.pilotSessionId },
        select: { startDate: true },
      });

      const trainee = await tx.trainee.create({
        data: {
          name: input.name.trim(),
          gender: input.gender,
          disabilityType: input.disabilityType,
          severity: input.severity,
          birthDate: input.birthDate ?? null,
          phoneNumber: input.phoneNumber ?? null,
          guardianPhoneNumber: input.guardianPhoneNumber ?? null,
          currentSiteId: input.siteId,
          createdByPilotSessionId: input.pilotSessionId,
        },
        select: { id: true, name: true },
      });

      // 재적 이력 — 기존 운영과 같은 헬퍼를 쓴다(단일 소스).
      await openTraineePlacement(tx, trainee.id, input.siteId, input.placementStartDate ?? session.startDate);
      // 파일럿 재적임을 표시(폐기·격리 판정용).
      await tx.traineePlacement.updateMany({
        where: { traineeId: trainee.id, siteId: input.siteId, endDate: null },
        data: { pilotSessionId: input.pilotSessionId },
      });

      return trainee;
    }),
  );
}
