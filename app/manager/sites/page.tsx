"use client";
import Link from "next/link";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import Pagination from "../_components/Pagination";
import ListToolbar from "../_components/ListToolbar";
import { useEffect, useMemo, useState } from "react";

type SiteItem = {
  id: string; companyName: string; address: string; detailAddress: string | null;
  agencyName: string | null; businessContactName: string | null;
  businessContactPhone: string | null; basePointConfirmed: boolean;
  basePointApprovalStatus: string; isActive: boolean; allowanceRange?: number;
  ownerManagerId: string | null; ownerManagerName: string | null;
};

const APPROVAL_CLS: Record<string, { label: string; cls: string }> = {
  ORIGINAL_SET:         { label: "미확정",   cls: "bg-slate-100 text-slate-500" },
  WORKER_PROPOSED:       { label: "제안됨",   cls: "bg-amber-50 text-amber-600" },
  APPROVED:             { label: "승인",     cls: "bg-emerald-50 text-emerald-600" },
  REJECTED:             { label: "반려",     cls: "bg-rose-50 text-rose-600" },
  CORRECTION_REQUESTED: { label: "수정요청", cls: "bg-sky-50 text-sky-600" },
};

export default function AdminSitesPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SiteItem[]>([]);
  const [total, setTotal] = useState(0);
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
        title="현장(Site) 관리"
        sub="사업체(현장) 등록·검색 및 기준점·담당자 관리"
        actions={
          <Link href="/manager/sites/new" className={T.btnPrimary}>신규 등록</Link>
        }
      />

      <ListToolbar query={q} onQueryChange={setQ} onSearch={onSearch}
        placeholder="사업체명/주소/담당자명/메일/전화/기관 검색" />

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead>
            <tr>{["ID", "사업체명", "주소", "사업체 담당자", "담당 관리자", "기관", "GPS 범위", "기준점", "상태"].map(h => (
              <th key={h} className={T.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className={T.tdCenter}>로딩 중...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={9} className={T.tdCenter}>데이터가 없습니다.</td></tr>
            ) : items.map(it => {
              const approval = APPROVAL_CLS[it.basePointApprovalStatus] || APPROVAL_CLS.ORIGINAL_SET;
              return (
                <tr key={it.id} className={T.trBase}>
                  <td className={T.td}>{it.id}</td>
                  <td className={T.td}>
                    <Link href={`/manager/sites/${it.id}`} className="font-semibold text-sky-600 hover:underline">
                      {it.companyName}
                    </Link>
                  </td>
                  <td className={T.td}>
                    {it.address}{it.detailAddress ? ` ${it.detailAddress}` : ""}
                  </td>
                  <td className={T.td}>
                    {it.businessContactName || "-"}{it.businessContactPhone ? ` (${it.businessContactPhone})` : ""}
                  </td>
                  <td className={T.td}>
                    {it.ownerManagerName ? (
                      it.ownerManagerName
                    ) : (
                      <button
                        onClick={() => claimSite(it.id)}
                        className="inline-flex min-h-10 items-center rounded-lg border border-sky-200 bg-sky-50 px-3 text-[13px] font-bold text-sky-700 active:scale-95"
                      >
                        미지정 · 내 담당으로
                      </button>
                    )}
                  </td>
                  <td className={T.td}>{it.agencyName || "-"}</td>
                  <td className={T.td}>{it.allowanceRange ?? 100}m</td>
                  <td className={T.td}>
                    <span className={it.basePointConfirmed ? "font-semibold text-emerald-600" : "text-slate-500"}>
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
    </div>
  );
}
