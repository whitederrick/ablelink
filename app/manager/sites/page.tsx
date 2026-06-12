"use client";
import Link from "next/link";
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
  // 딥링크: ?q=대상 으로 진입 시 검색 시드(대시보드 운영 리스크 항목 클릭)
  useEffect(() => {
    const sq = new URLSearchParams(window.location.search).get("q");
    if (sq) setQ(sq);
  }, []);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SiteItem[]>([]);
  const [total, setTotal] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  async function fetchList(targetPage: number) {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      sp.set("page", String(targetPage));
      sp.set("pageSize", String(pageSize));
      sp.set("isActive", "true");
      const res = await fetch(`/api/admin/sites?${sp.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.message || "FAILED");
      setItems(data.items || []);
      setTotal(Number(data.total || 0));
    } catch { setItems([]); setTotal(0); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchList(page); }, [page]);

  function onSearch() {
    if (page !== 1) setPage(1); else fetchList(1);
  }

  async function claimSite(id: string) {
    try {
      const res = await fetch(`/api/admin/sites/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerManagerId: "self" }),
      });
      const d = await res.json();
      if (!d?.success) { alert(d?.message || "지정 실패"); return; }
      fetchList(page);
    } catch { alert("서버 오류"); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="직무지도 현장(사업체) 관리"
        sub="직무지도원이 근무하는 현장(사업체)을 등록하고 검색합니다. 출근 기준점(GPS)과 현장의 사업체 담당자 정보도 여기서 관리합니다."
        actions={
          <Link href="/manager/sites/new" className={T.btnPrimary}>+ 신규 등록</Link>
        }
      />

      <ListToolbar query={q} onQueryChange={setQ} onSearch={onSearch}
        placeholder="현장(사업체)/주소/담당자명/메일/전화/기관 검색" />

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead>
            <tr>{["ID", "현장(사업체)", "주소", "사업체 담당자 성명", "사업체 담당자 연락처", "업무 이관 담당자", "기관명", "GPS 범위", "기준점", "상태"].map(h => (
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
                      <span className="font-semibold text-sky-600 hover:underline">{it.companyName}</span>
                    </div>
                  </td>
                  <td className={T.td}>
                    <div className="max-w-[240px] truncate" title={`${it.address}${it.detailAddress ? ` ${it.detailAddress}` : ""}`}>
                      {it.address}{it.detailAddress ? ` ${it.detailAddress}` : ""}
                    </div>
                  </td>
                  <td className={T.td}><div className="max-w-[110px] truncate">{it.businessContactName || "-"}</div></td>
                  <td className={T.td}><div className="max-w-[120px] truncate">{it.businessContactPhone || "-"}</div></td>
                  <td className={T.td} onClick={e => e.stopPropagation()}>
                    {it.ownerManagerName ? (
                      <div className="max-w-[130px] truncate">{it.ownerManagerName}</div>
                    ) : (
                      <button
                        onClick={() => claimSite(it.id)}
                        className="inline-flex h-7 items-center whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50 px-2.5 text-[13px] font-bold text-sky-700 active:scale-95"
                      >
                        미지정 · 내 담당으로
                      </button>
                    )}
                  </td>
                  <td className={T.td}><div className="max-w-[130px] truncate">{it.agencyName || "-"}</div></td>
                  <td className={T.td}>{it.allowanceRange ?? 100}m</td>
                  <td className={T.td}>
                    <span className={`text-[13px] ${it.basePointConfirmed ? "font-semibold text-emerald-600" : "text-slate-500"}`}>
                      {it.basePointConfirmed ? "확정" : "미확정"}
                    </span>
                  </td>
                  <td className={T.td}>
                    <span className={`${T.badge} ${approval.cls}`}>{approval.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {detailId && (
        <SiteDetailModal
          siteId={detailId}
          onClose={() => setDetailId(null)}
          onSaved={() => { setDetailId(null); fetchList(page); }}
        />
      )}
    </div>
  );
}
