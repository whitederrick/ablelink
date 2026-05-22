// lib/pdf/engine/playwright.ts
import { chromium } from "playwright";

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

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      // Windows headless 필수 — 없으면 GPU 초기화 실패로 브라우저가 비정상 종료됨
      "--disable-gpu",
      "--disable-extensions",
    ],
  });

  let pdfBuffer: Buffer | undefined;

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // load: base64 폰트 포함 모든 리소스 파싱 완료 후 PDF 생성
    await page.setContent(opts.html, { waitUntil: "load", timeout: 30000 });

    // 폰트 렌더링 완료 대기
    await page.waitForTimeout(500);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin,
    });

    pdfBuffer = Buffer.from(pdf);
  } finally {
    // browser.close()가 모든 context/page를 정리하므로 context.close() 불필요.
    // Next.js 서버 환경에서 브라우저가 비정상 종료된 경우에도 예외가 전파되지 않도록 suppress.
    await browser.close().catch(() => {});
  }

  if (!pdfBuffer) throw new Error("PDF 버퍼 생성 실패");
  return pdfBuffer;
}