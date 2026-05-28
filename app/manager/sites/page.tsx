"use client";
import Link from "next/link";
import { T } from "../_styles";
import { useEffect, useMemo, useState } from "react";

type SiteItem = {
  id: string; companyName: string; address: string; detailAddress: string | null;
  agencyName: string | null; managerName: string | null; managerEmail: string | null;
  managerPhone: string | null; basePointConfirmed: boolean;
  basePointApprovalStatus: string; isActive: boolean; allowanceRange?: number;
};

const APPROVAL_CLS: Record<string, { label: string; cls: string }> = {
  ORIGINAL_SET:         { label: "미확정",   cls: "bg-slate-100 text-slate-500" },
  COACH_PROPOSED:       { label: "제안됨",   cls: "bg-amber-50 text-amber-600" },
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className={T.pageTitle}>Site 관리</h1>
          <p className={T.pageSub}>총 {total}건 · page {page} / {totalPages}</p>
        </div>
        <Link href="/manager/sites/new">
          <button className={T.btnPrimary}>신규 등록</button>
        </Link>
      </div>

      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && onSearch()}
          placeholder="사업체명/주소/담당자명/메일/전화/기관 검색" className={`flex-1 ${T.input}`} />
        <button onClick={onSearch} className={T.btnSecondary}>검색</button>
      </div>

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead>
            <tr>{["ID", "사업체명", "주소", "담당자", "기관", "GPS 범위", "기준점", "상태"].map(h => (
              <th key={h} className={T.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className={T.tdCenter}>로딩 중...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className={T.tdCenter}>데이터가 없습니다.</td></tr>
            ) : items.map(it => {
              const approval = APPROVAL_CLS[it.basePointApprovalStatus] || APPROVAL_CLS.ORIGINAL_SET;
              return (
                <tr key={it.id} className={T.trBase}>
                  <td className={`${T.td} text-xs text-slate-400`}>{it.id}</td>
                  <td className={T.td}>
                    <Link href={`/admin/sites/${it.id}`} className="font-black text-sky-600 hover:underline">
                      {it.companyName}
                    </Link>
                  </td>
                  <td className={T.td}>
                    <div className="text-slate-700">{it.address}</div>
                    {it.detailAddress && <div className="text-xs text-slate-400">{it.detailAddress}</div>}
                  </td>
                  <td className={T.td}>
                    <div className="text-slate-700">{it.managerName || "-"}</div>
                    {it.managerEmail && <div className="text-xs text-slate-400">{it.managerEmail}</div>}
                    {it.managerPhone && <div className="text-xs text-slate-400">{it.managerPhone}</div>}
                  </td>
                  <td className={`${T.td} text-sm text-slate-500`}>{it.agencyName || "-"}</td>
                  <td className={`${T.td} font-black text-sky-600`}>{it.allowanceRange ?? 100}m</td>
                  <td className={T.td}>
                    <span className={`text-sm font-semibold ${it.basePointConfirmed ? "text-emerald-600" : "text-slate-400"}`}>
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

      <div className="flex items-center gap-3">
        <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
          className={`${T.btnSecondary} disabled:opacity-40`}>이전</button>
        <span className="text-sm font-semibold text-slate-400">{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          className={`${T.btnSecondary} disabled:opacity-40`}>다음</button>
      </div>
    </div>
  );
}
