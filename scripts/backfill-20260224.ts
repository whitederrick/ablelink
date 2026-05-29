/* scripts/backfill-20260224.ts
 * 목적:
 * 1) DailyAttendance.assignmentId backfill (멀티배정 대비)
 * 2) AdminUser.agencyId backfill (agencyName -> Agency.id)
 * 3) TraineePlacement.status 정규화 (문자열/레거시 값 -> enum)
 *
 * 실행:
 *   npx ts-node scripts/backfill-20260224.ts
 * 또는 package.json에:
 *   "backfill:20260224": "ts-node scripts/backfill-20260224.ts"
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BATCH = 500;

// 유틸: workDate(yyyy-mm-dd) -> DateTime range [00:00, nextDay)
function workDateToRange(workDate: string) {
  // workDate는 "YYYY-MM-DD" 기대
  const start = new Date(`${workDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

// assignment 선택 규칙(중요):
// - userId+siteId 일치
// - attendance.workDate가 assignment 기간(startDate~endDate)에 포함
// - 그 중 가장 "최근에 시작한(active)" assignment를 우선 선택
async function findBestAssignmentId(params: {
  userId: bigint;
  siteId: bigint;
  workDate: string;
}): Promise<bigint | null> {
  const { userId, siteId, workDate } = params;
  const { start, end } = workDateToRange(workDate);

  const candidates = await prisma.siteAssignment.findMany({
    where: {
      userId,
      siteId,
      // 날짜 포함 조건
      startDate: { lt: end },
      OR: [{ endDate: null }, { endDate: { gte: start } }],
      // 운영상 가능한 상태들
      status: { in: ["ACTIVE", "CONFIRMED", "ASSIGNED"] as any },
    },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    select: { id: true },
    take: 5,
  });

  return candidates[0]?.id ?? null;
}

async function backfillAdminUserAgencyId() {
  // NOTE: Admin 모델에 agencyId/agencyName이 제거됨 — 이 단계는 더이상 필요 없음
  console.log("1) Backfill AdminUser.agencyId — skipped (Admin 모델에 agencyId 없음)");
}

async function ensureLegacyAssignment(params: {
  userId: bigint;
  siteId: bigint;
  workDate: string;
}): Promise<bigint> {
  // "레거시/미상" 배정이 이미 있으면 재사용
  // 정책: agencyId null, attendanceMode NONE, serviceStep FIELD_TRAINING(기본), status ACTIVE
  // 기간은 workDate 하루로 생성(또는 endDate null로 둘 수도 있으나 여기선 최소 범위)
  const { userId, siteId, workDate } = params;
  const { start, end } = workDateToRange(workDate);

  // 같은 날의 legacy assignment가 있으면 재사용
  const existing = await prisma.siteAssignment.findFirst({
    where: {
      userId,
      siteId,
      agencyId: null,
      attendanceMode: "NONE" as any,
      serviceStep: "FIELD_TRAINING" as any,
      startDate: { lte: start },
      OR: [{ endDate: null }, { endDate: { gte: end } }],
      status: { in: ["ACTIVE", "CONFIRMED", "ASSIGNED"] as any },
    },
    select: { id: true },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
  });

  if (existing) return existing.id;

  const created = await prisma.siteAssignment.create({
    data: {
      userId,
      siteId,
      serviceStep: "FIELD_TRAINING" as any,
      attendanceMode: "NONE" as any,
      status: "ACTIVE" as any,
      startDate: start,
      endDate: end,
      // legacy 임을 기록하고 싶으면 statusReason에 남김(필드가 있으면)
      statusReason: `LEGACY_BACKFILL:${workDate}`,
      isMainCoach: true,
    },
    select: { id: true },
  });

  return created.id;
}

async function backfillDailyAttendanceAssignmentId() {
  console.log("2) Backfill DailyAttendance.assignmentId...");

  /**
   * ✅ 핵심 수정:
   * Prisma 타입이 assignmentId를 non-null로 인식하는 환경에서
   * `where: { assignmentId: null }` / `{ equals: null }` 필터가 TS 에러를 유발.
   *
   * 그래서 "assignment_id is null" 대상 조회는 Raw SQL로 수행한다.
   * 업데이트는 Prisma로 수행해도 됨.
   */

  let total = 0;
  let fixed = 0;
  let legacyCreatedOrReused = 0;

  while (true) {
    const rows: Array<{
      id: bigint;
      user_id: bigint;
      site_id: bigint;
      work_date: string;
    }> = await prisma.$queryRaw`
      select id, user_id, site_id, work_date
      from daily_attendances
      where assignment_id is null
      order by id asc
      limit ${BATCH}
    `;

    if (rows.length === 0) break;

    total += rows.length;

    for (const r of rows) {
      let assignmentId = await findBestAssignmentId({
        userId: r.user_id,
        siteId: r.site_id,
        workDate: r.work_date,
      });

      if (!assignmentId) {
        assignmentId = await ensureLegacyAssignment({
          userId: r.user_id,
          siteId: r.site_id,
          workDate: r.work_date,
        });
        legacyCreatedOrReused++;
      }

      await prisma.dailyAttendance.update({
        where: { id: r.id },
        data: { assignmentId },
      });

      fixed++;
    }

    console.log(`  - processed batch: ${rows.length}, fixed so far: ${fixed}`);
  }

  console.log(
    `  - total processed: ${total}, fixed: ${fixed}, legacy assignments created/reused: ${legacyCreatedOrReused}`
  );
}

async function normalizeTraineePlacementStatus() {
  console.log("3) Normalize TraineePlacement.status ...");

  // 존재 가능한 레거시 값 맵핑
  const map: Record<string, string> = {
    ACTIVE: "ACTIVE",
    COMPLETED: "COMPLETED",
    DROPOUT: "DROPOUT",
    PAUSED: "PAUSED",
    // 레거시/오타 케이스
    DONE: "COMPLETED",
    END: "COMPLETED",
    ENDED: "COMPLETED",
    STOP: "PAUSED",
  };

  // NOTE:
  // - status 컬럼이 TEXT일 때만 이 로직이 의미가 있음.
  // - 이미 enum으로 바뀌었다면 "잘못된 값" 자체가 존재할 수 없으므로 사실상 no-op.
  // - 하지만 DISTINCT는 enum이어도 동작하므로, 값이 바뀔 게 없으면 update 0으로 끝남.

  const distinct: Array<{ status: string | null }> = await prisma.$queryRaw`
    SELECT DISTINCT status
    FROM trainee_placements
  `;

  const statuses = distinct
    .map((d) => d.status)
    .filter((s): s is string => !!s);

  let updates = 0;

  for (const s of statuses) {
    const target = map[s] ?? "ACTIVE"; // 모르는 값은 ACTIVE로(정책에 따라 변경 가능)
    if (target === s) continue;

    // ✅ unsafe 제거: 파라미터 바인딩 사용
    await prisma.$executeRaw`
      UPDATE trainee_placements
      SET status = ${target}
      WHERE status = ${s}
    `;
    updates++;
  }

  console.log(`  - normalized distinct statuses. updated groups: ${updates}`);
}

async function main() {
  console.log("=== Backfill Start ===");

  await backfillAdminUserAgencyId();
  await backfillDailyAttendanceAssignmentId();
  await normalizeTraineePlacementStatus();

  console.log("=== Backfill Done ===");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });