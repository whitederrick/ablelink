// lib/email.ts — AWS SES 이메일 발송 유틸
import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: process.env.AWS_REGION || "ap-northeast-2" });

export async function sendEmailWithPdf(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
  pdfBuffer: Buffer;
  fileName: string;
}) {
  const boundary = `----=_Part_${Date.now()}`;
  const b64 = opts.pdfBuffer.toString("base64");
  const raw = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(opts.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(opts.body).toString("base64"),
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${opts.fileName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${opts.fileName}"`,
    "",
    b64,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  await ses.send(
    new SendRawEmailCommand({ RawMessage: { Data: Buffer.from(raw) } })
  );
}
