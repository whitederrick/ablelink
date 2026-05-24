// app/admin/_styles.ts — 관리자 페이지 공통 Tailwind 클래스 상수

export const T = {
  pageTitle: "text-lg font-black text-slate-900",
  pageSub:   "mt-0.5 text-sm font-semibold text-slate-400",

  input: "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100",
  select: "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400",

  btnPrimary:   "rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white transition hover:bg-slate-800 active:scale-95 disabled:opacity-60 whitespace-nowrap",
  btnSecondary: "rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95 whitespace-nowrap",
  btnDanger:    "rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 active:scale-95",

  tableWrap: "rounded-2xl border border-slate-200 bg-white overflow-hidden",
  th: "border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-left text-[11px] font-black uppercase tracking-wider text-slate-400 whitespace-nowrap",
  trBase: "border-b border-slate-50 last:border-b-0",
  td: "px-4 py-3 text-sm text-slate-700 align-middle",
  tdCenter: "px-4 py-10 text-center text-sm font-semibold text-slate-300",
  empty: "px-4 py-10 text-center text-sm font-semibold text-slate-300",

  badge: "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black whitespace-nowrap",

  summaryGrid: "grid grid-cols-4 gap-3.5 mb-5",
  summaryCard: "rounded-2xl border border-slate-100 bg-white p-4 text-center",
  summaryNum:  "text-3xl font-black leading-none",
  summaryLabel:"mt-1 text-xs font-semibold text-slate-400",

  card: "rounded-2xl border border-slate-200 bg-white p-5",

  modalOverlay: "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4",
  modalContent: "w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-7 shadow-2xl shadow-slate-950/20",

  label: "mb-1.5 block text-xs font-black text-slate-700",
};
