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
    // 서버 환경에 따라 필요할 수 있음 (Docker/리눅스)
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // HTML 주입
    await page.setContent(opts.html, { waitUntil: "networkidle" });

    // PDF 생성
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin,
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
