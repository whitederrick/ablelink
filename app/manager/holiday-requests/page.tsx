"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, ChevronLeft, ChevronRight, Send, Clock, CheckCircle2, XCircle } from "lucide-react";
import { T } from "../_styles";

type PendingReq = {
  id: string; requestType: "DELETE" | "CHANGE_WORKDAY";
  proposedCountAsWorkday: boolean | null;
  reason: string | null; status: string; createdAt: string;
};

type HolidayRow = {
  id: string; date: string; reason: string | null; countAsWorkday: boolean;
  userName: string; userId: string; siteName: string; assignmentId: string;
  pendingRequest: PendingReq | null;
};

const REQ_TYPE_LABELS: Record<string, string> = {
  DELETE:        "삭제 요청",
  CHANGE_WORKDAY:"근무인정 변경",
};

function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nextMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtYM(ym: string) {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}

export default function HolidayRequestsPage() {
  const today = new Date();
  const [ym, setYm]           = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const [rows, setRows]       = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [toast, setToast]     = useState("");

  // 요청 폼 상태
  const [reqTarget, setReqTarget] = useState<HolidayRow | null>(null);
  const [reqType, setReqType]     = useState<"DELETE" | "CHANGE_WORKDAY">("DELETE");
  const [reqWorkday, setReqWorkday] = useState(false);
  const [reqReason, setReqReason] = useState("");
  const [sending, setSending]     = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  const load = useCallback((yearMonth = ym) => {
    setLoading(true);
    fetch(`/api/admin/holiday-requests?yearMonth=${yearMonth}`)
      .then(r => r.json())
      .then(d => { if (d.success) setRows(d.holidays); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ym]);

  useEffect(() => { load(ym); }, [ym]);

  function openRequest(row: HolidayRow) {
    setReqTarget(row);
    setReqType("DELETE");
    setReqWorkday(!row.countAsWorkday);
    setReqReason("");
  }

  async function sendRequest() {
    if (!reqTarget) return;
    setSending(true);
    const res = await fetch("/api/admin/holiday-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        holidayId:             reqTarget.id,
        requestType:           reqType,
        proposedCountAsWorkday: reqType === "CHANGE_WORKDAY" ? reqWorkday : undefined,
        reason:                reqReason.trim() || undefined,
      }),
    });
    const data = await res.json();
    setSending(false);
    if (data.success) {
      showToast("요청이 직무지도원에게 전달되었습니다.");
      setReqTarget(null);
      load(ym);
    } else {
      showToast(data.message ?? "요청 실패");
    }
  }

  const filtered = rows.filter(r =>
    !search || r.userName.includes(search) || r.siteName.includes(search)
  );
  const pendingCount = rows.filter(r => r.pendingRequest).length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={T.pageTitle}>커스텀 휴무일 관리</h1>
          <p className={T.pageSub}>직무지도원이 등록한 커스텀 휴무일을 조회하고 변경을 요청합니다</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setYm(prevMonth(ym))} className={T.btnSecondary + " px-2.5"}><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[90px] text-center text-sm font-black text-slate-900">{fmtYM(ym)}</span>
          <button onClick={() => setYm(nextMonth(ym))} className={T.btnSecondary + " px-2.5"}><ChevronRight className="h-4 w-4" /></button>
          <button onClick={() => load(ym)} className={T.btnSecondary + " flex items-center gap-1.5 ml-1"}>
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 요약 */}
      <div className="mb-5 grid grid-cols-3 gap-3.5">
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{rows.length}</p>
          <p className={T.summaryLabel}>이번 달 커스텀 휴무일</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-emerald-600"}>{rows.filter(r => r.countAsWorkday).length}</p>
          <p className={T.summaryLabel}>근무 인정</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-amber-600"}>{pendingCount}</p>
          <p className={T.summaryLabel}>처리 대기 요청</p>
        </div>
      </div>

      {/* 검색 */}
      <div className="mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="직무지도원 이름 또는 현장명 검색..."
          className={T.input + " w-64"} />
      </div>

      {/* 안내 */}
      <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <span className="font-black">합의 원칙:</span> 변경/삭제 요청을 보내면 직무지도원이 수락해야만 반영됩니다. 일방적으로 변경되지 않습니다.
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm text-slate-400">
            {rows.length === 0 ? "이번 달 커스텀 휴무일이 없습니다." : "검색 결과가 없습니다."}
          </p>
        </div>
      ) : (
        <div className={T.tableWrap}>
          <table className="w-full">
            <thead>
              <tr>
                {["날짜", "직무지도원", "현장", "사유", "근무인정", "요청 상태", ""].map(h => (
                  <th key={h} className={T.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} className={T.trBase}>
                  <td className={T.td + " tabular-nums font-semibold"}>{row.date}</td>
                  <td className={T.td + " font-semibold text-slate-900"}>{row.userName}</td>
                  <td className={T.td + " text-slate-500"}>{row.siteName}</td>
                  <td className={T.td + " text-slate-500 max-w-[160px] truncate"}>{row.reason ?? "-"}</td>
                  <td className={T.td}>
                    <span className={`${T.badge} ${row.countAsWorkday ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {row.countAsWorkday ? "인정" : "미인정"}
                    </span>
                  </td>
                  <td className={T.td}>
                    {row.pendingRequest ? (
                      <span className="flex items-center gap-1 text-xs font-semibold text-amber-600">
                        <Clock className="h-3.5 w-3.5" />
                        {REQ_TYPE_LABELS[row.pendingRequest.requestType]} 대기
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">없음</span>
                    )}
                  </td>
                  <td className={T.td}>
                    {!row.pendingRequest && (
                      <button onClick={() => openRequest(row)}
                        className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 active:scale-95">
                        <Send className="h-3 w-3" />요청
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 요청 모달 */}
      {reqTarget && (
        <div className={T.modalOverlay}>
          <div className={T.modalContent}>
            <div className="mb-5">
              <p className="text-base font-black text-slate-900">변경 요청 보내기</p>
              <p className="mt-1 text-sm text-slate-500">
                {reqTarget.userName} · {reqTarget.date}
                {reqTarget.reason ? ` · ${reqTarget.reason}` : ""}
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className={T.label}>요청 유형</label>
                <div className="flex gap-2">
                  {(["DELETE", "CHANGE_WORKDAY"] as const).map(t => (
                    <button key={t} onClick={() => setReqType(t)}
                      className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition active:scale-95 ${
                        reqType === t
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}>
                      {REQ_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {reqType === "CHANGE_WORKDAY" && (
                <div>
                  <label className={T.label}>변경 후 근무인정 여부</label>
                  <div className="flex gap-2">
                    {[true, false].map(v => (
                      <button key={String(v)} onClick={() => setReqWorkday(v)}
                        className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition active:scale-95 ${
                          reqWorkday === v
                            ? "border-slate-950 bg-slate-950 text-white"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}>
                        {v ? "근무 인정" : "근무 미인정"}
                      </button>
                    ))}
                  </div>
                  {reqWorkday === reqTarget.countAsWorkday && (
                    <p className="mt-1.5 text-xs text-amber-600">현재와 동일한 값입니다.</p>
                  )}
                </div>
              )}

              <div>
                <label className={T.label}>사유 (선택)</label>
                <textarea value={reqReason} onChange={e => setReqReason(e.target.value)}
                  placeholder="직무지도원에게 전달할 사유를 입력하세요..."
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 resize-none" />
              </div>

              <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5 text-xs text-amber-700">
                요청을 보내면 직무지도원의 알림함에 전달됩니다. 직무지도원이 수락해야 실제로 반영됩니다.
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setReqTarget(null)} className={T.btnSecondary + " flex-1"}>취소</button>
              <button onClick={sendRequest} disabled={sending} className={T.btnPrimary + " flex-1"}>
                {sending ? "전송 중..." : "요청 전송"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
