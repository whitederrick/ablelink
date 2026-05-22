// lib/pdf/engine/fontEmbed.ts
import fs from "fs";
import path from "path";

// base64 임베드 대신 file:// URL 참조 — 150MB+ HTML → 수 KB
function toFileUrl(absPath: string): string {
  return "file:///" + absPath.replace(/\\/g, "/");
}

function fontPath(name: string) {
  return path.resolve(`public/fonts/${name}`);
}

/** HCR 돋움/바탕 4종 + @page 여백까지 포함한 CSS 반환 */
export function buildHcrFontFaceCss(pageMargin?: string): string {
  const files = {
    dotum:     fontPath("HCRDotum.ttf"),
    dotumBold: fontPath("HCRDotum-Bold.ttf"),
    batang:     fontPath("HCRBatang.ttf"),
    batangBold: fontPath("HCRBatang-Bold.ttf"),
  };

  for (const [key, p] of Object.entries(files)) {
    if (!fs.existsSync(p)) throw new Error(`font not found: ${key} (${p})`);
  }

  const margin = pageMargin ?? "20mm 30mm 15mm 30mm";

  return `
@page { size: A4; margin: ${margin}; }
html, body { margin: 0; padding: 0; }

@font-face {
  font-family: "HCRDotum";
  src: url("${toFileUrl(files.dotum)}") format("truetype");
  font-weight: 400; font-style: normal;
}
@font-face {
  font-family: "HCRDotum";
  src: url("${toFileUrl(files.dotumBold)}") format("truetype");
  font-weight: 700; font-style: normal;
}
@font-face {
  font-family: "HCRBatang";
  src: url("${toFileUrl(files.batang)}") format("truetype");
  font-weight: 400; font-style: normal;
}
@font-face {
  font-family: "HCRBatang";
  src: url("${toFileUrl(files.batangBold)}") format("truetype");
  font-weight: 700; font-style: normal;
}
`.trim();
}

/** 기존 NotoSansKR 호환 — 필요하면 유지 */
export function buildNotoSansKrFontFaceCss(): string {
  const regular = fontPath("NotoSansKR-Regular.ttf");
  const bold    = fontPath("NotoSansKR-Bold.ttf");
  if (!fs.existsSync(regular)) throw new Error("font:NotoSansKR-Regular not found");
  if (!fs.existsSync(bold))    throw new Error("font:NotoSansKR-Bold not found");
  return `
@font-face {
  font-family: "NotoSansKR";
  src: url("${toFileUrl(regular)}") format("truetype");
  font-weight: 400; font-style: normal;
}
@font-face {
  font-family: "NotoSansKR";
  src: url("${toFileUrl(bold)}") format("truetype");
  font-weight: 700; font-style: normal;
}
`.trim();
}
