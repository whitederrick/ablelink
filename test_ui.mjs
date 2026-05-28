import { chromium } from "./node_modules/playwright/index.mjs";

const BASE = "http://localhost:3000";
const LOGIN_ID = "worker01";
const LOGIN_PW = "worker1234!";

async function shot(page, name) {
  const p = "C:/tmp/ss_" + name + ".png";
  await page.screenshot({ path: p, fullPage: false });
  console.log("  screenshot: " + p);
}

async function chk(page, label, selector, shouldExist) {
  const n = await page.locator(selector).count();
  const ok = shouldExist ? n > 0 : n === 0;
  console.log("  " + (ok ? "OK" : "FAIL") + " " + label + (ok ? "" : " (got " + n + ")"));
  return ok;
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-gpu","--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  console.log("\n[1] 로그인");
  await page.goto(BASE + "/worker/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.locator("input").nth(0).fill(LOGIN_ID);
  await page.locator("input[type=password]").fill(LOGIN_PW);
  await shot(page, "01_login");
  await page.locator("button").filter({ hasText: /로그인/ }).first().click();
  await page.waitForLoadState("networkidle");
  const homeUrl = page.url();
  console.log("  URL:", homeUrl);
  if (homeUrl.includes("login")) {
    await shot(page, "01_fail");
    const err = await page.locator("text=/오류|실패|잘못/").first().textContent().catch(() => "");
    console.log("  FAIL 로그인 실패 / 에러:", err);
    await browser.close(); return;
  }
  console.log("  OK 로그인 성공");
  await shot(page, "02_home");

  console.log("\n[2] 홈 화면");
  await chk(page, "서비스 단계 표시", "text=현재 서비스 단계", true);
  await chk(page, "종합평가 버튼", "text=종합평가", true);
  await chk(page, "일지 목록 링크", "text=일지 목록", true);
  await chk(page, "일지 작성 버튼", "text=일지 작성", true);

  console.log("\n[3] 훈련일지 (FIELD)");
  await page.goto(BASE + "/worker/worklog?trainingType=FIELD&traineeName=김훈련", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await shot(page, "03_worklog_field");
  await chk(page, "헤더 훈련 일지", "text=훈련 일지", true);
  await chk(page, "현장훈련 배지", "text=현장훈련", true);
  await chk(page, "관리자 설정 잠금", "text=관리자 설정", true);
  await chk(page, "평가 및 지도사항", "text=평가 및 지도사항", true);
  await chk(page, "특이사항 없음", "text=특이사항", false);
  await chk(page, "수행 과제 입력", "text=수행 과제", true);
  await chk(page, "측정 시간 입력", "text=측정 시간", true);
  await chk(page, "출퇴근 지도(분리)", "text=출퇴근 지도 (관리자 설정)", true);
  await chk(page, "지도및휴게(분리)", "text=지도 및 휴게시간 지도 여부", true);
  const timeBtns = await page.locator("button").filter({ hasText: /^\d{2}:\d{2}$/ }).count();
  console.log("  " + (timeBtns === 0 ? "OK" : "FAIL") + " 시간 편집 버튼 없음(연장 전) - " + timeBtns + "개");

  console.log("\n[4] 적응지도 일지 (ADAPTATION)");
  await page.goto(BASE + "/worker/worklog?trainingType=ADAPTATION&traineeName=박적응", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await shot(page, "04_worklog_adaptation");
  await chk(page, "헤더 적응지도 일지", "text=적응지도 일지", true);
  await chk(page, "현장훈련 배지 없음", "text=현장훈련", false);
  await chk(page, "근무 시간 라벨", "text=근무 시간", true);
  await chk(page, "통합 지도여부 체크", "text=출퇴근 지도 및 휴게시간 지도 여부", true);
  await chk(page, "특이사항 있음", "text=특이사항", true);
  await chk(page, "지도사항 라벨", "text=지도사항", true);
  await chk(page, "평가및지도사항 없음", "text=평가 및 지도사항", false);

  console.log("\n[5] 일지 목록");
  await page.goto(BASE + "/worker/logs", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await shot(page, "05_logs");
  await chk(page, "일지 목록 타이틀", "text=일지 목록", true);
  // worker01 = FIELD 단계 → 훈련 세트 필터만 표시 (적응지도 필터는 ADAPTATION 단계 전용)
  await chk(page, "훈련 전체 필터", "text=훈련 전체", true);
  await chk(page, "사전훈련 필터", "text=사전훈련", true);
  await chk(page, "현장훈련 필터", "text=현장훈련", true);
  await chk(page, "적응지도 필터 없음(훈련단계)", "text=적응지도 전체", false);

  console.log("\n[6] 훈련생 종합평가");
  await page.goto(BASE + "/worker/evaluation/training?traineeId=1&traineeName=김훈련&periodStart=2026-05-01&periodEnd=2026-05-31", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await shot(page, "06_eval_training");
  await chk(page, "훈련 종합평가 타이틀", "text=지원고용 훈련생 종합 평가기록부", true);
  await chk(page, "사전훈련 라벨", "text=사전훈련", true);
  await chk(page, "현장훈련 라벨", "text=현장훈련", true);
  await chk(page, "초기 없음(훈련전용)", "text=초기 평가", false);

  console.log("\n[7] 적응지도 종합평가");
  await page.goto(BASE + "/worker/evaluation/adaptation?traineeId=1&traineeName=박적응&periodStart=2026-05-01&periodEnd=2026-05-31", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await shot(page, "07_eval_adaptation");
  await chk(page, "적응 종합평가 타이틀", "text=취업 후 적응지도 종합 평가기록부", true);
  await chk(page, "초기 평가 라벨", "text=초기 평가", true);
  await chk(page, "후기 평가 라벨", "text=후기 평가", true);
  await chk(page, "사전훈련 없음(적응전용)", "text=사전훈련", false);

  await browser.close();
  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
// 이 부분은 append용이므로 사용 안함
