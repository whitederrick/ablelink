"use client";

// 직무지도원 관리 — 본 위탁기관와 현재/과거 계약(배정) 이력이 있는 직무지도원 인적 관리.
// 배정 관리(/manager/workers)와 분리: 여긴 직무지도원 자체(정보·급여계좌·계약이력·평가)를 관리.
// 구성·사이즈는 현장(사업체) 관리 기준 패턴을 따른다(행 클릭 → 상세 모달).
import { useEffect, useMemo, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import Pagination from "../_components/Pagination";
import ListToolbar from "../_components/ListToolbar";
import { workerLabel } from "../_format";
import WorkerAccountDetailModal from "./WorkerAccountDetailModal";

type WorkerItem = {
  id: string; loginId: string; workerName: string; phoneNumber: string;
  status: string; createdAt: string; hasBankAccount: boolean; engagement: "ACTIVE" | "ENDED";
  activity: "ACTIVE" | "DORMANT"; lastLoginAt: string | null;
};

const PAGE_SIZE = 10;

export default function WorkerAccountsPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<WorkerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  // 진행 중/종료 필터(복수 선택). 미선택 또는 둘 다 = 전체.
  const [engFilter, setEngFilter] = useState<string[]>([]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const engagementParam =
    engFilter.length === 1 ? (engFilter[0] === "active" ? "active" : "ended") : "all";

  async function fetchList(targetPage: number) {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      sp.set("page", String(targetPage));
      sp.set("pageSize", String(PAGE_SIZE));
      sp.set("engagement", engagementParam);
      const res = await fetch(`/api/admin/worker-accounts?${sp.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.message || "FAILED");
      setItems(data.items || []);
      setTotal(Number(data.total || 0));
    } catch { setItems([]); setTotal(0); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchList(page); /* eslint-disable-next-line */ }, [page]);
  useEffect(() => { if (page !== 1) setPage(1); else fetchList(1); /* eslint-disable-next-line */ }, [engFilter]);

  function onSearch() { if (page !== 1) setPage(1); else fetchList(1); }
  const toggleEng = (v: string) => setEngFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="직무지도원 관리"
        sub="본 기관과 현재 계약 중이거나 과거에 계약했던 직무지도원의 정보·급여계좌·계약 이력·평가 결과를 관리합니다. 목록에서 직무지도원을 선택하면 상세 정보를 확인·수정할 수 있습니다."
      />

      <ListToolbar query={q} onQueryChange={setQ} onSearch={onSearch}
        placeholder="이름 / 아이디 / 전화번호 검색"
        filters={[{ value: "active", label: "진행 중" }, { value: "ended", label: "종료" }]}
        selected={engFilter}
        onToggleFilter={toggleEng} />

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead>
            <tr>{["직무지도원 성명(아이디)", "연락처", "계약 여부", "계정 상태", "급여계좌", "가입일"].map(h => (
              <th key={h} className={T.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className={T.tdCenter}>로딩 중...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className={T.tdCenter}>데이터가 없습니다.</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => setDetailId(it.id)}>
                <td className={`${T.td} whitespace-nowrap`}><span className="font-semibold text-sky-600">{workerLabel(it.workerName, it.loginId)}</span></td>
                <td className={T.td}>{it.phoneNumber || "-"}</td>
                <td className={T.td}>
                  {it.engagement === "ACTIVE"
                    ? <span className={`${T.badge} bg-sky-50 text-sky-600`}>진행 중</span>
                    : <span className={`${T.badge} bg-slate-100 text-slate-500`}>종료</span>}
                </td>
                <td className={T.td}>
                  {it.activity === "ACTIVE"
                    ? <span className={`${T.badge} bg-emerald-50 text-emerald-600`}>활성</span>
                    : <span className={`${T.badge} bg-slate-100 text-slate-500`} title={it.lastLoginAt ? `최근 로그인 ${it.lastLoginAt.slice(0, 10)}` : "로그인 기록 없음"}>휴면</span>}
                </td>
                <td className={T.td}>
                  {it.hasBankAccount
                    ? <span className={`${T.badge} bg-emerald-50 text-emerald-600`}>등록</span>
                    : <span className={`${T.badge} bg-rose-50 text-rose-600`}>미등록</span>}
                </td>
                <td className={T.td}>{it.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {detailId && (
        <WorkerAccountDetailModal
          workerId={detailId}
          onClose={() => setDetailId(null)}
          onSaved={() => { setDetailId(null); fetchList(page); }}
        />
      )}
    </div>
  );
}
