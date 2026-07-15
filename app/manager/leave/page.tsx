"use client";

// 연차 관리 — 계약 이력 직무지도원별 연차 발생/사용/잔여 요약(행 클릭 → 원장 상세 모달).
// 발생은 매일 배치가 자동 기록(1년 미만 월 개근 1일·1년 이상 연 15일+가산). 여기선 사용/조정 등록·이력 확인.
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

const PAGE_SIZE = 10;

export default function LeavePage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<LeaveItem[]>([]);
  const [total, setTotal] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

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

  useEffect(() => { fetchList(page); /* eslint-disable-next-line */ }, [page]);
  function onSearch() { if (page !== 1) setPage(1); else fetchList(1); }

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

  return (
    <div className="space-y-5">
      <PageHeader
        title="연차 관리"
        sub="직무지도원별 연차 발생·사용·잔여 현황입니다. 발생(1년 미만 월 개근 1일, 1년 이상 15일)은 매일 자동 기록되며, 행을 선택하면 원장 이력 확인과 사용·조정 등록을 할 수 있습니다."
      />

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
          onChanged={() => fetchList(page)}
        />
      )}
    </div>
  );
}
