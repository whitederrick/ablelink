"use client";

import { useState } from "react";
import PageHeader from "../../_components/PageHeader";
import { IncomeTaxTableManager } from "../_sections";

export default function IncomeTaxSettingsPage() {
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };
  return (
    <div>
      <PageHeader title="근로소득 간이세액표" sub="홈택스 엑셀 원본 업로드 → 급여 소득세 자동 조회에 사용" />
      <IncomeTaxTableManager onToast={showToast} />
      {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
