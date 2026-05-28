import { chromium } from "./node_modules/playwright/index.mjs";

const BASE = "http://localhost:3000";

async function shot(page, name) {
  const p = "C:/tmp/set_" + name + ".png";
  await page.screenshot({ path: p, fullPage: false });
  console.log("  📸 " + p);
  return p;
}

async function login(page, id, pw) {
  await page.goto(BASE + "/worker/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await page.locator("input").nth(0).fill(id);
  await page.locator("input[type=password]").fill(pw);
  await page.locator("button").filter({ hasText: /로그인/ }).first().click();
  await page.waitForTimeout(3000);
  return !page.url().includes("login");
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-gpu","--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // worker01 로그인 (FIELD training 단계)
  console.log("\n[1] 워커 로그인");
  const ok = await login(page, "worker01", "worker1234!");
  console.log("  로그인:", ok ? "✅" : "❌");
  if (!ok) { await browser.close(); return; }

  // 현재 trainingType 확인 (site/current API)
  const siteRes = await page.evaluate(async () => {
    const r = await fetch("/api/worker/site/current");
    return r.json();
  });
  const trainingType = siteRes?.data?.trainingType || "unknown";
  const isAdaptation = trainingType === "ADAPTATION";
  console.log("  현재 trainingType:", trainingType);
  console.log("  서비스 세트:", isAdaptation ? "취업후 적응지도" : "지원고용 훈련");

  // ── 2. 홈 화면 ─────────────────────────────────────────
  console.log("\n[2] 홈 화면");
  await page.goto(BASE + "/worker/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await shot(page, "01_home");
  const stepTxt = await page.locator("text=현재 서비스 단계").count();
  const evalBtn = await page.locator("text=종합평가").count();
  console.log("  서비스 단계 표시:", stepTxt > 0 ? "✅" : "❌");
  console.log("  종합평가 버튼:", evalBtn > 0 ? "✅" : "❌");

  // ── 3. 문서 발송 페이지 ────────────────────────────────
  console.log("\n[3] 문서 발송 — 서비스 세트 필터 확인");
  await page.goto(BASE + "/worker/docs", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await shot(page, "02_docs_send");

  // 서비스 세트 안내 배너
  const banner = await page.locator("text=현재 서비스").count();
  console.log("  서비스 세트 안내:", banner > 0 ? "✅" : "❌");

  if (isAdaptation) {
    // 적응지도 세트: 출근부+적응일지+적응평가 있어야, 훈련일지/훈련평가 없어야
    const hasATT  = await page.locator("text=출근부").count() > 0;
    const hasADL  = await page.locator("text=적응지도 일지").count() > 0;
    const hasAFE  = await page.locator("text=적응지도 종합평가").count() > 0;
    const noTDL   = await page.locator("text=훈련일지").count() === 0;
    const noTFE   = await page.locator("text=훈련생 종합평가").count() === 0;
    console.log("  출근부 있음:", hasATT ? "✅" : "❌");
    console.log("  적응지도 일지 있음:", hasADL ? "✅" : "❌");
    console.log("  적응지도 종합평가 있음:", hasAFE ? "✅" : "❌");
    console.log("  훈련일지 없음:", noTDL ? "✅" : "❌ (있으면 안됨)");
    console.log("  훈련생 종합평가 없음:", noTFE ? "✅" : "❌ (있으면 안됨)");
  } else {
    // 훈련 세트: 출근부+훈련일지+훈련평가 있어야, 적응일지/적응평가 없어야
    const hasATT  = await page.locator("text=출근부").count() > 0;
    const hasTDL  = await page.locator("text=훈련일지").count() > 0;
    const hasTFE  = await page.locator("text=훈련생 종합평가").count() > 0;
    const noADL   = await page.locator("text=적응지도 일지").count() === 0;
    const noAFE   = await page.locator("text=적응지도 종합평가").count() === 0;
    console.log("  출근부 있음:", hasATT ? "✅" : "❌");
    console.log("  훈련일지 있음:", hasTDL ? "✅" : "❌");
    console.log("  훈련생 종합평가 있음:", hasTFE ? "✅" : "❌");
    console.log("  적응지도 일지 없음:", noADL ? "✅" : "❌ (있으면 안됨)");
    console.log("  적응지도 종합평가 없음:", noAFE ? "✅" : "❌ (있으면 안됨)");
  }

  // ── 4. 문서 조회 페이지 ────────────────────────────────
  console.log("\n[4] 문서 조회 — 서비스 세트 필터 확인");
  await page.goto(BASE + "/worker/docs/view", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await shot(page, "03_docs_view");

  const viewBanner = await page.locator("text=현재 서비스").count();
  console.log("  서비스 안내:", viewBanner > 0 ? "✅" : "❌");

  if (isAdaptation) {
    const hasADL = await page.locator("text=적응지도 일지").count() > 0;
    const hasAFE = await page.locator("text=적응지도 종합평가").count() > 0;
    const noTDL  = await page.locator("text=훈련일지").count() === 0;
    console.log("  적응지도 일지:", hasADL ? "✅" : "❌");
    console.log("  적응지도 종합평가:", hasAFE ? "✅" : "❌");
    console.log("  훈련일지 없음:", noTDL ? "✅" : "❌");
  } else {
    const hasTDL  = await page.locator("text=훈련일지").count() > 0;
    const hasTFE  = await page.locator("text=훈련생 종합평가").count() > 0;
    const noADL   = await page.locator("text=적응지도 일지").count() === 0;
    console.log("  훈련일지:", hasTDL ? "✅" : "❌");
    console.log("  훈련생 종합평가:", hasTFE ? "✅" : "❌");
    console.log("  적응지도 일지 없음:", noADL ? "✅" : "❌");
  }

  // ── 5. 일지 목록 페이지 ────────────────────────────────
  console.log("\n[5] 일지 목록 — 서비스 단계 기본 필터");
  await page.goto(BASE + "/worker/logs", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await shot(page, "04_logs");

  if (isAdaptation) {
    // 적응지도: "적응지도 전체" 버튼 활성
    const adaptBtn = await page.locator("button:has-text('적응지도 전체')").count();
    console.log("  '적응지도 전체' 필터:", adaptBtn > 0 ? "✅" : "❌");
  } else {
    // 훈련: "훈련 전체" 버튼 활성
    const trainBtn = await page.locator("button:has-text('훈련 전체')").count();
    const preBtn   = await page.locator("button:has-text('사전훈련')").count();
    const fieldBtn = await page.locator("button:has-text('현장훈련')").count();
    console.log("  '훈련 전체' 필터:", trainBtn > 0 ? "✅" : "❌");
    console.log("  '사전훈련' 필터:", preBtn > 0 ? "✅" : "❌");
    console.log("  '현장훈련' 필터:", fieldBtn > 0 ? "✅" : "❌");
  }

  // ── 6. 일지 작성 — trainingType 자동 적용 확인 ──────────
  console.log("\n[6] 일지 작성 — 서비스 단계 자동 적용");
  await page.goto(BASE + "/worker/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // 홈에서 일지 작성 버튼 클릭
  const writeBtn = page.locator("button:has-text('일지 작성')").first();
  if (await writeBtn.count() > 0) {
    await writeBtn.click();
    await page.waitForTimeout(1500);
    await shot(page, "05_worklog_from_home");
    const worklogUrl = page.url();
    console.log("  일지 작성 URL:", worklogUrl);
    if (isAdaptation) {
      const adaptHeader = await page.locator("text=적응지도 일지").count();
      console.log("  '적응지도 일지' 헤더:", adaptHeader > 0 ? "✅" : "❌");
    } else {
      const trainHeader = await page.locator("text=훈련 일지").count();
      console.log("  '훈련 일지' 헤더:", trainHeader > 0 ? "✅" : "❌");
    }
  } else {
    console.log("  일지 작성 버튼 없음 (담당 훈련생 미배정)");
  }

  await browser.close();
  console.log("\n=== 완료 ===");
  console.log("현재 서비스:", isAdaptation ? "취업후 적응지도" : "지원고용 훈련 (현장훈련)");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
