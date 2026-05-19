// lib/pdf/engine/fontEmbed.ts
import fs from "fs";
import path from "path";

function toDataUrl(ttfAbsPath: string): string {
  const bin = fs.readFileSync(ttfAbsPath);
  const b64 = bin.toString("base64");
  return `data:font/ttf;base64,${b64}`;
}

export function buildNotoSansKrFontFaceCss() {
  const regular = path.resolve("public/fonts/NotoSansKR-Regular.ttf");
  const bold = path.resolve("public/fonts/NotoSansKR-Bold.ttf");

  if (!fs.existsSync(regular)) throw new Error("VALIDATION:font:regular");
  if (!fs.existsSync(bold)) throw new Error("VALIDATION:font:bold");

  const regularUrl = toDataUrl(regular);
  const boldUrl = toDataUrl(bold);

  // Chromium PDF 출력용 폰트 임베드
  return `
@font-face {
  font-family: "NotoSansKR";
  src: url("${regularUrl}") format("truetype");
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: "NotoSansKR";
  src: url("${boldUrl}") format("truetype");
  font-weight: 700;
  font-style: normal;
}
  `.trim();
}
