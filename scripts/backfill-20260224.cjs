/* scripts/backfill-20260224.cjs
 * 목적:
 * 1) DailyAttendance.assignmentId backfill
 * 2) AdminUser.agencyId backfill (agencyName -> Agency.id)
 * 3) TraineePlacement.status normalize (legacy string -> normalized)
 *
 * 실행:
 *   node scripts/backfill-20260224.cjs
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const BATCH = 500;

// workDate(yyyy-mm-dd) -> DateTime range [00:00, nextDay)
function workDateToRange(workDate) {
  const start = new Date(`${workDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

// assignment 선택 규칙:
// - userId+siteId 일치
// - attendance.workDate가 assignment 기간(startDate~endDate)에 포함
// - 그 중 가장 최근 startDate(내림차순) 우선
async function findBestAssignmentId({ userId, siteId, workDate }) {
  const { start, end } = workDateToRange(workDate);

  const candidates = await prisma.siteAssignment.findMany({
    where: {
      userId,
      siteId,
      startDate: { lt: end },
      OR: [{ endDate: null }, { endDate: { gte: start } }],
      status: { in: ["ACTIVE", "CONFIRMED", "ASSIGNED"] },
    },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    select: { id: true },
    take: 5,
  });

  return candidates[0]?.id ?? null;
}

async function backfillAdminUserAgencyId() {
  console.log("1) Backfill AdminUser.agencyId from agencyName...");

  // ⚠️ 테이블명이 실제로는 "AdminUser" (대문자/따옴표 필요)
  // agency_id가 null이고 agencyName이 있는 행만 대상
  const admins = await prisma.$queryRaw`
    select id, "agencyName" as "agencyName"
    from "AdminUser"
    where agency_id is null
      and "agencyName" is not null
  `;

  if (!admins || admins.length === 0) {
    console.log("  - no admin rows to backfill");
    return;
  }

  const names = Array.from(
    new Set(admins.map((a) => a.agencyName).filter(Boolean))
  );

  const agencies = await prisma.agency.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true },
  });

  const map = new Map(agencies.map((a) => [a.name, a.id]));

  let ok = 0;
  let miss = 0;

  for (const a of admins) {
    const agencyId = map.get(a.agencyName);
    if (!agencyId) {
      miss++;
      continue;
    }

    await prisma.$executeRaw`
      update "AdminUser"
      set agency_id = ${agencyId}
      where id = ${a.id}
    `;
    ok++;
  }

  console.log(`  - updated: ${ok}, missing agency match: ${miss}`);
}

async function ensureLegacyAssignment({ userId, siteId, workDate }) {
  const { start, end } = workDateToRange(workDate);

  const existing = await prisma.siteAssignment.findFirst({
    where: {
      userId,
      siteId,
      agencyId: null,
      attendanceMode: "NONE",
      serviceStep: "FIELD_TRAINING",
      startDate: { lte: start },
      OR: [{ endDate: null }, { endDate: { gte: end } }],
      status: { in: ["ACTIVE", "CONFIRMED", "ASSIGNED"] },
    },
    select: { id: true },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
  });

  if (existing) return existing.id;

  const created = await prisma.siteAssignment.create({
    data: {
      userId,
      siteId,
      serviceStep: "FIELD_TRAINING",
      attendanceMode: "NONE",
      status: "ACTIVE",
      startDate: start,
      endDate: end,
      statusReason: `LEGACY_BACKFILL:${workDate}`,
      isMainCoach: true,
    },
    select: { id: true },
  });

  return created.id;
}

async function backfillDailyAttendanceAssignmentId() {
  console.log("2) Backfill DailyAttendance.assignmentId...");

  let total = 0;
  let fixed = 0;
  let legacyCreatedOrReused = 0;

  while (true) {
    // assignment_id is null 대상은 raw SQL로만 안전하게 뽑는다
    const rows = await prisma.$queryRaw`
      select id, user_id, site_id, work_date
      from daily_attendances
      where assignment_id is null
      order by id asc
      limit ${BATCH}
    `;

    if (!rows || rows.length === 0) break;

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

  const map = {
    ACTIVE: "ACTIVE",
    COMPLETED: "COMPLETED",
    DROPOUT: "DROPOUT",
    PAUSED: "PAUSED",
    DONE: "COMPLETED",
    END: "COMPLETED",
    ENDED: "COMPLETED",
    STOP: "PAUSED",
  };

  const distinct = await prisma.$queryRaw`
    select distinct status
    from trainee_placements
  `;

  const statuses = (distinct || [])
    .map((d) => d.status)
    .filter((s) => typeof s === "string" && s.length > 0);

  let updates = 0;

  for (const s of statuses) {
    const target = map[s] ?? "ACTIVE";
    if (target === s) continue;

    await prisma.$executeRaw`
      update trainee_placements
      set status = ${target}
      where status = ${s}
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
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });