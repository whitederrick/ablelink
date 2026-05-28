import { chromium } from "./node_modules/playwright/index.mjs";

const BASE = "http://localhost:3000";

async function shot(page, name) {
  const p = "C:/tmp/admin_" + name + ".png";
  await page.screenshot({ path: p, fullPage: false });
  console.log("  📸 " + p);
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-gpu","--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // 1. 관리자 로그인
  console.log("\n[1] 관리자 로그인");
  await page.goto(BASE + "/admin/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.locator("input[placeholder*='아이디']").fill("admin");
  await page.locator("input[type=password]").fill("admin1234!");
  await page.locator("button[type=submit], button:has-text('로그인')").first().click();
  await page.waitForLoadState("networkidle");
  const afterUrl = page.url();
  if (afterUrl.includes("login")) {
    await shot(page, "00_login_fail");
    console.log("  ❌ 로그인 실패");
    await browser.close(); return;
  }
  console.log("  ✅ 로그인 성공:", afterUrl);

  // 2. 직무지도원 관리
  console.log("\n[2] /admin/coaches 이동");
  await page.goto(BASE + "/admin/coaches", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await shot(page, "01_coaches");
  console.log("  직무지도원 행:", await page.locator("tbody tr").count() + "개");

  // 3. 행 클릭 → 근무형태 설정 모달
  console.log("\n[3] 첫 번째 행 클릭");
  await page.locator("tbody tr").first().click();
  await page.waitForTimeout(1000);
  await shot(page, "02_row_clicked");

  const modalOpen = await page.locator("text=근무형태 설정").count() > 0;
  console.log("  모달 열림:", modalOpen ? "✅" : "❌");
  if (!modalOpen) { await browser.close(); return; }

  await shot(page, "03_modal");

  // 4. 모달 요소 확인
  console.log("\n[4] 모달 요소 확인");
  const timeInputs = await page.locator("input[type=time]").count();
  console.log("  시간 입력 필드:", timeInputs + "개 " + (timeInputs >= 2 ? "✅" : "❌"));

  for (const [label, text] of [["오전","오전"], ["오후","오후"], ["전일","전일"], ["직접입력","직접 입력"]]) {
    const n = await page.locator("button:has-text('" + text + "')").count();
    console.log("  " + label + " 버튼:", n > 0 ? "✅" : "❌");
  }

  // 5. AM 클릭 → 09:00~13:00
  console.log("\n[5] 오전 선택");
  await page.locator("button:has-text('오전')").first().click();
  await page.waitForTimeout(300);
  await shot(page, "04_am");
  const amS = await page.locator("input[type=time]").nth(0).inputValue();
  const amE = await page.locator("input[type=time]").nth(1).inputValue();
  console.log("  시간:", amS, "~", amE);
  console.log("  09:00~13:00:", amS === "09:00" && amE === "13:00" ? "✅" : "❌ (" + amS + "~" + amE + ")");
  // 인정 시간 미리보기
  const amHint = (await page.textContent("body")).match(/[\d.]+H/g) || [];
  console.log("  H 관련 텍스트:", [...new Set(amHint)].join(", "));

  // 6. PM 클릭 → 13:00~17:00
  console.log("\n[6] 오후 선택");
  await page.locator("button:has-text('오후')").first().click();
  await page.waitForTimeout(300);
  await shot(page, "05_pm");
  const pmS = await page.locator("input[type=time]").nth(0).inputValue();
  const pmE = await page.locator("input[type=time]").nth(1).inputValue();
  console.log("  시간:", pmS, "~", pmE);
  console.log("  13:00~17:00:", pmS === "13:00" && pmE === "17:00" ? "✅" : "❌ (" + pmS + "~" + pmE + ")");

  // 7. FULL_DAY 클릭 → 09:00~18:00 + 점심 공제
  console.log("\n[7] 전일 선택");
  await page.locator("button:has-text('전일')").first().click();
  await page.waitForTimeout(300);
  await shot(page, "06_fullday");
  const fdS = await page.locator("input[type=time]").nth(0).inputValue();
  const fdE = await page.locator("input[type=time]").nth(1).inputValue();
  console.log("  시간:", fdS, "~", fdE);
  console.log("  09:00~18:00:", fdS === "09:00" && fdE === "18:00" ? "✅" : "❌ (" + fdS + "~" + fdE + ")");
  console.log("  점심시간 안내:", (await page.locator("text=점심시간").count()) > 0 ? "✅" : "❌");
  console.log("  총 9H 표시:", (await page.locator("text=/총 9/").count()) > 0 ? "✅" : "❌");
  console.log("  인정 8H 표시:", (await page.locator("text=/인정 8/").count()) > 0 ? "✅" : "❌");

  // 8. 시간 직접 수정: 08:00~17:00
  console.log("\n[8] 시간 직접 수정 (08:00~17:00)");
  await page.locator("input[type=time]").nth(0).fill("08:00");
  await page.locator("input[type=time]").nth(1).fill("17:00");
  await page.waitForTimeout(300);
  await shot(page, "07_custom");
  const cS = await page.locator("input[type=time]").nth(0).inputValue();
  const cE = await page.locator("input[type=time]").nth(1).inputValue();
  console.log("  입력값:", cS, "~", cE);
  console.log("  08:00~17:00:", cS === "08:00" && cE === "17:00" ? "✅" : "❌");
  // 재계산: FULL_DAY 08:00-17:00 = 9H - 1H = 8H
  const bodyText = await page.textContent("body");
  console.log("  '인정 8H' 재계산:", bodyText.includes("인정 8") ? "✅" : "❌");

  // 9. 전일 09:00~18:00 저장
  console.log("\n[9] 전일 09:00~18:00으로 저장");
  await page.locator("button:has-text('전일')").first().click();
  await page.waitForTimeout(200);
  const preS = await page.locator("input[type=time]").nth(0).inputValue();
  const preE = await page.locator("input[type=time]").nth(1).inputValue();
  console.log("  저장 전:", preS, "~", preE);
  await page.locator("button:has-text('저장')").last().click();
  await page.waitForTimeout(2000);
  await shot(page, "08_saved");
  console.log("  모달 닫힘:", (await page.locator("text=근무형태 설정").count()) === 0 ? "✅" : "❌");
  console.log("  목록 '전일' 표시:", (await page.locator("text=전일").count()) > 0 ? "✅" : "❌");

  // 10. 다시 열어서 저장값 확인
  console.log("\n[10] 저장값 확인 (행 재클릭)");
  await page.locator("tbody tr").first().click();
  await page.waitForTimeout(800);
  await shot(page, "09_recheck");
  const savedS = await page.locator("input[type=time]").nth(0).inputValue().catch(() => "?");
  const savedE = await page.locator("input[type=time]").nth(1).inputValue().catch(() => "?");
  console.log("  저장된 값:", savedS, "~", savedE);
  console.log("  09:00 유지:", savedS === "09:00" ? "✅" : "❌");
  console.log("  18:00 유지:", savedE === "18:00" ? "✅" : "❌");

  await browser.close();
  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("❌ ERROR:", e.message); process.exit(1); });
