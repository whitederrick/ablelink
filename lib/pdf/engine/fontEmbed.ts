// lib/pdf/engine/fontEmbed.ts
import fs from "fs";
import path from "path";

function toDataUrl(ttfAbsPath: string): string {
  const bin = fs.readFileSync(ttfAbsPath);
  return `data:font/ttf;base64,${bin.toString("base64")}`;
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
  src: url("${toDataUrl(files.dotum)}") format("truetype");
  font-weight: 400; font-style: normal;
}
@font-face {
  font-family: "HCRDotum";
  src: url("${toDataUrl(files.dotumBold)}") format("truetype");
  font-weight: 700; font-style: normal;
}
@font-face {
  font-family: "HCRBatang";
  src: url("${toDataUrl(files.batang)}") format("truetype");
  font-weight: 400; font-style: normal;
}
@font-face {
  font-family: "HCRBatang";
  src: url("${toDataUrl(files.batangBold)}") format("truetype");
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
  src: url("${toDataUrl(regular)}") format("truetype");
  font-weight: 400; font-style: normal;
}
@font-face {
  font-family: "NotoSansKR";
  src: url("${toDataUrl(bold)}") format("truetype");
  font-weight: 700; font-style: normal;
}
`.trim();
}
