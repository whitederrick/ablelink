// lib/pdf/core/Grid.ts
import { PdfCanvas } from "./PdfCanvas";

export type GridHooks = {
  onNewPage?: (ctx: GridContext) => void; // 페이지 생성 직후(헤더 등)
  onBeforePageEnd?: (ctx: GridContext) => void; // 페이지 종료 직전(푸터 등)
};

export type GridContext = {
  canvas: PdfCanvas;
  contentX: number;
  contentY: number;
  contentW: number;
  contentTopY: number;
  contentBottomY: number;
  pageNo: number;
};

export class Grid {
  public ctx: GridContext;

  private hooks: GridHooks;

  constructor(canvas: PdfCanvas, hooks: GridHooks = {}) {
    this.hooks = hooks;

    const contentX = canvas.margin;
    const contentTopY = canvas.margin;
    const contentW = canvas.pageWidth - canvas.margin * 2;
    const contentBottomY = canvas.pageHeight - canvas.margin;

    this.ctx = {
      canvas,
      contentX,
      contentY: contentTopY,
      contentW,
      contentTopY,
      contentBottomY,
      pageNo: 1,
    };

    this.hooks.onNewPage?.(this.ctx);
  }

  get x() {
    return this.ctx.contentX;
  }

  get y() {
    return this.ctx.contentY;
  }

  get w() {
    return this.ctx.contentW;
  }

  // 아래로 이동
  moveDown(h: number) {
    this.ctx.contentY += h;
  }

  // 현재 y 설정
  setY(y: number) {
    this.ctx.contentY = y;
  }

  // 높이 확보(부족하면 새 페이지)
  ensureSpace(height: number) {
    if (this.ctx.contentY + height <= this.ctx.contentBottomY) return;

    this.hooks.onBeforePageEnd?.(this.ctx);

    this.ctx.canvas.addPage();
    this.ctx.pageNo += 1;

    // 새 페이지 좌표 재계산(페이지 크기 변동 대응)
    this.ctx.contentX = this.ctx.canvas.margin;
    this.ctx.contentTopY = this.ctx.canvas.margin;
    this.ctx.contentW = this.ctx.canvas.pageWidth - this.ctx.canvas.margin * 2;
    this.ctx.contentBottomY = this.ctx.canvas.pageHeight - this.ctx.canvas.margin;

    this.ctx.contentY = this.ctx.contentTopY;

    this.hooks.onNewPage?.(this.ctx);
  }

  // 간단 구분선
  hr(gapTop = 6, gapBottom = 6, lineWidth = 1) {
    this.ensureSpace(gapTop + gapBottom + 2);
    this.moveDown(gapTop);
    const y = this.ctx.contentY;
    this.ctx.canvas.drawLine(this.x, y, this.x + this.w, y, lineWidth);
    this.moveDown(gapBottom);
  }
}
