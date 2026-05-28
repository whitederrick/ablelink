"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, CheckCircle2, Clock, AlertTriangle,
  ChevronLeft as ChevronLeftSm, ChevronRight,
  PenLine, X, Loader2,
} from "lucide-react";

type AttRec = {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  isFinalClosed: boolean;
  isGpsModified: boolean;
  status: string;
};

type EditReq = {
  id: string;
  attendanceId: string;
  reason: string;
  proposedStart: string | null;
  proposedEnd: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminNote: string | null;
  createdAt: string;
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
  const [editReqs, setEditReqs]     = useState<EditReq[]>([]);
  const [loading, setLoading]       = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [toast, setToast]           = useState("");

  // 수정 요청 모달 상태
  const [reqModal, setReqModal] = useState<{
    rec: AttRec;
    proposedStart: string;
    proposedEnd: string;
    reason: string;
    submitting: boolean;
  } | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    const [y, m] = yearMonth.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    Promise.all([
      fetch(`/api/worker/attendance/monthly?yearMonth=${yearMonth}`).then(r => r.json()),
      fetch(`/api/worker/attendance/edit-request`).then(r => r.json()),
    ]).then(([attRes, reqRes]) => {
      if (attRes.success) setRecords(attRes.records);
      if (reqRes.success) setEditReqs(reqRes.requests);
    }).finally(() => setLoading(false));
  }, [yearMonth]);

  useEffect(() => { load(); }, [load]);

  function changeMonth(delta: number) {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYearMonth(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }

  async function confirmOne(id: string) {
    const res = await fetch(`/api/worker/attendance/${id}/confirm`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.success) { showToast("확정되었습니다."); load(); }
    else showToast(data.message || "확정 실패");
  }

  async function confirmMonth() {
    const unconfirmed = records.filter(r => !r.isFinalClosed && r.startTime);
    if (unconfirmed.length === 0) { showToast("확정할 기록이 없습니다."); return; }
    if (!confirm(`미확정 ${unconfirmed.length}건을 일괄 확정하시겠습니까?`)) return;
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

  async function submitEditReq() {
    if (!reqModal) return;
    if (!reqModal.reason.trim()) { showToast("수정 사유를 입력해주세요."); return; }
    setReqModal(m => m ? { ...m, submitting: true } : null);
    const res = await fetch("/api/worker/attendance/edit-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attendanceId: reqModal.rec.id,
        reason:       reqModal.reason.trim(),
        proposedStart: reqModal.proposedStart || null,
        proposedEnd:   reqModal.proposedEnd   || null,
      }),
    });
    const data = await res.json();
    setReqModal(null);
    if (data.success) { showToast(data.message); load(); }
    else showToast(data.message || "요청 실패");
  }

  // 해당 출근 기록의 최근 수정 요청 찾기
  function getReq(attendanceId: string): EditReq | undefined {
    return editReqs.filter(r => r.attendanceId === attendanceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  const confirmed   = records.filter(r => r.isFinalClosed).length;
  const unconfirmed = records.filter(r => !r.isFinalClosed && r.startTime).length;
  const absent      = records.filter(r => !r.startTime).length;
  const pendingReqs = editReqs.filter(r => r.status === "PENDING").length;

  return (
    <div className="min-h-dvh bg-slate-50 pb-24">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-4">
        <button onClick={() => router.back()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 active:scale-95">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-base font-black text-slate-900">출근부 검토·확정</h1>
        {pendingReqs > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-700">
            승인 대기 {pendingReqs}
          </span>
        )}
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

        {/* 일괄 확정 */}
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
              const hours  = calcHours(rec.startTime, rec.endTime);
              const req    = getReq(rec.id);

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
                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                          <span className="text-sm font-semibold text-slate-700">
                            {rec.startTime} ~ {rec.endTime || "퇴근 전"}
                          </span>
                          {hours !== "-" && (
                            <span className="text-xs font-semibold text-slate-400">({hours})</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm font-semibold text-slate-400">미출근</span>
                      )}
                      {rec.isGpsModified && (
                        <div className="mt-1 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                          <span className="text-[11px] font-semibold text-amber-600">GPS 수동 조정됨</span>
                        </div>
                      )}
                      {/* 수정 요청 상태 표시 */}
                      {req && (
                        <div className={`mt-1 rounded-lg px-2 py-1 text-[11px] font-semibold inline-flex items-center gap-1 ${
                          req.status === "PENDING"  ? "bg-amber-50 text-amber-700" :
                          req.status === "APPROVED" ? "bg-emerald-50 text-emerald-700" :
                                                      "bg-rose-50 text-rose-700"
                        }`}>
                          {req.status === "PENDING"  && "⏳ 수정 승인 대기 중"}
                          {req.status === "APPROVED" && "✓ 수정 승인됨"}
                          {req.status === "REJECTED" && "✗ 수정 반려됨"}
                          {req.adminNote && <span className="text-[10px] opacity-70">— {req.adminNote}</span>}
                        </div>
                      )}
                    </div>

                    {/* 버튼 */}
                    <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                      {rec.isFinalClosed ? (
                        <>
                          <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-600">
                            <CheckCircle2 className="h-3 w-3" />확정
                          </span>
                          {/* 확정 후에도 수정 요청 가능 */}
                          {(!req || req.status === "REJECTED") && (
                            <button
                              onClick={() => setReqModal({
                                rec,
                                proposedStart: rec.startTime || "",
                                proposedEnd:   rec.endTime   || "",
                                reason: "",
                                submitting: false,
                              })}
                              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-500 active:scale-95"
                            >
                              <PenLine className="h-3 w-3" />수정 요청
                            </button>
                          )}
                        </>
                      ) : rec.startTime ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <button onClick={() => confirmOne(rec.id)}
                            className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-black text-white active:scale-95">
                            확정
                          </button>
                          {(!req || req.status === "REJECTED") && (
                            <button
                              onClick={() => setReqModal({
                                rec,
                                proposedStart: rec.startTime || "",
                                proposedEnd:   rec.endTime   || "",
                                reason: "",
                                submitting: false,
                              })}
                              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 active:scale-95"
                            >
                              <PenLine className="h-3 w-3" />수정 요청
                            </button>
                          )}
                        </div>
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
            · 출근·퇴근 시간 수정이 필요하면 &apos;수정 요청&apos; 버튼을 눌러주세요.<br />
            · 수정 요청은 에이전시 관리자 승인 후 반영됩니다.<br />
            · GPS 자동 입력 기록도 수정 요청을 통해서만 변경 가능합니다.
          </p>
        </div>
      </div>

      {/* 수정 요청 모달 */}
      {reqModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 px-0"
          onClick={e => { if (e.target === e.currentTarget) setReqModal(null); }}>
          <div className="w-full max-w-md rounded-t-3xl bg-white px-5 pb-10 pt-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900">출근부 수정 요청</h2>
              <button onClick={() => setReqModal(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-1 text-xs font-semibold text-slate-500">
              {reqModal.rec.workDate} ({dayOfWeek(reqModal.rec.workDate)}요일)
            </div>
            <div className="mb-4 text-xs text-slate-400">
              현재: {reqModal.rec.startTime || "미출근"} ~ {reqModal.rec.endTime || "미퇴근"}
            </div>

            <div className="space-y-4">
              {/* 제안 시간 */}
              <div>
                <p className="mb-2 text-sm font-black text-slate-700">수정 후 시간</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] font-semibold text-slate-500">출근 시간</label>
                    <input type="time" value={reqModal.proposedStart}
                      onChange={e => setReqModal(m => m ? { ...m, proposedStart: e.target.value } : null)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" />
                  </div>
                  <span className="mt-5 text-slate-400">~</span>
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] font-semibold text-slate-500">퇴근 시간</label>
                    <input type="time" value={reqModal.proposedEnd}
                      onChange={e => setReqModal(m => m ? { ...m, proposedEnd: e.target.value } : null)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" />
                  </div>
                </div>
              </div>

              {/* 수정 사유 */}
              <div>
                <p className="mb-2 text-sm font-black text-slate-700">수정 사유 <span className="text-rose-500">*</span></p>
                <textarea
                  value={reqModal.reason}
                  onChange={e => setReqModal(m => m ? { ...m, reason: e.target.value } : null)}
                  placeholder="수정이 필요한 이유를 구체적으로 입력해주세요. (예: 단말기 오류로 출근 시간이 잘못 기록됨)"
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-sky-400 focus:bg-white"
                />
              </div>

              <button
                onClick={submitEditReq}
                disabled={reqModal.submitting || !reqModal.reason.trim()}
                className="w-full rounded-2xl bg-slate-950 py-4 text-sm font-black text-white active:scale-[0.98] disabled:opacity-60"
              >
                {reqModal.submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />제출 중...
                  </span>
                ) : "수정 요청 제출"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
