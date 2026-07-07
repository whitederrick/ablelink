// scripts/seed-doc-verify.mts
// 문서 5종 시각검증용 데이터 시드(비파괴 — 대상 배정/기간에 한해 재생성).
//  대상 워커 2명에게: 출근기록(고정시각·확정) + 일지(FIELD/ADAPTATION) + 확정 평가(TRAINING/ADAPTATION).
//  → 출근부·훈련일지·적응일지·훈련생종합평가·적응지도종합평가 5종 전부 실내용으로 렌더 가능.
//  실행: npx tsx --env-file=C:/myProjects/ablelink/.env scripts/seed-doc-verify.mts
import { prisma } from "../lib/prisma";
import { computeWorkTimes, kstWallTimeToInstant } from "../lib/workSchedule";
import { assertWritableDb } from "./_dbGuard";

// 대상 배정: 강도윤(1:1, placement1) · 서아린(1:多, placement2). loginId로 최신 배정 선택.
const TARGET_LOGINIDS = ["01070000000", "01070000001"];

// 시드 기간: 6월 평일 전체(22일) — 일지가 다음 페이지로 넘어가는지 확인용(다행수). 주말·6/6 현충일 제외.
//  로그 타입(사전/현장/적응)은 각 워커의 serviceStep으로 결정: 강도윤=지원고용훈련(PRE+FIELD)·서아린=적응지도(ADAPTATION).
const ALL_DAYS = [
  "2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05",
  "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12",
  "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19",
  "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26",
  "2026-06-29", "2026-06-30",
];
const PERIOD_START = ALL_DAYS[0], PERIOD_END = ALL_DAYS[ALL_DAYS.length - 1];

// 날짜별로 순환시킬 현실적 상세 내용 풀 — 과제/지도사항/수행정도가 매일 달라지도록.
const TASK_POOL = [
  "매장 상품 진열 및 정리",
  "재고 확인 및 검수 보조",
  "고객 응대 및 매장 안내",
  "계산대 보조 및 포인트 적립 안내",
  "매장 청소 및 위생 관리",
  "상품 포장 및 라벨 부착",
  "택배 물품 분류 및 정리",
  "음료·간식 진열 및 유통기한 확인",
  "테이블 정리 및 좌석 세팅",
  "비품 정리 및 발주 목록 작성 보조",
];
const COACHING_POOL = [
  "작업 순서를 단계별로 안내하고 직접 시범을 보인 뒤 반복 연습하도록 지도함. 손에 익도록 격려하니 자신감을 보임.",
  "고객 응대 시 인사말과 표정을 함께 연습함. 처음보다 목소리가 밝아지고 응대 태도가 안정됨.",
  "재고 수량을 세는 방법을 카드로 설명함. 숫자 세기를 정확히 수행하여 즉시 칭찬함.",
  "계산대 순서를 천천히 반복 지도함. 실수 시 당황하지 않도록 심호흡하는 방법을 함께 연습함.",
  "청소 도구 사용법과 안전 수칙을 지도함. 정해진 구역을 꼼꼼히 마무리하여 성취감을 느끼도록 도움.",
  "포장 규격을 샘플과 비교하며 지도함. 반복할수록 속도와 정확도가 눈에 띄게 향상됨.",
  "분류 기준을 색상 스티커로 구분해 지도함. 스스로 판단하여 분류하는 모습을 관찰함.",
  "위생 장갑 착용과 손 씻기 절차를 지도함. 위생 개념을 잘 이해하고 꾸준히 실천함.",
  "동료와 협업이 필요한 작업에서 역할을 나누어 지도함. 의사소통이 점차 원활해짐.",
  "마무리 점검 목록을 함께 확인하며 지도함. 빠뜨리는 항목 없이 스스로 점검하는 습관이 형성됨.",
];
// 수행정도(1~5)·출결을 날짜별로 변화 — 초반 낮고 후반 상승, 중간에 지각 1회.
const PERF_SEQ = [3, 3, 4, 4, 5, 3, 4, 4, 5, 5];
const ATT_SEQ  = ["출석", "출석", "지각", "출석", "출석", "출석", "출석", "출석", "출석", "출석"];

