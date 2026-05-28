import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const SCREENSHOT_DIR = 'C:/Users/white/AppData/Local/Temp/payroll_screenshots';
import { mkdirSync } from 'fs';
try { mkdirSync(SCREENSHOT_DIR, { recursive: true }); } catch {}

async function shot(page, name) {
  const p = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log('📸', name, p);
}

const browser = await chromium.launch({ headless: false, slowMo: 300 });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

try {
  // 1. 로그인
  console.log('--- 1. 관리자 로그인 ---');
  await page.goto(`${BASE}/admin/login`);
  await page.waitForLoadState('networkidle');
  await shot(page, '01_login_page');

  await page.fill('input[type="text"], input[name="loginId"], input[placeholder*="아이디"], input[placeholder*="ID"]', 'admin');
  await page.fill('input[type="password"]', '1111');
  await page.click('button[type="submit"], button:has-text("로그인")');
  await page.waitForLoadState('networkidle');
  await shot(page, '02_after_login');
  console.log('현재 URL:', page.url());

  // 2. 급여 관리 페이지
  console.log('--- 2. 급여 관리 페이지 이동 ---');
  await page.goto(`${BASE}/admin/payroll`);
  await page.waitForLoadState('networkidle');
  await shot(page, '03_payroll_contracts_tab');

  // 3. 계약 탭 — coachType 드롭다운 확인
  console.log('--- 3. 급여 계약 탭 확인 ---');
  const addBtn = page.locator('button:has-text("계약 등록")');
  if (await addBtn.count() > 0) {
    await addBtn.click();
    await page.waitForTimeout(400);
    await shot(page, '04_contract_form_open');

    // coachType 드롭다운 확인
    const coachTypeSelect = page.locator('select').filter({ hasText: '외부 직무지도원' }).first();
    const coachTypeExists = await coachTypeSelect.count() > 0;
    console.log('coachType 드롭다운 존재:', coachTypeExists);

    if (coachTypeExists) {
      // INTERNAL 선택 → 일급/사업소득 강제 확인
      await coachTypeSelect.selectOption('INTERNAL');
      await page.waitForTimeout(300);
      await shot(page, '05_coachtype_internal_selected');
      const payTypeSelect = page.locator('select').nth(2);
      const payTypeVal = await payTypeSelect.inputValue().catch(() => 'N/A');
      const incomeVal = await page.locator('select').nth(1).inputValue().catch(() => 'N/A');
      console.log('INTERNAL 선택 후 payType:', payTypeVal, '| incomeType:', incomeVal);

      // 다시 EXTERNAL로
      await coachTypeSelect.selectOption('EXTERNAL');
      await page.waitForTimeout(200);
    }

    // 폼 닫기
    const cancelBtn = page.locator('button:has-text("취소")').first();
    if (await cancelBtn.count() > 0) await cancelBtn.click();
  } else {
    console.log('계약 등록 버튼 없음 (권한/플랜 제한 가능)');
  }

  // 4. 공제 설정 탭
  console.log('--- 4. 공제 설정 탭 ---');
  await page.locator('button:has-text("공제 설정")').click();
  await page.waitForLoadState('networkidle');
  await shot(page, '06_deductions_tab');

  const addDedBtn = page.locator('button:has-text("공제 항목 추가")');
  if (await addDedBtn.count() > 0) {
    await addDedBtn.click();
    await page.waitForTimeout(400);
    await shot(page, '07_deduction_form');

    // 고정 공제 등록
    await page.locator('input[placeholder*="교통비"]').fill('테스트 공제항목');
    await page.locator('input[type="number"]').last().fill('10000');
    await page.locator('button:has-text("저장")').first().click();
    await page.waitForTimeout(600);
    await shot(page, '08_deduction_saved');
    console.log('공제 항목 저장 완료');
  }

  // 5. 급여 계산 탭
  console.log('--- 5. 급여 계산 탭 ---');
  await page.locator('button:has-text("급여 계산")').first().click();
  await page.waitForLoadState('networkidle');
  await shot(page, '09_runs_tab');

  // 계산 실행
  const calcBtn = page.locator('button:has-text("⚡ 급여 계산")');
  if (await calcBtn.count() > 0) {
    page.once('dialog', d => { console.log('confirm:', d.message()); d.accept(); });
    await calcBtn.click();
    await page.waitForTimeout(3000);
    await shot(page, '10_after_calculate');
    console.log('급여 계산 실행 완료 (또는 오류)');
  }

  // 상세 보기
  const detailBtn = page.locator('button:has-text("상세 보기")').first();
  if (await detailBtn.count() > 0) {
    await detailBtn.click();
    await page.waitForTimeout(1000);
    await shot(page, '11_run_detail');
    console.log('상세 보기 열림');
  }

} catch (e) {
  console.error('오류:', e.message);
  await shot(page, 'error_state').catch(() => {});
} finally {
  await browser.close();
}
