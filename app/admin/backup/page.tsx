"use client";

// 시스템 운영자 전체 데이터 백업 — 보관 1년 경과분 안전망.
// 고객 화면 export는 1년 제한이지만, 운영자 백업은 전 기간·전 에이전시(제한 없음).

import { useState } from "react";
import { Download, FileSpreadsheet, Database } from "lucide-react";
import PageHeader from "../_components/PageHeader";

export default function AdminBackupPage() {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  async function download(type: "attendance" | "logs", format: "xlsx" | "csv") {
    if (busy) return;
    setBusy(`${type}-${format}`); setMsg("");
    try {
      const res = await fetch(`/api/admin/system/backup?type=${type}&format=${format}`, { cache: "no-store" });
      if (!res.ok) { setMsg("백업 생성에 실패했습니다."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `백업_${type === "attendance" ? "근태" : "일지"}_전체_${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setMsg("네트워크 오류로 백업하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div>
      <PageHeader
        title="데이터 백업"
        sub="전 에이전시의 출근부·일지를 전 기간(보관 제한 없음)으로 내려받습니다."
      />

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <Database className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p className="font-semibold leading-relaxed">
          고객 화면의 내보내기는 보관 1년으로 제한됩니다. 1년 경과분이 사라지지 않도록 운영자가 주기적으로 전체 백업을 받아 보관하세요(고객 비노출).
        </p>
      </div>

      <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        <BackupCard title="근태(출근부) 전체" desc="전 에이전시 DailyAttendance" type="attendance" busy={busy} onDownload={download} />
        <BackupCard title="일지 전체" desc="전 에이전시 TraineeLog" type="logs" busy={busy} onDownload={download} />
      </div>

      {msg && <p className="mt-4 text-sm font-semibold text-rose-600">{msg}</p>}
    </div>
  );
}

function BackupCard({ title, desc, type, busy, onDownload }: {
  title: string; desc: string; type: "attendance" | "logs"; busy: string;
  onDownload: (type: "attendance" | "logs", format: "xlsx" | "csv") => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-base font-black text-slate-900">{title}</p>
      <p className="mb-3 text-xs font-semibold text-slate-400">{desc}</p>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => onDownload(type, "xlsx")} disabled={!!busy}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-50">
          <FileSpreadsheet className="h-4 w-4" />{busy === `${type}-xlsx` ? "생성 중..." : "엑셀"}
        </button>
        <button onClick={() => onDownload(type, "csv")} disabled={!!busy}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-black text-slate-600 active:scale-95 disabled:opacity-50">
          <Download className="h-4 w-4" />{busy === `${type}-csv` ? "생성 중..." : "CSV"}
        </button>
      </div>
    </div>
  );
}
