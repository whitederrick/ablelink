// lib/pdf/core/PdfCanvas.ts
// PDF 생성 및 조작을 위한 PdfCanvas 클래스

import PDFDocument from "pdfkit";

export type PdfFontSpec = {
  regularPath: string;
  boldPath?: string;
};

export type PdfPageSpec = {
  size?: "A4" | [number, number];
  margin: number;
};

export type TextAlign = "left" | "center" | "right";

export class PdfCanvas {
  public doc: PDFKit.PDFDocument;
  public pageWidth: number;
  public pageHeight: number;
  public margin: number;

  private font: PdfFontSpec;
  private currentFontStyle: "regular" | "bold" = "regular";
  private currentFontSize = 11; // ✅ PdfCanvas가 직접 관리

  constructor(opts: { page: PdfPageSpec; font: PdfFontSpec }) {
    this.font = opts.font;
    this.margin = opts.page.margin;

    this.doc = new PDFDocument({
      size: opts.page.size ?? "A4",
      margins: {
        top: this.margin,
        left: this.margin,
        right: this.margin,
        bottom: this.margin,
      },
      compress: true,
      autoFirstPage: true,
    });

    this.pageWidth = this.doc.page.width;
    this.pageHeight = this.doc.page.height;

    this.setFont("regular", 11);
  }

  get fontSize() {
    return this.currentFontSize;
  }

  setFont(style: "regular" | "bold", size: number) {
    this.currentFontStyle = style;
    this.currentFontSize = size;

    const path =
      style === "bold"
        ? this.font.boldPath ?? this.font.regularPath
        : this.font.regularPath;

    this.doc.font(path).fontSize(size);
  }

  setFontSize(size: number) {
    // 필요 시 사이즈만 변경
    this.currentFontSize = size;
    this.doc.fontSize(size);
  }

  drawText(opts: {
    x: number;
    y: number;
    w?: number;
    text: string;
    fontSize?: number;
    bold?: boolean;
    align?: TextAlign;
    lineGap?: number;
  }) {
    const { x, y, w, text, fontSize, bold, align, lineGap } = opts;

    if (fontSize != null) this.setFontSize(fontSize);
    if (bold != null) this.setFont(bold ? "bold" : "regular", this.currentFontSize);

    this.doc.text(text ?? "", x, y, {
      width: w,
      align: align ?? "left",
      lineGap: lineGap ?? 2,
    });
  }

  /**
   * 회전 텍스트 출력 (세로 텍스트/라벨 등)
   * - angle: degree 단위 (예: -90)
   * - x,y는 회전의 기준점(origin)이며, 텍스트도 그 좌표를 기준으로 출력됨
   */
  drawRotatedText(opts: {
    x: number;
    y: number;
    text: string;
    angle: number; // degrees
    fontSize?: number;
    bold?: boolean;
    align?: TextAlign;
  }) {
    const { x, y, text, angle, fontSize, bold, align } = opts;

    if (fontSize != null) this.setFontSize(fontSize);
    if (bold != null) this.setFont(bold ? "bold" : "regular", this.currentFontSize);

    this.doc.save();
    this.doc.rotate(angle, { origin: [x, y] });
    this.doc.text(text ?? "", x, y, {
      align: align ?? "left",
    });
    this.doc.restore();
  }

  textBox(opts: {
    x: number;
    y: number;
    w: number;
    h?: number;
    text: string;
    fontSize?: number;
    bold?: boolean;
    align?: TextAlign;
    valign?: "top" | "middle" | "bottom";
    padding?: number;
    lineGap?: number;
  }): { usedHeight: number } {
    const padding = opts.padding ?? 3;
    const lineGap = opts.lineGap ?? 2;

    if (opts.fontSize != null) this.setFontSize(opts.fontSize);
    if (opts.bold != null) this.setFont(opts.bold ? "bold" : "regular", this.currentFontSize);

    const innerW = Math.max(0, opts.w - padding * 2);

    const measured = this.measureTextHeight({
      w: innerW,
      text: opts.text ?? "",
      lineGap,
    });

    const contentH = measured;
    const boxH = opts.h ?? contentH + padding * 2;

    let textY = opts.y + padding;
    if (opts.valign === "middle") textY = opts.y + (boxH - contentH) / 2;
    if (opts.valign === "bottom") textY = opts.y + boxH - contentH - padding;

    this.doc.text(opts.text ?? "", opts.x + padding, textY, {
      width: innerW,
      align: opts.align ?? "left",
      lineGap,
    });

    return { usedHeight: boxH };
  }

  measureTextHeight(opts: { w: number; text: string; lineGap?: number }): number {
    return this.doc.heightOfString(opts.text ?? "", {
      width: opts.w,
      lineGap: opts.lineGap ?? 2,
    });
  }

  drawLine(x1: number, y1: number, x2: number, y2: number, width = 1) {
    this.doc.save();
    this.doc.lineWidth(width);
    this.doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
    this.doc.restore();
  }

  drawRect(x: number, y: number, w: number, h: number, width = 1) {
    this.doc.save();
    this.doc.lineWidth(width);
    this.doc.rect(x, y, w, h).stroke();
    this.doc.restore();
  }

  // PDF Buffer로 종료
  async toBuffer(): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return await new Promise((resolve, reject) => {
      this.doc.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      this.doc.on("end", () => resolve(Buffer.concat(chunks)));
      this.doc.on("error", reject);
      this.doc.end();
    });
  }

  addPage() {
    this.doc.addPage();
    this.pageWidth = this.doc.page.width;
    this.pageHeight = this.doc.page.height;
  }
}
