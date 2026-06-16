"use client";

import { useState } from "react";
import PageHeader from "../../_components/PageHeader";
import { InsuranceRatesManager } from "../_sections";

export default function InsuranceRatesSettingsPage() {
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };
  return (
    <div>
      <PageHeader title="4대보험 요율" sub="연도별 4대보험·산재 요율을 등록하여 급여 공제 자동 산정에 사용합니다." />
      <InsuranceRatesManager onToast={showToast} />
      {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
