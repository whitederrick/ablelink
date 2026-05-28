"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, CheckCircle2, Clock, AlertTriangle, ChevronLeft as ChevronLeftSm, ChevronRight } from "lucide-react";

type AttRec = {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  isFinalClosed: boolean;
  isGpsModified: boolean;
  status: string;
};

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function pad2(n: number) { return String(n).padStart(2, "0"); }
function nowYM() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function calcHours(start: string, end: string): string {
  if (!start || !end) return "-";
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) return "-";
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function dayOfWeek(dateStr: string): string {
  return DOW[new Date(dateStr + "T00:00:00").getDay()];
}

export default function AttendanceReviewPage() {
  const router = useRouter();
  const [yearMonth, setYearMonth]   = useState(nowYM());
  const [records, setRecords]       = useState<AttRec[]>([]);
  const [loading, setLoading]       = useState(false);
  const [editId, setEditId]         = useState<string | null>(null);
  const [editStart, setEditStart]   = useState("");
  const [editEnd, setEditEnd]       = useState("");
  const [saving, setSaving]         = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [toast, setToast]           = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/worker/attendance/monthly?yearMonth=${yearMonth}`)
      .then(r => r.json())
      .then(d => { if (d.success) setRecords(d.records); })
      .finally(() => setLoading(false));
  }, [yearMonth]);

  useEffect(() => { load(); }, [load]);

  function changeMonth(delta: number) {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYearMonth(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }

  function openEdit(rec: AttRec) {
    if (rec.isFinalClosed) return;
    setEditId(rec.id);
    setEditStart(rec.startTime);
    setEditEnd(rec.endTime);
  }

  async function confirmOne(id: string, startTime?: string, endTime?: string) {
    setSaving(true);
    const body: any = {};
    if (startTime) body.startTime = startTime;
    if (endTime)   body.endTime   = endTime;
    const res  = await fetch(`/api/worker/attendance/${id}/confirm`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSaving(false);
    if (data.success) {
      setEditId(null);
      showToast("확정되었습니다.");
      load();
    } else {
      showToast(data.message || "확정 실패");
    }
  }

  async function confirmMonth() {
    const unconfirmed = records.filter(r => !r.isFinalClosed && r.startTime);
    if (unconfirmed.length === 0) { showToast("확정할 기록이 없습니다."); return; }
    if (!confirm(`미확정 ${unconfirmed.length}건을 일괄 확정하시겠습니까?\n확정 후에는 수정할 수 없습니다.`)) return;
    setBatchSaving(true);
    const res  = await fetch("/api/worker/attendance/confirm-month", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yearMonth }),
    });
    const data = await res.json();
    setBatchSaving(false);
    if (data.success) { showToast(`${data.confirmed}건 확정 완료`); load(); }
    else showToast(data.message || "일괄 확정 실패");
  }

  const confirmed   = records.filter(r => r.isFinalClosed).length;
  const unconfirmed = records.filter(r => !r.isFinalClosed && r.startTime).length;
  const absent      = records.filter(r => !r.startTime).length;

  return (
    <div className="min-h-dvh bg-slate-50 pb-24">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-4">
        <button onClick={() => router.back()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 active:scale-95">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-base font-black text-slate-900">출근부 검토·확정</h1>
      </header>

      <div className="mx-auto max-w-md space-y-3 px-4 py-4">
        {/* 월 선택 */}
        <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-5 py-3">
          <button onClick={() => changeMonth(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 active:scale-95">
            <ChevronLeftSm className="h-4 w-4" />
          </button>
          <span className="text-base font-black text-slate-900">{yearMonth.replace("-", "년 ")}월</span>
          <button onClick={() => changeMonth(1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 active:scale-95">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* 요약 카드 */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "확정", value: confirmed,   color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
            { label: "미확정", value: unconfirmed, color: "text-amber-600 bg-amber-50 border-amber-100" },
            { label: "미출근", value: absent,      color: "text-slate-400 bg-slate-50 border-slate-100" },
          ].map(c => (
            <div key={c.label} className={`rounded-2xl border px-3 py-3 text-center ${c.color}`}>
              <p className="text-2xl font-black">{c.value}</p>
              <p className="mt-0.5 text-xs font-semibold">{c.label}</p>
            </div>
          ))}
        </div>

        {/* 일괄 확정 버튼 */}
        {unconfirmed > 0 && (
          <button onClick={confirmMonth} disabled={batchSaving}
            className="w-full rounded-2xl bg-slate-950 py-4 text-sm font-black text-white active:scale-[0.98] disabled:opacity-60">
            {batchSaving ? "처리 중..." : `미확정 ${unconfirmed}건 월 일괄 확정`}
          </button>
        )}

        {/* 목록 */}
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
          </div>
        ) : records.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
            <p className="text-sm font-semibold text-slate-400">이 달 출근 기록이 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {records.map(rec => {
              const dow    = dayOfWeek(rec.workDate);
              const isWeek = dow === "토" || dow === "일";
              const isEdit = editId === rec.id;
              const hours  = calcHours(rec.startTime, rec.endTime);

              return (
                <div key={rec.id}
                  className={`rounded-2xl border bg-white px-4 py-3 transition ${
                    rec.isFinalClosed ? "border-emerald-100" : "border-slate-100"
                  }`}>
                  <div className="flex items-center gap-3">
                    {/* 날짜 */}
                    <div className="w-14 flex-shrink-0 text-center">
                      <p className={`text-lg font-black leading-none ${isWeek ? "text-rose-500" : "text-slate-900"}`}>
                        {rec.workDate.slice(8)}
                      </p>
                      <p className={`mt-0.5 text-[11px] font-semibold ${isWeek ? "text-rose-400" : "text-slate-400"}`}>
                        {dow}요일
                      </p>
                    </div>

                    {/* 시간 */}
                    <div className="flex-1">
                      {rec.startTime ? (
                        isEdit ? (
                          <div className="flex items-center gap-2">
                            <input type="time" value={editStart} onChange={e => setEditStart(e.target.value)}
                              className="h-8 w-24 rounded-lg border border-slate-200 px-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" />
                            <span className="text-xs text-slate-400">~</span>
                            <input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)}
                              className="h-8 w-24 rounded-lg border border-slate-200 px-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                            <span className="text-sm font-semibold text-slate-700">
                              {rec.startTime} ~ {rec.endTime || "퇴근 전"}
                            </span>
                            {hours !== "-" && (
                              <span className="text-xs font-semibold text-slate-400">({hours})</span>
                            )}
                          </div>
                        )
                      ) : (
                        <span className="text-sm font-semibold text-slate-400">미출근</span>
                      )}
                      {rec.isGpsModified && (
                        <div className="mt-1 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                          <span className="text-[11px] font-semibold text-amber-600">GPS 수동 조정</span>
                        </div>
                      )}
                    </div>

                    {/* 상태/버튼 */}
                    <div className="flex-shrink-0">
                      {rec.isFinalClosed ? (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-600">
                          <CheckCircle2 className="h-3 w-3" />확정
                        </span>
                      ) : rec.startTime ? (
                        isEdit ? (
                          <div className="flex gap-1.5">
                            <button onClick={() => setEditId(null)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-500 active:scale-95">
                              취소
                            </button>
                            <button onClick={() => confirmOne(rec.id, editStart, editEnd)} disabled={saving}
                              className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-black text-white active:scale-95 disabled:opacity-60">
                              {saving ? "..." : "확정"}
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => openEdit(rec)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 active:scale-95">
                            수정·확정
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 안내 */}
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold leading-relaxed text-slate-500">
            · 확정 전 출퇴근 시간을 수정할 수 있습니다.<br />
            · 확정 후에는 수정이 불가합니다.<br />
            · 미확정 기록은 익일 자정에 자동 확정됩니다.
          </p>
        </div>
      </div>

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
