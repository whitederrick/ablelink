// 로컬 검증: pdfkit 렌더러로 5종 PDF 생성 (브라우저 없이). 실행: npx tsx scripts/verify-pdf.mts
import { writeFileSync, mkdirSync } from "node:fs";
import { renderPdfKit } from "../lib/pdf/pdfkitRenderer";

const OUT = "scripts/_pdfout";
mkdirSync(OUT, { recursive: true });

const sig = { govAgent: { name: "김담당" }, companyManager: { name: "이사업" }, worker: { name: "홍길동" }, agencyAgent: { name: "박기관" } };

const cases: [any, string, any][] = [
  ["ATTENDANCE_SHEET", "attendance", {
    workerName: "홍길동", workerPhone: "010-1234-5678", companyName: "행복제과", periodStartYMD: "2026.06.01", periodEndYMD: "2026.06.30",
    totalDays: 3, totalHours: 24, weeklyHolidayCount: 1, monthlyLeaveCount: 0, allowanceTotalWon: "0", oneToOneHours: 24, oneToManyHours: 0, otOneToOneHours: 0, otOneToManyHours: 0,
    entries: [
      { date: "6/2", start: "09:00", end: "18:00", hours: 8, multiHours: 0 },
      { date: "6/3", start: "09:00", end: "18:00", hours: 8, multiHours: 0 },
      { date: "6/4", start: "09:00", end: "18:00", hours: 8, multiHours: 2 },
    ], signatures: sig,
  }],
  ["TRAINING_DAILY_LOG", "training-log", {
    traineeName: "김훈련", companyName: "행복제과", periodPreText: "2026.05.30 ~ 2026.05.30", periodFieldText: "2026.06.01 ~ 2026.06.30",
    rows: [
      { section: "PRE", date: "2026-05-30", attendanceStatus: "출석", trainingTime: "8H", guidanceFlag: "Y", task: "포장 작업", taskLevelMeasured: "잘함", evalGuidance: "집중도가 좋아짐. 반복 지도 필요." },
      { section: "FIELD", date: "2026-06-02", attendanceStatus: "출석", trainingTime: "8H", guidanceFlag: "Y", task: "라벨 부착", taskLevelMeasured: "보통", evalGuidance: "속도 향상 지도." },
    ], signatures: sig,
  }],
  ["ADAPTATION_DAILY_LOG", "adaptation-log", {
    traineeName: "박적응", companyName: "튼튼물류", periodStart: "2026.06.01", periodEnd: "2026.06.15",
    entries: [
      { dateMD: "06/02", attendance: "출석", workTime: "09:00~18:00", guidance: "Y", task: "분류 작업", performanceLabel: "잘함", performanceTime: "8", coaching: "안정적으로 수행." },
    ], issues: "특이사항 없음", signatures: sig,
  }],
  ["TRAINEE_FINAL_EVAL", "trainee-eval", {
    traineeName: "김훈련", companyName: "행복제과", preTrainingStart: "2026-05-30", preTrainingEnd: "2026-05-30", fieldTrainingStart: "2026-06-01", fieldTrainingEnd: "2026-06-30",
    scores: { WORK_ATTITUDE: [{ initial: 3, final: 4 }, { initial: 3, final: 4 }, { initial: 4, final: 5 }, { initial: 3, final: 4 }, { initial: 4, final: 4 }] },
    comments: { WORK_ATTITUDE: "전반적으로 향상됨." }, signatures: sig,
  }],
  ["ADAPTATION_FINAL_EVAL", "adaptation-eval", {
    traineeName: "박적응", companyName: "튼튼물류", periodStart: "2026-06-01", periodEnd: "2026-06-15",
    scores: { INTERPERSONAL: [{ initial: 3, final: 4 }] }, comments: { INTERPERSONAL: "대인관계 개선." }, signatures: sig,
  }],
];

let ok = 0;
for (const [type, name, payload] of cases) {
  try {
    const buf = await renderPdfKit(type, payload);
    const isPdf = buf.slice(0, 5).toString() === "%PDF-";
    writeFileSync(`${OUT}/${name}.pdf`, buf);
    console.log(`  ${isPdf && buf.length > 800 ? "✅" : "❌"} ${type}: ${buf.length} bytes, %PDF=${isPdf}`);
    if (isPdf && buf.length > 800) ok++;
  } catch (e: any) {
    console.log(`  ❌ ${type}: ${e?.message}`);
    console.error(e);
  }
}
console.log(`\n=== ${ok}/${cases.length} PDF 생성 성공 (${OUT}/) ===`);
process.exit(ok === cases.length ? 0 : 1);
