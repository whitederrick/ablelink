// app/admin/_styles.ts — 관리자 페이지 공통 스타일
import type { CSSProperties } from "react";

export function sharedStyles() {
  return {
    pageTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: "#111827", letterSpacing: "-0.3px" } as CSSProperties,
    pageSub:   { margin: "3px 0 0", fontSize: 13, color: "#9ca3af" } as CSSProperties,

    input: {
      flex: 1, height: 38, border: "1px solid #e5e7eb", borderRadius: 8,
      padding: "0 12px", fontSize: 13, outline: "none", background: "#fff",
      color: "#111827", fontFamily: "inherit",
    } as CSSProperties,

    btnPrimary: {
      padding: "9px 18px", background: "#2563eb", color: "#fff", border: "none",
      borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
    } as CSSProperties,
    btnSecondary: {
      padding: "9px 14px", background: "#fff", color: "#374151",
      border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13,
      fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
    } as CSSProperties,
    btnDanger: {
      padding: "7px 14px", background: "#fff", color: "#dc2626",
      border: "1px solid #fecaca", borderRadius: 8, fontSize: 13,
      fontWeight: 500, cursor: "pointer",
    } as CSSProperties,

    tableWrap: {
      background: "#fff", border: "1px solid #f0f0f0",
      borderRadius: 12, overflow: "hidden",
    } as CSSProperties,
    table: { width: "100%", borderCollapse: "collapse" } as CSSProperties,
    th: {
      textAlign: "left", padding: "10px 16px", fontSize: 11, fontWeight: 600,
      color: "#9ca3af", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap",
      letterSpacing: "0.3px", textTransform: "uppercase", background: "#fafafa",
    } as CSSProperties,
    tr: { borderBottom: "1px solid #f9f9f9" } as CSSProperties,
    td: { padding: "12px 16px", fontSize: 13, color: "#374151", verticalAlign: "middle" } as CSSProperties,
    tdCenter: { padding: "32px 16px", fontSize: 13, color: "#d1d5db", textAlign: "center" } as CSSProperties,

    badge: {
      display: "inline-flex", alignItems: "center",
      padding: "2px 8px", borderRadius: 20,
      fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
    } as CSSProperties,

    summaryGrid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 } as CSSProperties,
    summaryCard: {
      background: "#fff", border: "1px solid #f0f0f0",
      borderRadius: 12, padding: "16px 20px", textAlign: "center",
    } as CSSProperties,
    summaryNum: { fontSize: 28, fontWeight: 800, margin: "0 0 4px" } as CSSProperties,
    summaryLabel: { fontSize: 12, color: "#9ca3af", margin: 0 } as CSSProperties,

    card: {
      background: "#fff", border: "1px solid #f0f0f0",
      borderRadius: 12, padding: "18px 20px",
    } as CSSProperties,
    empty: { textAlign: "center", color: "#d1d5db", padding: "40px 0", fontSize: 13 } as CSSProperties,
  };
}
