"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";

type ReviewRow = {
  workerId: string;
  workerName: string;
  phoneNumber: string;
  siteName: string;
  attendance:  { total: number; confirmed: number };
  logs:        { total: number; confirmed: number };
  evaluations: { total: number; confirmed: number };
};

function pad2(n: number) { return String(n).padStart(2, "0"); }
function nowYM() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function ProgressBadge({ confirmed, total }: { confirmed: number; total: number }) {
  if (total === 0) return <span className="text-xs font-semibold text-slate-300">-</span>;
  const done = confirmed >= total;
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-black ${
      done ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
    }`}>
      {confirmed}/{total}
    </span>
  );
}

type RejectModal = { workerId: string; workerName: string } | null;

export default function AdminReviewPage() {
  const [yearMonth, setYearMonth]   = useState(nowYM());
  const [rows, setRows]             = useState<ReviewRow[]>([]);
  const [loading, setLoading]       = useState(false);
  const [rejectModal, setRejectModal] = useState<RejectModal>(null);
  const [rejectMsg, setRejectMsg]   = useState("");
  const [sending, setSending]       = useState(false);
  const [toast, setToast]           = useState("");

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 2500); }

  async function sendReject() {
    if (!rejectModal || !rejectMsg.trim()) return;
    setSending(true);
    const res  = await fetch("/api/admin/notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workerId:    rejectModal.workerId,
        title:     `[반려] ${yearMonth} 기록 수정 요청`,
        body:      rejectMsg.trim(),
        type:      "REJECT",
        yearMonth,
      }),
    });
    const data = await res.json();
    setSending(false);
    if (data.success) {
      setRejectModal(null);
      setRejectMsg("");
      showToast(`${rejectModal.workerName}에게 반려 알림을 발송했습니다.`);
    } else {
      showToast(data.message || "발송 실패");
    }
  }

  function changeMonth(delta: number) {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYearMonth(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/review?yearMonth=${yearMonth}`)
      .then(r => r.json())
      .then(d => { if (d.success) setRows(d.rows); })
      .finally(() => setLoading(false));
  }, [yearMonth]);

  const fullyDone = rows.filter(r =>
    r.attendance.confirmed >= r.attendance.total &&
    r.logs.confirmed >= r.logs.total &&
    (r.evaluations.total === 0 || r.evaluations.confirmed >= r.evaluations.total)
  ).length;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">확정 현황</h1>
          <p className="mt-1 text-sm font-semibold text-slate-400">직무지도원별 출근부·일지·평가 확정 상태</p>
        </div>
        {/* 월 선택 */}
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <button onClick={() => changeMonth(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[80px] text-center text-sm font-black text-slate-900">
            {yearMonth.replace("-", "년 ")}월
          </span>
          <button onClick={() => changeMonth(1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 요약 */}
      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-100 bg-white px-4 py-4 text-center">
            <p className="text-2xl font-black text-slate-900">{rows.length}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">직무지도원 수</p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-center">
            <p className="text-2xl font-black text-emerald-600">{fullyDone}</p>
            <p className="mt-1 text-xs font-semibold text-emerald-500">전체 확정 완료</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-center">
            <p className="text-2xl font-black text-amber-600">{rows.length - fullyDone}</p>
            <p className="mt-1 text-xs font-semibold text-amber-500">미확정 있음</p>
          </div>
        </div>
      )}

      {/* 테이블 */}
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <p className="text-sm font-semibold text-slate-400">해당 기간에 데이터가 없습니다.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 text-left text-xs font-black text-slate-500">직무지도원</th>
                <th className="px-4 py-3 text-left text-xs font-black text-slate-500">사업체</th>
                <th className="px-4 py-3 text-center text-xs font-black text-slate-500">출근부</th>
                <th className="px-4 py-3 text-center text-xs font-black text-slate-500">일지</th>
                <th className="px-4 py-3 text-center text-xs font-black text-slate-500">종합평가</th>
                <th className="px-4 py-3 text-center text-xs font-black text-slate-500">상태</th>
                <th className="px-4 py-3 text-center text-xs font-black text-slate-500">반려</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(r => {
                const allDone =
                  r.attendance.confirmed >= r.attendance.total &&
                  r.logs.confirmed >= r.logs.total &&
                  (r.evaluations.total === 0 || r.evaluations.confirmed >= r.evaluations.total);
                return (
                  <tr key={r.workerId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-black text-slate-900">{r.workerName}</p>
                      <p className="text-xs font-semibold text-slate-400">{r.phoneNumber}</p>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-600">{r.siteName}</td>
                    <td className="px-4 py-3 text-center">
                      <ProgressBadge confirmed={r.attendance.confirmed} total={r.attendance.total} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ProgressBadge confirmed={r.logs.confirmed} total={r.logs.total} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ProgressBadge confirmed={r.evaluations.confirmed} total={r.evaluations.total} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${
                        allDone ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                      }`}>
                        {allDone ? "완료" : "미완료"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => { setRejectModal({ workerId: r.workerId, workerName: r.workerName }); setRejectMsg(""); }}
                        className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-black text-rose-600 hover:bg-rose-100 active:scale-95"
                      >
                        <AlertTriangle className="h-3 w-3" />반려
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
        <p className="text-xs font-semibold leading-relaxed text-slate-500">
          · 직무지도원이 직접 확정한 기록만 집계됩니다.<br />
          · 출근부 미확정은 익일 자정에 자동 확정 처리됩니다.<br />
          · 확정/전체 형식으로 표시됩니다.
        </p>
      </div>

      {/* 반려 모달 */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-base font-black text-slate-900">반려 알림 발송</h3>
            <p className="mb-4 text-sm font-semibold text-slate-400">
              {rejectModal.workerName}에게 수정 요청 메시지를 보냅니다. ({yearMonth})
            </p>
            <textarea
              value={rejectMsg}
              onChange={e => setRejectMsg(e.target.value)}
              placeholder="수정이 필요한 내용을 입력하세요 (예: 5월 3일 퇴근 시간 누락)"
              rows={4}
              className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none focus:border-rose-400 focus:bg-white focus:ring-2 focus:ring-rose-100"
            />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setRejectModal(null)}
                className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-500 hover:bg-slate-50">
                취소
              </button>
              <button onClick={sendReject} disabled={sending || !rejectMsg.trim()}
                className="flex-[2] rounded-xl bg-rose-600 py-3 text-sm font-black text-white hover:bg-rose-700 disabled:opacity-60">
                {sending ? "발송 중..." : "반려 알림 발송"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
