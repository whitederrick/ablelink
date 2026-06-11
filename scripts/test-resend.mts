// scripts/test-resend.mts
// Resend 실발송 검증 — 발신 도메인(noreply@able-link.co.kr) 인증·첨부 경로 확인용 1회성.
// 실행: npx tsx scripts/test-resend.mts [수신이메일]
// 기본 수신=whitederrick@gmail.com
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const FONT_PATH = fileURLToPath(new URL("../public/fonts/NotoSansKR-Regular.ttf", import.meta.url));

// .env 로드
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const TO = process.argv[2] || "whitederrick@gmail.com";

function tinyPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("KR", FONT_PATH);
    doc.font("KR");
    doc.fontSize(20).text("AbleLink Resend 발송 테스트", { align: "center" });
    doc.moveDown().fontSize(12).text(`발송 시각: ${new Date().toISOString()}`);
    doc.text("이 PDF가 보이면 첨부 발송 경로가 정상입니다.");
    doc.end();
  });
}

async function main() {
  const { sendSimpleEmail, sendEmailWithAttachments } = await import("../lib/email.js");
  console.log("FROM:", process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || "(default)");
  console.log("TO  :", TO);
  console.log("KEY :", (process.env.RESEND_API_KEY || "").slice(0, 6) + "…");

  // ① 단순 텍스트 메일
  await sendSimpleEmail({
    to: TO,
    subject: "[AbleLink] Resend 발송 테스트 ① 단순 메일",
    text: "Resend 단순 텍스트 발송 테스트입니다. 이 메일이 도착하면 발신 도메인 인증이 정상입니다.",
  });
  console.log("✓ ① 단순 메일 발송 완료");

  // ② PDF 첨부 메일 (문서 발송 경로와 동일한 sendEmailWithAttachments)
  const pdf = await tinyPdf();
  await sendEmailWithAttachments({
    to: TO,
    subject: "[AbleLink] Resend 발송 테스트 ② PDF 첨부",
    body: "PDF 첨부 발송 테스트입니다. 첨부된 PDF를 확인해주세요.",
    attachments: [{ filename: "ablelink-test.pdf", content: pdf }],
  });
  console.log("✓ ② PDF 첨부 메일 발송 완료");
}

main().then(() => { console.log("완료"); process.exit(0); }).catch((e) => { console.error("실패:", e?.message ?? e); process.exit(1); });
