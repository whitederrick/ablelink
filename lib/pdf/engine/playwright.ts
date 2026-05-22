// lib/pdf/engine/playwright.ts
import { chromium, Browser } from "playwright";

// Next.js dev 핫리로드 시에도 브라우저 인스턴스를 유지하기 위해 global에 캐싱
const g = global as typeof globalThis & { __pw_browser?: Browser };

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  // Windows headless 필수 — 없으면 GPU 초기화 실패로 브라우저가 비정상 종료됨
  "--disable-gpu",
  "--disable-extensions",
];

async function getBrowser(): Promise<Browser> {
  if (g.__pw_browser?.isConnected()) return g.__pw_browser;
  g.__pw_browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  return g.__pw_browser;
}

export async function htmlToPdfBuffer(opts: {
  html: string;
  // A4 기준 여백(원본과 유사하게 조정)
  margin?: { top: string; right: string; bottom: string; left: string };
}): Promise<Buffer> {
  const margin = opts.margin ?? {
    top: "12mm",
    right: "12mm",
    bottom: "12mm",
    left: "12mm",
  };

  const browser = await getBrowser();
  const context = await browser.newContext();

  try {
    const page = await context.newPage();

    // load: base64 폰트 포함 모든 리소스 파싱 완료 후 PDF 생성
    await page.setContent(opts.html, { waitUntil: "load", timeout: 30000 });

    // 폰트 렌더링 완료 대기
    await page.waitForTimeout(200);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin,
    });

    return Buffer.from(pdf);
  } finally {
    // 브라우저는 재사용하고 context(탭)만 닫아 메모리 누수 방지
    await context.close().catch(() => {});
  }
}