// 로컬 검증: pdfkit 렌더러로 5종 PDF 생성 (브라우저 없이). 실행: npx tsx scripts/verify-pdf.mts
import { writeFileSync, mkdirSync } from "node:fs";
import { renderPdfKit } from "../lib/pdf/pdfkitRenderer";

const OUT = "scripts/_pdfout";
mkdirSync(OUT, { recursive: true });

const sig = { govAgent: { name: "김담당" }, companyManager: { name: "이사업" }, worker: { name: "홍길동" }, agencyAgent: { name: "박기관" } };

const cases: [any, string, any][] = [
  ["ATTENDANCE_SHEET", "attendance", {
    workerName: "홍길동", workerPhone: "010-1234-5678", companyName: "서울시청", periodStartYMD: "2026.01.05", periodEndYMD: "2026.01.23",
    totalDays: 15, totalHours: 60, weeklyHolidayCount: 0, monthlyLeaveCount: 0, allowanceTotalWon: "0", oneToOneHours: 52, oneToManyHours: 8, otOneToOneHours: 0, otOneToManyHours: 0,
    entries: [
      { date: "2026-01-05", start: "09:00", end: "13:00", hours: 4, multiHours: 0 },
      { date: "2026-01-06", start: "09:00", end: "12:00", hours: 3, multiHours: 1 },
      { date: "2026-01-07", start: "09:00", end: "12:00", hours: 3, multiHours: 1 },
      { date: "2026-01-08", start: "10:00", end: "12:00", hours: 2, multiHours: 0 },
      { date: "2026-01-09", start: "09:30", end: "12:30", hours: 3, multiHours: 0 },
      { date: "2026-01-12", start: "09:00", end: "13:00", hours: 4, multiHours: 0 },
      { date: "2026-01-13", start: "09:00", end: "12:00", hours: 3, multiHours: 0 },
      { date: "2026-01-14", start: "13:00", end: "17:00", hours: 4, multiHours: 2 },
      { date: "2026-01-15", start: "09:00", end: "11:00", hours: 2, multiHours: 0 },
      { date: "2026-01-16", start: "09:00", end: "12:00", hours: 3, multiHours: 1 },
    ], signatures: sig,
  }],
  ["TRAINING_DAILY_LOG", "training-log", {
    traineeName: "김훈련", companyName: "행복제과", periodPreText: "2026.06.01 ~ 2026.06.02", periodFieldText: "2026.06.03 ~ 2026.06.12",
    holidays: ["2026-06-04"],
    rows: [
      { date: "2026-06-01", attendanceStatus: "출석", trainingTime: "2H", guidanceFlag: "Y", task: "오리엔테이션", taskLevelMeasured: "양호", evalGuidance: "기본 안내" },
      { date: "2026-06-03", attendanceStatus: "출석", trainingTime: "8H", guidanceFlag: "Y", task: "포장 작업", taskLevelMeasured: "잘함", evalGuidance: "집중도가 좋아짐. 반복 지도 필요." },
      { date: "2026-06-05", attendanceStatus: "출석", trainingTime: "8H", guidanceFlag: "Y", task: "라벨 부착", taskLevelMeasured: "보통", evalGuidance: "속도 향상 지도." },
    ], signatures: sig,
  }],
  ["ADAPTATION_DAILY_LOG", "adaptation-log", {
    traineeName: "박적응", companyName: "튼튼물류", periodStart: "2026-06-01", periodEnd: "2026-06-15",
    holidays: ["2026-06-04"],
    entries: [
      { dateISO: "2026-06-01", attendance: "출석", workTime: "09:00~13:00", guidance: "Y", task: "오리엔테이션", performanceLabel: "양호", performanceTime: "120분", coaching: "기본 안내" },
      { dateISO: "2026-06-02", attendance: "출석", workTime: "09:00~13:00", guidance: "Y", task: "분류 작업", performanceLabel: "잘함", performanceTime: "120분", coaching: "자율 수행을 기본으로 지켜보았습니다. 다만, 일부 힘든 일이 발생 시 제대로 대응하지 못하는 경우가 발생하여 별도 지도하였습니다." },
      { dateISO: "2026-06-03", attendance: "출석", workTime: "09:00~13:00", guidance: "Y", task: "단순 업무", performanceLabel: "양호", performanceTime: "60분", coaching: "자율 수행" },
    ],
    issues: "업무 적응은 전반적으로 양호하지만 업무 부담 가중 및 힘든 업무가 지속될 경우, 해당 불만과 어려움을 표현하지 못하고 있습니다. 지속적인 지도와 사업체 담당자와의 협의를 통해 업무 부담 완화 등을 지속 협의하였습니다. 출퇴근 지도 및 휴게시간 지도는 지속 필요합니다.",
    signatures: sig,
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
