"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { RefreshCw, ChevronLeft, ChevronRight, Send, Clock } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import { StatCardRow } from "../_components/StatCard";

const HOL_PAGE_SIZE = 15;

type PendingReq = {
  id: string; requestType: "DELETE" | "CHANGE_WORKDAY";
  proposedCountAsWorkday: boolean | null;
  reason: string | null; status: string; createdAt: string;
};

type HolidayRow = {
  id: string; date: string; reason: string | null; countAsWorkday: boolean;
  workerName: string; workerId: string; siteName: string; assignmentId: string;
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
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage]       = useState(1);
  const [toast, setToast]     = useState("");

  // 삭제 요청 폼 상태
  const [reqTarget, setReqTarget] = useState<HolidayRow | null>(null);
  const [reqReason, setReqReason] = useState("");
  const [sending, setSending]     = useState(false);
  // 근무 인정 직접 결정(즉시 반영) 상태
  const [savingWorkday, setSavingWorkday] = useState<string | null>(null);

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
    setReqReason("");
  }

  // 삭제 요청(직무지도원 수락 필요)
  async function sendRequest() {
    if (!reqTarget) return;
    setSending(true);
    const res = await fetch("/api/admin/holiday-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        holidayId:   reqTarget.id,
        requestType: "DELETE",
        reason:      reqReason.trim() || undefined,
      }),
    });
    const data = await res.json();
    setSending(false);
    if (data.success) {
      showToast("삭제 요청이 직무지도원에게 전달되었습니다.");
      setReqTarget(null);
      load(ym);
    } else {
      showToast(data.message ?? "요청 실패");
    }
  }

  // 근무 인정 직접 결정 — 관리자 권한으로 즉시 반영(직무지도원 수락 불필요)
  async function setWorkday(row: HolidayRow, value: boolean) {
    if (savingWorkday || row.countAsWorkday === value) return;
    setSavingWorkday(row.id);
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, countAsWorkday: value } : r))); // 낙관적 반영
    try {
      const res = await fetch("/api/admin/holiday-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holidayId: row.id, countAsWorkday: value }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(value ? "근무 인정으로 확정했습니다." : "근무 미인정으로 변경했습니다.");
      } else {
        showToast(data.message ?? "변경 실패");
        load(ym); // 롤백
      }
    } catch {
      showToast("서버 오류");
      load(ym);
    } finally {
      setSavingWorkday(null);
    }
  }

  const pendingCount = rows.filter(r => r.pendingRequest).length;

  function matchStatus(r: HolidayRow, keys: string[]) {
    if (keys.length === 0) return true;
    return keys.some(k =>
      k === "workday" ? r.countAsWorkday :
      k === "nonworkday" ? !r.countAsWorkday :
      k === "pending" ? !!r.pendingRequest : false);
  }
  const filtered = useMemo(() => {
    const q = search.trim();
    return rows
      .filter(r => !q || r.workerName.includes(q) || r.siteName.includes(q))
      .filter(r => matchStatus(r, statusFilter));
  }, [rows, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / HOL_PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * HOL_PAGE_SIZE, page * HOL_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, statusFilter, ym]);

  const filters: FilterChip[] = [
    { value: "workday", label: "근무인정", count: rows.filter(r => r.countAsWorkday).length },
    { value: "nonworkday", label: "미인정", count: rows.filter(r => !r.countAsWorkday).length },
    { value: "pending", label: "요청대기", count: pendingCount },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div>
      <PageHeader
        title="커스텀 휴무일 관리"
        sub="직무지도원이 등록한 휴무일의 근무 인정 여부를 확인·결정합니다"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setYm(prevMonth(ym))} className={T.btnSecondary + " px-2.5"}><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[90px] text-center text-sm font-black text-slate-900">{fmtYM(ym)}</span>
            <button onClick={() => setYm(nextMonth(ym))} className={T.btnSecondary + " px-2.5"}><ChevronRight className="h-4 w-4" /></button>
            <button onClick={() => load(ym)} className={T.btnSecondary + " flex items-center gap-1.5 ml-1"}>
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        }
      />

      <StatCardRow
        className="mb-5"
        cols={3}
        items={[
          { label: "이번 달 커스텀 휴무일", value: rows.length },
          { label: "근무 인정", value: rows.filter(r => r.countAsWorkday).length, tone: "emerald" },
          { label: "처리 대기 요청", value: pendingCount, tone: "amber" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={search}
          onQueryChange={setSearch}
          placeholder="직무지도원·현장명 검색"
          filters={filters}
          selected={statusFilter}
          onToggleFilter={toggleStatus}
        />
      </div>

      {/* 안내 */}
      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        <span className="font-black">근무 인정</span>은 관리자가 직접 확인 후 결정하며 즉시 반영되어 급여 계산에 사용됩니다(직무지도원 수락 불필요).
        <span className="ml-1 font-black">휴무일 삭제</span>는 직무지도원이 수락해야 반영됩니다.
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
              {pageItems.map(row => (
                <tr key={row.id} className={T.trBase}>
                  <td className={T.td + " tabular-nums"}>{row.date}</td>
                  <td className={T.td}>{row.workerName}</td>
                  <td className={T.td}>{row.siteName}</td>
                  <td className={T.td + " max-w-[160px] truncate"}>{row.reason ?? "-"}</td>
                  <td className={T.td}>
                    <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
                      <button
                        onClick={() => setWorkday(row, true)}
                        disabled={savingWorkday === row.id}
                        className={`min-h-9 px-3 text-[13px] font-bold transition disabled:opacity-50 ${
                          row.countAsWorkday ? "bg-emerald-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        인정
                      </button>
                      <button
                        onClick={() => setWorkday(row, false)}
                        disabled={savingWorkday === row.id}
                        className={`min-h-9 border-l border-slate-200 px-3 text-[13px] font-bold transition disabled:opacity-50 ${
                          !row.countAsWorkday ? "bg-slate-700 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        미인정
                      </button>
                    </div>
                  </td>
                  <td className={T.td}>
                    {row.pendingRequest ? (
                      <span className="flex items-center gap-1 font-semibold text-amber-600">
                        <Clock className="h-3.5 w-3.5" />
                        {REQ_TYPE_LABELS[row.pendingRequest.requestType]} 대기
                      </span>
                    ) : (
                      <span className="text-slate-400">없음</span>
                    )}
                  </td>
                  <td className={T.td}>
                    {!row.pendingRequest && (
                      <button onClick={() => openRequest(row)}
                        className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 active:scale-95">
                        <Send className="h-3 w-3" />삭제 요청
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
        </div>
      )}

      {/* 삭제 요청 모달 */}
      {reqTarget && (
        <div className={T.modalOverlay}>
          <div className={T.modalContent}>
            <div className="mb-5">
              <p className="text-base font-black text-slate-900">휴무일 삭제 요청</p>
              <p className="mt-1 text-sm text-slate-500">
                {reqTarget.workerName} · {reqTarget.date}
                {reqTarget.reason ? ` · ${reqTarget.reason}` : ""}
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className={T.label}>사유 (선택)</label>
                <textarea value={reqReason} onChange={e => setReqReason(e.target.value)}
                  placeholder="직무지도원에게 전달할 사유를 입력하세요..."
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 resize-none" />
              </div>

              <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5 text-xs text-amber-700">
                삭제 요청을 보내면 직무지도원의 알림함에 전달됩니다. 직무지도원이 수락해야 실제로 삭제됩니다.
                (근무 인정 여부는 목록에서 관리자가 직접 결정하며 즉시 반영됩니다.)
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setReqTarget(null)} className={T.btnSecondary + " flex-1"}>취소</button>
              <button onClick={sendRequest} disabled={sending} className={T.btnPrimary + " flex-1"}>
                {sending ? "전송 중..." : "삭제 요청 전송"}
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
