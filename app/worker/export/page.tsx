"use client";

// 직무지도원 본인 출근부·일지 내보내기 (STARTER+: SHEET_EXPORT)
// 엑셀(.xlsx) / CSV, 기간 선택. PDF(STANDARD) 대신 데이터 파일로 받는 경로.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Download, FileSpreadsheet, ClipboardList, BookOpen } from "lucide-react";

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function WorkerExportPage() {
  const router = useRouter();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayStr());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function download(type: "attendance" | "logs", format: "xlsx" | "csv") {
    if (busy) return;
    if (from > to) { setError("시작일이 종료일보다 늦습니다."); return; }
    setBusy(`${type}-${format}`);
    setError("");
    try {
      const res = await fetch(`/api/worker/export?type=${type}&format=${format}&from=${from}&to=${to}`, { cache: "no-store" });
      if (res.status === 401) { router.push("/worker/login"); return; }
      if (res.status === 403) {
        const j = await res.json().catch(() => ({}));
        setError(j.message || "내보내기는 스타터 플랜 이상에서 사용 가능합니다.");
        return;
      }
      if (!res.ok) { setError("내보내기에 실패했습니다. 잠시 후 다시 시도해주세요."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type === "attendance" ? "출근부" : "일지"}_${from}_${to}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("네트워크 오류로 내보내지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 헤더 */}
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-100 bg-white px-4 py-3">
        <button onClick={() => router.push("/worker/home")} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 active:scale-95" aria-label="홈">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="text-[16px] font-black text-slate-900">내보내기</h1>
      </header>

      <div className="space-y-4 px-4 py-5 pb-24">
        <p className="text-[13px] font-semibold leading-relaxed text-slate-500">
          내 출근부·일지를 <span className="font-black text-slate-700">엑셀 또는 CSV 파일</span>로 휴대폰에 저장합니다.
          기간을 선택한 뒤 받을 형식을 누르세요.
        </p>

        {/* 기간 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-[13px] font-black text-slate-700">기간</p>
          <div className="flex items-center gap-2">
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] font-semibold text-slate-900 outline-none focus:border-sky-400 focus:bg-white" />
            <span className="text-slate-400">~</span>
            <input type="date" value={to} min={from} max={todayStr()} onChange={e => setTo(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] font-semibold text-slate-900 outline-none focus:border-sky-400 focus:bg-white" />
          </div>
          <p className="mt-2 text-[11px] font-semibold text-slate-400">최근 1년 내 기록만 받을 수 있어요.</p>
        </div>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-700">
            {error}
          </div>
        )}

        {/* 출근부 */}
        <ExportCard
          icon={ClipboardList} title="출근부" desc="월별 출퇴근 기록"
          busy={busy} type="attendance" onDownload={download}
        />
        {/* 일지 */}
        <ExportCard
          icon={BookOpen} title="일지" desc="훈련생별 작성 일지"
          busy={busy} type="logs" onDownload={download}
        />
      </div>
    </div>
  );
}

function ExportCard({ icon: Icon, title, desc, busy, type, onDownload }: {
  icon: any; title: string; desc: string; busy: string;
  type: "attendance" | "logs";
  onDownload: (type: "attendance" | "logs", format: "xlsx" | "csv") => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[15px] font-black text-slate-900">{title}</p>
          <p className="text-[12px] font-semibold text-slate-400">{desc}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onDownload(type, "xlsx")}
          disabled={!!busy}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-3 text-[13px] font-black text-white transition active:scale-95 disabled:opacity-50"
        >
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          {busy === `${type}-xlsx` ? "받는 중..." : "엑셀(.xlsx)"}
        </button>
        <button
          onClick={() => onDownload(type, "csv")}
          disabled={!!busy}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-3 text-[13px] font-black text-slate-600 transition active:scale-95 disabled:opacity-50"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {busy === `${type}-csv` ? "받는 중..." : "CSV"}
        </button>
      </div>
    </div>
  );
}
