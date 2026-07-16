"use client";

// 연차 관리 — 계약 이력 직무지도원별 연차 발생/사용/잔여 요약(행 클릭 → 원장 상세 모달).
// 발생은 매일 배치가 자동 기록(1년 미만 월 개근 1일·1년 이상 연 15일+가산). 여기선 사용/조정 등록·이력 확인.
// Phase7: 상단 '신청 인박스' — 직무지도원 연차 신청 승인/반려 + 등록 이의 정정 진입.
// 구성·사이즈는 현장(사업체) 관리 기준 패턴(행 클릭 → 상세 모달, 페이지 10, 셀 1줄).
import { useEffect, useMemo, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import Pagination from "../_components/Pagination";
import ListToolbar from "../_components/ListToolbar";
import { workerLabel } from "../_format";
import LeaveDetailModal from "./LeaveDetailModal";

type LeaveItem = {
  workerId: string; workerName: string; loginId: string; phoneNumber: string; workerStatus: string;
  hireDate: string; accrued: number; used: number; expired: number; paidOut: number; balance: number;
};
type InboxItem = {
  id: string; workerId: string; workerName: string; loginId: string;
  kind: string; status: string; effectiveDate: string; days: number;
  reason: string | null; responseNote: string | null; createdAt: string;
};

const PAGE_SIZE = 10;
const INBOX_PAGE_SIZE = 5;

export default function LeavePage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<LeaveItem[]>([]);
  const [total, setTotal] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  // 신청 인박스(Phase7)
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [inboxTotal, setInboxTotal] = useState(0);
  const [inboxPage, setInboxPage] = useState(1);
  const [inboxBusy, setInboxBusy] = useState<string | null>(null); // 처리 중 요청 id
  const [rejectTarget, setRejectTarget] = useState<InboxItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [inboxErr, setInboxErr] = useState<string | null>(null);
  const inboxTotalPages = useMemo(() => Math.max(1, Math.ceil(inboxTotal / INBOX_PAGE_SIZE)), [inboxTotal]);

  async function fetchList(targetPage: number) {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      sp.set("page", String(targetPage));
      sp.set("pageSize", String(PAGE_SIZE));
      const res = await fetch(`/api/admin/leave?${sp.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.message || "FAILED");
      setItems(data.items || []);
      setTotal(Number(data.total || 0));
    } catch { setItems([]); setTotal(0); }
    finally { setLoading(false); }
  }

  async function fetchInbox(targetPage: number) {
    try {
      const res = await fetch(`/api/admin/leave/requests?box=pending&page=${targetPage}&pageSize=${INBOX_PAGE_SIZE}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.message || "FAILED");
      setInbox(data.items || []);
      setInboxTotal(Number(data.total || 0));
    } catch { setInbox([]); setInboxTotal(0); }
  }

  useEffect(() => { fetchList(page); /* eslint-disable-next-line */ }, [page]);
  useEffect(() => { fetchInbox(inboxPage); /* eslint-disable-next-line */ }, [inboxPage]);
  function onSearch() { if (page !== 1) setPage(1); else fetchList(1); }
  function refreshAll() { fetchList(page); fetchInbox(inboxPage); }

  async function decide(item: InboxItem, action: "approve" | "reject", reason?: string) {
    setInboxBusy(item.id); setInboxErr(null);
    try {
      const res = await fetch(`/api/admin/leave/requests/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.message || "처리에 실패했습니다.");
      setRejectTarget(null); setRejectReason("");
      refreshAll();
    } catch (e) {
      setInboxErr(e instanceof Error ? e.message : "처리에 실패했습니다.");
    } finally { setInboxBusy(null); }
  }

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

  return (
    <div className="space-y-5">
      <PageHeader
        title="연차 관리"
        sub="직무지도원별 연차 발생·사용·잔여 현황입니다. 발생(1년 미만 월 개근 1일, 1년 이상 15일)은 매일 자동 기록되며, 행을 선택하면 원장 이력 확인과 사용·조정 등록을 할 수 있습니다. 직무지도원이 신청한 연차는 아래 인박스에서 승인/반려합니다."
      />

      {/* 신청 인박스 — 처리 대기(신청 + 등록 이의)만 */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-bold text-slate-800">
            연차 신청 인박스
            {inboxTotal > 0 && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-600">{inboxTotal}건 대기</span>}
          </p>
          {inboxErr && <p className="text-xs font-bold text-rose-500">{inboxErr}</p>}
        </div>
        {inbox.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">처리할 신청이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr>{["구분", "직무지도원 성명(아이디)", "사용일", "일수", "사유", "신청일", "처리"].map(h => (
                  <th key={h} className={T.th}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {inbox.map(r => (
                  <tr key={r.id} className={T.trBase}>
                    <td className={`${T.td} whitespace-nowrap`}>
                      {r.kind === "WORKER_REQUEST"
                        ? <span className={`${T.badge} bg-sky-50 text-sky-600`}>신청</span>
                        : <span className={`${T.badge} bg-rose-50 text-rose-600`}>등록 이의</span>}
                    </td>
                    <td className={`${T.td} whitespace-nowrap`}><span className="font-semibold text-sky-600">{workerLabel(r.workerName, r.loginId)}</span></td>
                    <td className={`${T.td} whitespace-nowrap`}>{r.effectiveDate}</td>
                    <td className={`${T.td} whitespace-nowrap`}>{fmt(r.days)}일</td>
                    <td className={`${T.td} max-w-[220px]`}><span className="block truncate">{r.kind === "WORKER_REQUEST" ? (r.reason || "-") : (r.responseNote || "-")}</span></td>
                    <td className={`${T.td} whitespace-nowrap`}>{r.createdAt.slice(0, 10)}</td>
                    <td className={`${T.td} whitespace-nowrap`}>
                      {r.kind === "WORKER_REQUEST" ? (
                        <span className="inline-flex gap-1.5">
                          <button
                            onClick={() => decide(r, "approve")}
                            disabled={inboxBusy === r.id}
                            className="rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
                          >승인</button>
                          <button
                            onClick={() => { setRejectTarget(r); setRejectReason(""); }}
                            disabled={inboxBusy === r.id}
                            className="rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-rose-500 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-50"
                          >반려</button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setDetailId(r.workerId)}
                          className="rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                        >원장 정정</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {inboxTotal > INBOX_PAGE_SIZE && (
          <div className="border-t border-slate-100 px-4 py-2">
            <Pagination page={inboxPage} totalPages={inboxTotalPages} total={inboxTotal} onPageChange={setInboxPage} />
          </div>
        )}
      </div>

      <ListToolbar query={q} onQueryChange={setQ} onSearch={onSearch} placeholder="이름 / 아이디 검색" />

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr>{["직무지도원 성명(아이디)", "연락처", "입사일", "발생", "사용", "소멸·정산", "잔여"].map(h => (
              <th key={h} className={T.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className={T.tdCenter}>로딩 중...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className={T.tdCenter}>데이터가 없습니다.</td></tr>
            ) : items.map(it => (
              <tr key={it.workerId} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => setDetailId(it.workerId)}>
                <td className={`${T.td} whitespace-nowrap`}><span className="font-semibold text-sky-600">{workerLabel(it.workerName, it.loginId)}</span></td>
                <td className={`${T.td} whitespace-nowrap`}>{it.phoneNumber || "-"}</td>
                <td className={`${T.td} whitespace-nowrap`}>{it.hireDate}</td>
                <td className={`${T.td} whitespace-nowrap`}>{fmt(it.accrued)}일</td>
                <td className={`${T.td} whitespace-nowrap`}>{fmt(it.used)}일</td>
                <td className={`${T.td} whitespace-nowrap`}>{fmt(it.expired + it.paidOut)}일</td>
                <td className={`${T.td} whitespace-nowrap`}>
                  {it.balance > 0
                    ? <span className={`${T.badge} bg-emerald-50 text-emerald-600`}>{fmt(it.balance)}일</span>
                    : it.balance < 0
                    ? <span className={`${T.badge} bg-rose-50 text-rose-600`}>{fmt(it.balance)}일</span>
                    : <span className={`${T.badge} bg-slate-100 text-slate-500`}>0일</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {detailId && (
        <LeaveDetailModal
          workerId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={refreshAll}
        />
      )}

      {/* 반려 사유 모달 */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40" onClick={() => setRejectTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-slate-800">연차 신청 반려</p>
            <p className="mt-1 text-xs text-slate-500">
              {workerLabel(rejectTarget.workerName, rejectTarget.loginId)} · {rejectTarget.effectiveDate} · {fmt(rejectTarget.days)}일
            </p>
            <textarea
              value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} maxLength={200}
              placeholder="반려 사유를 입력해주세요. (직무지도원에게 전달됩니다)"
              className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800"
            />
            {inboxErr && <p className="mt-1 text-xs font-bold text-rose-500">{inboxErr}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setRejectTarget(null)} className="rounded-xl px-3.5 py-2 text-xs font-bold text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50">취소</button>
              <button
                onClick={() => { if (!rejectReason.trim()) { setInboxErr("반려 사유를 입력해주세요."); return; } decide(rejectTarget, "reject", rejectReason.trim()); }}
                disabled={inboxBusy === rejectTarget.id}
                className="rounded-xl bg-rose-500 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-600 disabled:opacity-50"
              >반려</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
