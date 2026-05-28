"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, CheckCircle2, ChevronLeft as ChevronLeftSm, ChevronRight, PenLine,
} from "lucide-react";

type LogItem = {
  id: string;
  traineeId: string;
  traineeName: string;
  workDate: string;
  trainingType: string;
  attendance: string;
  totalTime: number;
  content: string;
  taskName: string;
  taskScore: number | null;
  isCompleted: boolean;
};

const TRAINING_LABELS: Record<string, string> = {
  PRE:        "사전훈련",
  FIELD:      "현장훈련",
  ADAPTATION: "적응지도",
};

function pad2(n: number) { return String(n).padStart(2, "0"); }
function nowYM() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export default function LogReviewPage() {
  const router = useRouter();
  const [yearMonth, setYearMonth]     = useState(nowYM());
  const [logs, setLogs]               = useState<LogItem[]>([]);
  const [loading, setLoading]         = useState(false);
  const [expandId, setExpandId]       = useState<string | null>(null);
  const [editId, setEditId]           = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving]           = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [toast, setToast]             = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const load = useCallback(() => {
    setLoading(true);
    const [y, m] = yearMonth.split("-").map(Number);
    const dateFrom = `${yearMonth}-01`;
    const dateTo   = `${yearMonth}-${new Date(y, m, 0).getDate().toString().padStart(2, "0")}`;
    fetch(`/api/worker/logs/list?periodStart=${dateFrom}&periodEnd=${dateTo}`)
      .then(r => r.json())
      .then(d => { if (d.success) setLogs(d.logs); })
      .finally(() => setLoading(false));
  }, [yearMonth]);

  useEffect(() => { load(); }, [load]);

  function changeMonth(delta: number) {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYearMonth(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }

  async function saveContent(id: string, content: string) {
    const res = await fetch(`/api/worker/logs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    return (await res.json()).success;
  }

  async function confirmOne(id: string) {
    setSaving(true);
    const res  = await fetch(`/api/worker/logs/${id}/confirm`, { method: "PATCH" });
    const data = await res.json();
    setSaving(false);
    if (data.success) { showToast("확정되었습니다."); load(); }
    else showToast(data.message || "확정 실패");
  }

  async function saveAndConfirm(id: string) {
    setSaving(true);
    await saveContent(id, editContent);
    const res  = await fetch(`/api/worker/logs/${id}/confirm`, { method: "PATCH" });
    const data = await res.json();
    setSaving(false);
    if (data.success) {
      setEditId(null);
      showToast("저장 및 확정 완료");
      load();
    } else showToast(data.message || "확정 실패");
  }

  async function confirmMonth() {
    const unconfirmed = logs.filter(l => !l.isCompleted);
    if (unconfirmed.length === 0) { showToast("확정할 일지가 없습니다."); return; }
    if (!confirm(`미확정 ${unconfirmed.length}건을 일괄 확정하시겠습니까?\n확정 후에는 수정할 수 없습니다.`)) return;
    setBatchSaving(true);
    const res  = await fetch("/api/worker/logs/confirm-month", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yearMonth }),
    });
    const data = await res.json();
    setBatchSaving(false);
    if (data.success) { showToast(`${data.confirmed}건 확정 완료`); load(); }
    else showToast(data.message || "일괄 확정 실패");
  }

  const confirmed   = logs.filter(l => l.isCompleted).length;
  const unconfirmed = logs.filter(l => !l.isCompleted).length;

  return (
    <div className="min-h-dvh bg-slate-50 pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-4">
        <button onClick={() => router.back()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 active:scale-95">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-base font-black text-slate-900">일지 검토·확정</h1>
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

        {/* 요약 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-center">
            <p className="text-2xl font-black text-emerald-600">{confirmed}</p>
            <p className="mt-0.5 text-xs font-semibold text-emerald-600">확정</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-3 text-center">
            <p className="text-2xl font-black text-amber-600">{unconfirmed}</p>
            <p className="mt-0.5 text-xs font-semibold text-amber-600">미확정</p>
          </div>
        </div>

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
        ) : logs.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
            <p className="text-sm font-semibold text-slate-400">이 달 작성된 일지가 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map(log => {
              const isEdit   = editId === log.id;
              const expanded = expandId === log.id;

              return (
                <div key={log.id}
                  className={`rounded-2xl border bg-white transition ${
                    log.isCompleted ? "border-emerald-100" : "border-slate-100"
                  }`}>
                  {/* 헤더 행 */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-slate-900">{log.traineeName}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                          {TRAINING_LABELS[log.trainingType] ?? log.trainingType}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs font-semibold text-slate-400">
                        {log.workDate} · {log.totalTime}h · {log.attendance}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      {log.isCompleted ? (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-600">
                          <CheckCircle2 className="h-3 w-3" />확정
                        </span>
                      ) : (
                        <>
                          <button onClick={() => { setEditId(log.id); setEditContent(log.content); setExpandId(log.id); }}
                            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 active:scale-95">
                            <PenLine className="h-3 w-3" />수정
                          </button>
                          <button onClick={() => confirmOne(log.id)} disabled={saving}
                            className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-black text-white active:scale-95 disabled:opacity-60">
                            확정
                          </button>
                        </>
                      )}
                      <button onClick={() => setExpandId(expanded ? null : log.id)}
                        className="ml-1 text-xs font-semibold text-slate-400 active:scale-95">
                        {expanded ? "닫기" : "내용"}
                      </button>
                    </div>
                  </div>

                  {/* 내용 펼치기 */}
                  {expanded && (
                    <div className="border-t border-slate-50 px-4 pb-4 pt-3">
                      {isEdit ? (
                        <>
                          <textarea
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                            rows={4}
                            className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 outline-none focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
                          />
                          <div className="mt-2 flex justify-end gap-2">
                            <button onClick={() => setEditId(null)}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 active:scale-95">
                              취소
                            </button>
                            <button onClick={async () => {
                              setSaving(true);
                              await saveContent(log.id, editContent);
                              setSaving(false);
                              setEditId(null);
                              showToast("저장되었습니다.");
                              load();
                            }} disabled={saving}
                              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-black text-white active:scale-95 disabled:opacity-60">
                              {saving ? "..." : "저장"}
                            </button>
                            <button onClick={() => saveAndConfirm(log.id)} disabled={saving}
                              className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-black text-white active:scale-95 disabled:opacity-60">
                              {saving ? "..." : "저장 후 확정"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          {log.taskName && (
                            <p className="mb-1.5 text-xs font-semibold text-slate-500">
                              작업: {log.taskName} {log.taskScore ? `(${log.taskScore}점)` : ""}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                            {log.content || <span className="text-slate-400">내용 없음</span>}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold leading-relaxed text-slate-500">
            · 확정 전 일지 내용을 수정할 수 있습니다.<br />
            · 확정된 일지는 PDF 생성 시 사용됩니다.<br />
            · 확정 후에는 수정이 불가합니다.
          </p>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