function evalScores() {
  const CATS = ["WORK_ATTITUDE", "INTERPERSONAL", "WORK_STYLE", "WORK_PERFORMANCE"];
  const scores: Record<string, Array<{ initial: number; final: number }>> = {};
  const comments: Record<string, string> = {
    WORK_ATTITUDE: "초기 지각이 있었으나 점차 개선되어 성실히 근무함.",
    INTERPERSONAL: "동료와의 소통이 원활하고 예의 바름.",
    WORK_STYLE: "지시사항을 잘 이해하고 꼼꼼히 수행함.",
    WORK_PERFORMANCE: "작업 속도·정확도 모두 향상됨.",
  };
  for (const c of CATS) scores[c] = Array.from({ length: 5 }, (_, i) => ({ initial: 2 + (i % 2), final: 4 + (i % 2) }));
  return { scores, comments };
}

async function main() {
  assertWritableDb("문서검증 시드(일지 삭제·배정 상태변경 포함)"); // 운영 DB 무프롬프트 실행 방지
  let totalAtt = 0, totalLog = 0, totalEval = 0;
  const recipe: string[] = [];

  for (const loginId of TARGET_LOGINIDS) {
    const worker = await prisma.worker.findFirst({ where: { loginId }, select: { id: true, workerName: true } });
    if (!worker) { console.log(`⚠️  워커 loginId=${loginId} 없음 — 건너뜀`); continue; }

    const asg = await prisma.siteAssignment.findFirst({
      where: { workerId: worker.id, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"] } },
      orderBy: { id: "asc" },
      select: { id: true, siteId: true, serviceStep: true, workType: true, commuteGuidanceIncluded: true, customWorkStart: true, customWorkEnd: true, stepStart: true,
        site: { select: { companyName: true } } },
    });
    if (!asg?.siteId) { console.log(`⚠️  ${worker.workerName} 배정 없음 — 건너뜀`); continue; }

    // 배정을 '열림(무기한)·ACTIVE'로 — 시드 기간이 지나도 '현재 배정'으로 잡혀 문서 페이지가 열리게(오늘 기간밖 배제 회피).
    await prisma.siteAssignment.update({ where: { id: asg.id }, data: { endDate: null, status: "ACTIVE" } });

    // 현장 재적 훈련생(placement 기반). 그 기간 재적인 훈련생만.
    const placements = await prisma.traineePlacement.findMany({
      where: { siteId: asg.siteId, startDate: { lte: new Date(PERIOD_END + "T23:59:59+09:00") },
        OR: [{ endDate: null }, { endDate: { gte: new Date(PERIOD_START + "T00:00:00+09:00") } }] },
      select: { traineeId: true, trainee: { select: { name: true } } },
    });
    const traineeIds = [...new Set(placements.map(p => p.traineeId))];
    if (traineeIds.length === 0) { console.log(`⚠️  ${worker.workerName} 현장 재적 훈련생 없음 — 건너뜀`); continue; }

    const wt = computeWorkTimes(asg.workType, asg.commuteGuidanceIncluded ?? true, asg.customWorkStart, asg.customWorkEnd);

    // ── 기존 시드분 정리(대상 배정·기간만) ──
    const oldAtt = await prisma.dailyAttendance.findMany({ where: { assignmentId: asg.id, workDate: { in: ALL_DAYS } }, select: { id: true } });
    const oldAttIds = oldAtt.map(a => a.id);
    if (oldAttIds.length) await prisma.traineeLog.deleteMany({ where: { attendanceId: { in: oldAttIds } } });
    await prisma.traineeEvaluation.deleteMany({ where: { writerId: worker.id, traineeId: { in: traineeIds }, periodStart: PERIOD_START } });

    // ── 출근기록(고정시각·확정) ──
    const dayToAtt = new Map<string, bigint>();
    for (const d of ALL_DAYS) {
      const start = kstWallTimeToInstant(d, wt.start);
      const end = kstWallTimeToInstant(d, wt.end);
      const att = await prisma.dailyAttendance.upsert({
        where: { assignmentId_workDate: { assignmentId: asg.id, workDate: d } },
        create: { workerId: worker.id, siteId: asg.siteId, assignmentId: asg.id, workDate: d,
          startTime: start, actualStartTime: start, endTime: end, actualEndTime: end,
          status: "DONE", isFinalClosed: true, withinRange: true, rangeM: 100 },
        update: { startTime: start, actualStartTime: start, endTime: end, actualEndTime: end, status: "DONE", isFinalClosed: true },
        select: { id: true },
      });
      dayToAtt.set(d, att.id);
      totalAtt++;
    }

    // ── 일지(각 훈련생 × 각 날짜) ── 날짜·훈련생별로 과제/지도사항/수행정도가 다르게(현실적 상세내용).
    for (let ti = 0; ti < traineeIds.length; ti++) {
      const tid = traineeIds[ti];
      for (let di = 0; di < ALL_DAYS.length; di++) {
        const d = ALL_DAYS[di];
        // 로그 타입 = 워커 서비스단계 기준: 적응지도 워커면 전부 ADAPTATION, 아니면 첫날 PRE + 나머지 FIELD.
        const trainingType = asg.serviceStep === "ADAPTATION" ? "ADAPTATION" : (di === 0 ? "PRE" : "FIELD");
        // 훈련생마다 시작 오프셋을 둬 같은 날 다른 과제/지도사항이 보이도록.
        const k = (di + ti * 3) % TASK_POOL.length;
        const log = await prisma.traineeLog.create({
          data: { attendanceId: dayToAtt.get(d)!, traineeId: tid, writerId: worker.id, trainingType,
            time1on1: 4, timeGroup: 0, content: COACHING_POOL[k],
            evaluation: ATT_SEQ[di % ATT_SEQ.length], isCompleted: true },
          select: { id: true },
        });
        await prisma.traineeLogTask.create({ data: { logId: log.id, taskName: TASK_POOL[k], performanceScore: PERF_SEQ[di % PERF_SEQ.length] } });
        totalLog++;
      }
    }

    // ── 확정 평가(TRAINING·ADAPTATION) × 각 훈련생 ──
    for (const tid of traineeIds) {
      for (const evalType of ["TRAINING", "ADAPTATION"]) {
        const { scores, comments } = evalScores();
        await prisma.traineeEvaluation.create({
          data: { traineeId: tid, writerId: worker.id, evalType, periodStart: PERIOD_START, periodEnd: PERIOD_END,
            scores, comments, isConfirmed: true, confirmedAt: new Date() },
        });
        totalEval++;
      }
    }

    const names = placements.map(p => p.trainee?.name).filter(Boolean).join(", ");
    const multi = traineeIds.length >= 2 ? "1:多" : "1:1";
    recipe.push(`· ${worker.workerName}(${loginId}) @${asg.site?.companyName} [${multi}] 훈련생: ${names}`);
  }

  console.log("=== 문서검증 시드 완료 ===");
  console.log(`출근 ${totalAtt} · 일지 ${totalLog} · 확정평가 ${totalEval}`);
  console.log(`\n[테스트 레시피]`);
  console.log(recipe.join("\n"));
  console.log(`\n기간 지정:`);
  console.log(`  · 전 문서 조회기간 → ${PERIOD_START} ~ ${PERIOD_END} (6월 평일 ${ALL_DAYS.length}일 · 일지 다행수로 페이지 넘어감)`);
  console.log(`  · 강도윤=지원고용훈련(훈련일지·종합평가) · 서아린=적응지도(적응일지·종합평가)`);
  console.log(`  · 1:多 표기 확인 = 서아린(01070000001), 1:1 = 강도윤(01070000000)`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
