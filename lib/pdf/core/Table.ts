// lib/pdf/core/Table.ts
import { Grid } from "./Grid";

export type TableColumn = {
  key: string;
  title: string;
  width: number; // pt
  align?: "left" | "center" | "right";
};

export type TableOptions<RowT> = {
  columns: TableColumn[];
  headerHeight?: number; // 고정
  minRowHeight?: number;
  fontSize?: number;
  headerFontSize?: number;
  lineGap?: number;
  cellPadding?: number;
  getCellText: (row: RowT, colKey: string) => string;
};

export class Table<RowT> {
  constructor(private grid: Grid, private opts: TableOptions<RowT>) {}

  private get canvas() {
    return this.grid.ctx.canvas;
  }

  private sumWidth() {
    return this.opts.columns.reduce((a, c) => a + c.width, 0);
  }

  private renderHeader() {
    const { columns } = this.opts;
    const x0 = this.grid.x;
    let x = x0;
    const y = this.grid.y;

    const h = this.opts.headerHeight ?? 20;
    this.grid.ensureSpace(h + 2);

    // 헤더 영역 테두리
    this.canvas.drawRect(x0, y, this.sumWidth(), h, 1);

    this.canvas.setFont("bold", this.opts.headerFontSize ?? 10);

    for (const col of columns) {
      // 셀 경계선(세로)
      this.canvas.drawLine(x, y, x, y + h, 1);

      this.canvas.textBox({
        x,
        y,
        w: col.width,
        h,
        text: col.title,
        align: col.align ?? "center",
        valign: "middle",
        fontSize: this.opts.headerFontSize ?? 10,
        bold: true,
        padding: this.opts.cellPadding ?? 3,
        lineGap: this.opts.lineGap ?? 2,
      });

      x += col.width;
    }
    // 마지막 세로선
    this.canvas.drawLine(x0 + this.sumWidth(), y, x0 + this.sumWidth(), y + h, 1);

    this.grid.moveDown(h);
  }

  private measureRowHeight(row: RowT): number {
    const fontSize = this.opts.fontSize ?? 10;
    this.canvas.setFont("regular", fontSize);

    const padding = this.opts.cellPadding ?? 3;
    const lineGap = this.opts.lineGap ?? 2;

    let maxH = this.opts.minRowHeight ?? 18;

    for (const col of this.opts.columns) {
      const text = this.opts.getCellText(row, col.key) ?? "";
      const innerW = Math.max(1, col.width - padding * 2);
      const textH = this.canvas.measureTextHeight({ w: innerW, text, lineGap });
      const cellH = textH + padding * 2;
      if (cellH > maxH) maxH = cellH;
    }

    return maxH;
  }

  private renderRow(row: RowT, rowH: number) {
    const { columns } = this.opts;
    const x0 = this.grid.x;
    let x = x0;
    const y = this.grid.y;

    // row 외곽
    this.canvas.drawRect(x0, y, this.sumWidth(), rowH, 1);

    this.canvas.setFont("regular", this.opts.fontSize ?? 10);

    for (const col of columns) {
      // 셀 경계선
      this.canvas.drawLine(x, y, x, y + rowH, 1);

      const text = this.opts.getCellText(row, col.key) ?? "";
      this.canvas.textBox({
        x,
        y,
        w: col.width,
        h: rowH,
        text,
        align: col.align ?? "left",
        valign: "middle",
        fontSize: this.opts.fontSize ?? 10,
        bold: false,
        padding: this.opts.cellPadding ?? 3,
        lineGap: this.opts.lineGap ?? 2,
      });

      x += col.width;
    }

    // 마지막 세로선
    this.canvas.drawLine(x0 + this.sumWidth(), y, x0 + this.sumWidth(), y + rowH, 1);

    this.grid.moveDown(rowH);
  }

  render(rows: RowT[]) {
    // 첫 헤더
    this.renderHeader();

    for (const row of rows) {
      const rowH = this.measureRowHeight(row);
      // 페이지 분할 고려: 헤더 + row가 같이 들어갈 여지까지 체크
      this.grid.ensureSpace(rowH + (this.opts.headerHeight ?? 20));

      // ensureSpace에서 페이지 넘어갔을 수도 있으므로
      // 페이지 상단에 헤더 반복
      // (현재 y가 top이면 헤더가 없음)
      if (Math.abs(this.grid.y - this.grid.ctx.contentTopY) < 0.01) {
        this.renderHeader();
      }

      this.renderRow(row, rowH);
    }
  }
}
