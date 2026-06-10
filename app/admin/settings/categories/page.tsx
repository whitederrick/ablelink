"use client";

import { useState } from "react";
import PageHeader from "../../_components/PageHeader";
import { AnnouncementCategoryManager } from "../_sections";

export default function AnnouncementCategorySettingsPage() {
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };
  return (
    <div>
      <PageHeader title="공지 카테고리 관리" sub="매니저 공지 작성 시 선택하는 카테고리를 전역 관리" />
      <AnnouncementCategoryManager onToast={showToast} />
      {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
