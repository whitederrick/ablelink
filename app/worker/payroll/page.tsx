"use client";
// app/worker/payroll/page.tsx
// 직무지도원 본인 급여명세서 조회·다운로드 (확정분만)
//  · 상단: 최근 월별 실지급 추이(막대)
//  · 카드: 지급/공제/실지급 요약 + 지급내역·공제내역 항목별 인앱 표시 + PDF 다운로드

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Wallet, Download } from "lucide-react";
import type { PayrollBreakdown } from "@/lib/payroll/breakdown";

interface PayItem {
  id: string;
  yearMonth: string;
  agencyName: string;
  grossPay: number;
  totalDeduction: number;
  netPay: number;
  workedDays: number;
  workedMinutes: number;
  breakdown?: PayrollBreakdown;
}

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

export default function WorkerPayrollPage() {
  const router = useRouter();
  const [items, setItems] = useState<PayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // P3: 로드 실패를 '빈 상태'로 위장하지 않고 재시도 안내
  const [openId, setOpenId] = useState<string | null>(null);

  const runFetch = () => {
    fetch("/api/worker/payroll")
      .then(async r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { if (d.success) setItems(d.items); else throw new Error(); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  const load = () => { setLoading(true); setError(false); runFetch(); }; // 재시도(사용자 이벤트)
  useEffect(() => { runFetch(); }, []); // 초기 로드 — loading/error는 이미 초기값이라 동기 setState 불필요

  // 최근 6개월 실지급 추이(오래된→최근, 좌→우 읽기). items는 최신순.
  const trend = [...items].slice(0, 6).reverse();
  const maxNet = Math.max(1, ...trend.map(t => t.netPay));

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
        ) : error ? (
          <div className="rounded-2xl border border-rose-100 bg-white py-12 text-center">
            <p className="text-sm font-semibold text-rose-500">급여명세서를 불러오지 못했습니다.</p>
            <button onClick={load} className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white active:scale-95">다시 시도</button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-white py-12 text-center">
            <Wallet className="mx-auto h-10 w-10 text-slate-200" />
            <p className="mt-3 text-sm font-semibold text-slate-400">발급된 급여명세서가 없습니다.</p>
          </div>
        ) : (
          <>
            {/* 월별 실지급 추이 */}
            {trend.length >= 2 && (
              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <p className="mb-3 text-xs font-black text-slate-500">최근 실지급 추이</p>
                <div className="space-y-2">
                  {trend.map(t => (
                    <div key={t.id} className="flex items-center gap-2">
                      <span className="w-14 shrink-0 text-[11px] font-bold text-slate-500">{t.yearMonth.slice(2)}</span>
                      <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(4, (t.netPay / maxNet) * 100)}%` }} />
                      </div>
                      <span className="w-24 shrink-0 text-right text-[12px] font-black text-slate-800">{won(t.netPay)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {items.map(it => {
              const open = openId === it.id;
              const pdfUrl = `/api/worker/payroll/${it.id}/payslip`;
              const payLines = Array.isArray(it.breakdown?.payLines) ? it.breakdown!.payLines!.filter(l => Number(l.amount) > 0) : [];
              const deductLines = Array.isArray(it.breakdown?.deductLines) ? it.breakdown!.deductLines!.filter(l => Number(l.amount) > 0) : [];
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

                      {/* 지급내역 항목 */}
                      {payLines.length > 0 && (
                        <div className="mb-2 rounded-xl bg-white p-3">
                          <p className="mb-1.5 text-[11px] font-black text-slate-500">지급내역</p>
                          <div className="space-y-1">
                            {payLines.map((l, i) => (
                              <div key={i} className="flex items-center justify-between text-[13px]">
                                <span className="font-semibold text-slate-600">{l.name}</span>
                                <span className="font-bold text-slate-800">{won(Number(l.amount))}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 공제내역 항목 */}
                      {deductLines.length > 0 && (
                        <div className="mb-2 rounded-xl bg-white p-3">
                          <p className="mb-1.5 text-[11px] font-black text-slate-500">공제내역</p>
                          <div className="space-y-1">
                            {deductLines.map((l, i) => (
                              <div key={i} className="flex items-center justify-between text-[13px]">
                                <span className="font-semibold text-slate-600">{l.name}</span>
                                <span className="font-bold text-rose-500">-{won(Number(l.amount))}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

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
          </>
        )}
      </div>
    </div>
  );
}
