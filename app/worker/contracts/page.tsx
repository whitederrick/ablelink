"use client";
// app/worker/contracts/page.tsx
// 직무지도원 본인 근로계약서 조회·히스토리 + PDF

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, FileText, Download, PenLine } from "lucide-react";

type ContractStatus = "PENDING" | "SIGNED" | "COMPLETED" | "CANCELLED";

interface ContractRow {
  id: string;
  agencyName: string;
  status: ContractStatus;
  contractStart: string;
  contractEnd: string;
  workLocation: string;
  workerSignedAt: string | null;
  createdAt: string;
  signToken: string | null;
}

const STATUS_META: Record<ContractStatus, { label: string; cls: string }> = {
  PENDING:   { label: "서명 대기",  cls: "bg-amber-50 text-amber-600" },
  SIGNED:    { label: "서명 완료",  cls: "bg-sky-50 text-sky-600" },
  COMPLETED: { label: "계약 완료",  cls: "bg-emerald-50 text-emerald-600" },
  CANCELLED: { label: "취소",       cls: "bg-slate-100 text-slate-500" },
};

export default function WorkerContractsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/worker/contracts/list")
      .then(r => r.json())
      .then(d => { if (d.success) setRows(d.items); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-100 bg-white px-4 py-3">
        <button onClick={() => router.push("/worker/home")} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-black text-slate-900">내 근로계약서</h1>
      </header>

      <div className="mx-auto max-w-lg space-y-3 px-4 py-5">
        {loading ? (
          <p className="py-10 text-center text-sm font-semibold text-slate-400">불러오는 중...</p>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-white py-12 text-center">
            <FileText className="mx-auto h-10 w-10 text-slate-200" />
            <p className="mt-3 text-sm font-semibold text-slate-400">근로계약서가 없습니다.</p>
          </div>
        ) : rows.map(c => {
          const st = STATUS_META[c.status];
          const open = openId === c.id;
          const pdfUrl = `/api/worker/contracts/${c.id}?format=pdf`;
          return (
            <div key={c.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
              <button onClick={() => setOpenId(open ? null : c.id)} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-black text-slate-900">{c.agencyName}</p>
                    <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${st.cls}`}>{st.label}</span>
                  </div>
                  <p className="mt-0.5 text-xs font-semibold text-slate-400">{c.contractStart} ~ {c.contractEnd}</p>
                  {c.workLocation && <p className="mt-0.5 truncate text-xs text-slate-400">근무지: {c.workLocation}</p>}
                </div>
              </button>

              {open && (
                <div className="border-t border-slate-100 bg-slate-50/60 p-3">
                  {c.status === "PENDING" && c.signToken ? (
                    <a href={`/contract/${c.signToken}`} className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-white active:scale-[0.98]">
                      <PenLine className="h-4 w-4" /> 서명하러 가기
                    </a>
                  ) : (
                    <>
                      <iframe src={pdfUrl} className="h-[60vh] w-full rounded-xl border border-slate-200 bg-white" title="계약서 미리보기" />
                      <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-slate-950 bg-slate-950 px-4 py-3 text-sm font-black text-white active:scale-[0.98]">
                        <Download className="h-4 w-4" /> PDF 보기 / 다운로드
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
