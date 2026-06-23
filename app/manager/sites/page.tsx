"use client";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import Pagination from "../_components/Pagination";
import ListToolbar from "../_components/ListToolbar";
import SiteDetailModal from "./SiteDetailModal";
import { useEffect, useMemo, useState } from "react";

type SiteItem = {
  id: string; companyName: string; address: string; detailAddress: string | null;
  agencyName: string | null; businessContactName: string | null;
  businessContactPhone: string | null; basePointConfirmed: boolean;
  basePointApprovalStatus: string; isActive: boolean; allowanceRange?: number;
  ownerManagerId: string | null; ownerManagerName: string | null;
};

const APPROVAL_CLS: Record<string, { label: string; cls: string }> = {
  ORIGINAL_SET:         { label: "미확정",   cls: "bg-rose-50 text-rose-600" },
  WORKER_PROPOSED:       { label: "제안됨",   cls: "bg-amber-50 text-amber-600" },
  APPROVED:             { label: "승인",     cls: "bg-emerald-50 text-emerald-600" },
  REJECTED:             { label: "반려",     cls: "bg-rose-50 text-rose-600" },
  CORRECTION_REQUESTED: { label: "수정요청", cls: "bg-sky-50 text-sky-600" },
};

export default function AdminSitesPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  // 딥링크: ?q=대상 검색 시드 + ?focus=현장ID 로 해당 현장 상세 자동 오픈(대시보드 미배정 Site 클릭)
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sq = sp.get("q");
    const sf = sp.get("focus");
    if (sq) setQ(sq);
    if (sf) setFocusId(sf);
  }, []);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SiteItem[]>([]);
  const [total, setTotal] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // 활성/비활성 필터(복수 선택). 미선택 또는 둘 다 = 전체.
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  const isActiveParam =
    statusFilter.length === 1 ? (statusFilter[0] === "active" ? "true" : "false") : "all";

  async function fetchList(targetPage: number) {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      sp.set("page", String(targetPage));
      sp.set("pageSize", String(pageSize));
      sp.set("isActive", isActiveParam);
      const res = await fetch(`/api/admin/sites?${sp.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.message || "FAILED");
      setItems(data.items || []);
      setTotal(Number(data.total || 0));
    } catch { setItems([]); setTotal(0); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchList(page); }, [page]);
  // 필터 변경 시 1페이지부터 재조회
  useEffect(() => { if (page !== 1) setPage(1); else fetchList(1); /* eslint-disable-next-line */ }, [statusFilter]);

  // 딥링크 focus: 목록이 로드되면 해당 현장 상세 모달을 1회 자동 오픈
  useEffect(() => {
    if (!focusId || items.length === 0) return;
    if (items.some(it => it.id === focusId)) setDetailId(focusId);
    setFocusId(null);
  }, [focusId, items]);

  function onSearch() {
    if (page !== 1) setPage(1); else fetchList(1);
  }

  const toggleStatus = (v: string) =>
    setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="직무지도 현장(사업체) 관리"
        sub="직무지도원이 근무하는 현장(사업체)을 등록하고 검색합니다. 출근 기준점(GPS)과 현장의 사업체 담당자 정보도 여기서 관리합니다."
        actions={
          <button onClick={() => setCreating(true)} className={T.btnPrimary}>+ 신규 등록</button>
        }
      />

      <ListToolbar query={q} onQueryChange={setQ} onSearch={onSearch}
        placeholder="현장(사업체)/주소/담당자명/메일/전화/기관 검색"
        filters={[{ value: "active", label: "활성 현장" }, { value: "inactive", label: "비활성 현장" }]}
        selected={statusFilter}
        onToggleFilter={toggleStatus} />

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1160px] border-collapse">
          <thead>
            <tr>{["ID", "현장(사업체)", "주소", "사업체 담당자 성명", "사업체 담당자 연락처", "위탁기관 담당자", "기관명", "GPS 범위", "기준점", "활성 여부"].map(h => (
              <th key={h} className={T.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className={T.tdCenter}>로딩 중...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={10} className={T.tdCenter}>데이터가 없습니다.</td></tr>
            ) : items.map(it => {
              const approval = APPROVAL_CLS[it.basePointApprovalStatus] || APPROVAL_CLS.ORIGINAL_SET;
              return (
                <tr key={it.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => setDetailId(it.id)}>
                  <td className={T.td}>{it.id}</td>
                  <td className={T.td}>
                    <div className="max-w-[150px] truncate">
                      <span className="font-semibold text-sky-600">{it.companyName}</span>
                    </div>
                  </td>
                  <td className={T.td}>
                    <div className="max-w-[240px] truncate" title={`${it.address}${it.detailAddress ? ` ${it.detailAddress}` : ""}`}>
                      {it.address}{it.detailAddress ? ` ${it.detailAddress}` : ""}
                    </div>
                  </td>
                  <td className={T.td}><div className="max-w-[110px] truncate">{it.businessContactName || "-"}</div></td>
                  <td className={T.td}><div className="max-w-[120px] truncate">{it.businessContactPhone || "-"}</div></td>
                  <td className={T.td}>
                    {it.ownerManagerName ? (
                      <div className="max-w-[130px] truncate">{it.ownerManagerName}</div>
                    ) : (
                      <span className="whitespace-nowrap font-semibold text-rose-600">담당자 지정 필요</span>
                    )}
                  </td>
                  <td className={T.td}><div className="max-w-[130px] truncate">{it.agencyName || "-"}</div></td>
                  <td className={T.td}>{it.allowanceRange ?? 100}m</td>
                  {/* 기준점: 확정 시 '확정', 아니면 승인 워크플로 단계 표시 */}
                  <td className={T.td}>
                    {it.basePointConfirmed
                      ? <span className={`${T.badge} bg-emerald-50 text-emerald-600`}>확정</span>
                      : <span className={`${T.badge} ${approval.cls}`}>{approval.label}</span>}
                  </td>
                  {/* 활성 여부 (재활성화는 상세 모달에서) */}
                  <td className={T.td}>
                    {it.isActive
                      ? <span className={`${T.badge} bg-sky-50 text-sky-600`}>활성</span>
                      : <span className={`${T.badge} bg-rose-50 text-rose-600`}>비활성</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {(detailId || creating) && (
        <SiteDetailModal
          siteId={creating ? undefined : detailId}
          onClose={() => { setDetailId(null); setCreating(false); }}
          onSaved={() => { setDetailId(null); setCreating(false); fetchList(page); }}
        />
      )}
    </div>
  );
}
