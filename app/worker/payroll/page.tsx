"use client";
// app/worker/payroll/page.tsx
// 직무지도원 본인 급여명세서 조회·다운로드 (확정분만)

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Wallet, Download } from "lucide-react";

interface PayItem {
  id: string;
  yearMonth: string;
  agencyName: string;
  grossPay: number;
  totalDeduction: number;
  netPay: number;
  workedDays: number;
  workedMinutes: number;
}

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

export default function WorkerPayrollPage() {
  const router = useRouter();
  const [items, setItems] = useState<PayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/worker/payroll")
      .then(r => r.json())
      .then(d => { if (d.success) setItems(d.items); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-100 bg-white px-4 py-3">
        <button onClick={() => router.push("/worker/home")} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-black text-slate-900">급여명세서</h1>
      </header>

      <div className="mx-auto max-w-lg space-y-3 px-4 py-5">
        {loading ? (
          <p className="py-10 text-center text-sm font-semibold text-slate-400">불러오는 중...</p>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-white py-12 text-center">
            <Wallet className="mx-auto h-10 w-10 text-slate-200" />
            <p className="mt-3 text-sm font-semibold text-slate-400">발급된 급여명세서가 없습니다.</p>
          </div>
        ) : items.map(it => {
          const open = openId === it.id;
          const pdfUrl = `/api/worker/payroll/${it.id}/payslip`;
          return (
            <div key={it.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
              <button onClick={() => setOpenId(open ? null : it.id)} className="w-full px-4 py-3.5 text-left active:bg-slate-50">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black text-slate-900">{it.yearMonth} 급여</p>
                  <p className="text-base font-black text-slate-900">{won(it.netPay)}</p>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs font-semibold text-slate-400">
                  <span>{it.agencyName}</span>
                  <span>실지급액</span>
                </div>
              </button>

              {open && (
                <div className="border-t border-slate-100 bg-slate-50/60 p-3">
                  <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-white p-2.5">
                      <p className="text-[11px] font-semibold text-slate-400">지급 합계</p>
                      <p className="mt-0.5 text-sm font-black text-slate-800">{won(it.grossPay)}</p>
                    </div>
                    <div className="rounded-xl bg-white p-2.5">
                      <p className="text-[11px] font-semibold text-slate-400">공제 합계</p>
                      <p className="mt-0.5 text-sm font-black text-rose-500">{won(it.totalDeduction)}</p>
                    </div>
                    <div className="rounded-xl bg-white p-2.5">
                      <p className="text-[11px] font-semibold text-slate-400">실지급</p>
                      <p className="mt-0.5 text-sm font-black text-emerald-600">{won(it.netPay)}</p>
                    </div>
                  </div>
                  <p className="mb-2 text-center text-[11px] font-semibold text-slate-400">
                    근무 {it.workedDays}일 · {(it.workedMinutes / 60).toFixed(1)}시간
                  </p>
                  <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-slate-950 bg-slate-950 px-4 py-3 text-sm font-black text-white active:scale-[0.98]">
                    <Download className="h-4 w-4" /> 급여명세서 PDF
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
