"use client";
import Link from "next/link";
import { sharedStyles } from "../_styles";
import { useEffect, useMemo, useState } from "react";

type SiteItem = {
  id: string;
  companyName: string;
  address: string;
  detailAddress: string | null;
  agencyName: string | null;
  managerName: string | null;
  managerEmail: string | null;
  managerPhone: string | null;
  basePointConfirmed: boolean;
  basePointApprovalStatus: string;
  isActive: boolean;
  allowanceRange?: number;
};

const APPROVAL_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  ORIGINAL_SET:           { label: "미확정",      color: "#6b7280", bg: "#f9fafb" },
  COACH_PROPOSED:         { label: "제안됨",      color: "#d97706", bg: "#fffbeb" },
  APPROVED:               { label: "승인",        color: "#16a34a", bg: "#f0fdf4" },
  REJECTED:               { label: "반려",        color: "#dc2626", bg: "#fef2f2" },
  CORRECTION_REQUESTED:   { label: "수정요청",    color: "#2563eb", bg: "#eff6ff" },
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
    if (page !== 1) setPage(1);
    else fetchList(1);
  }

  return (
    <div>
      {/* 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={T.pageTitle}>Site 관리</h1>
          <p style={T.pageSub}>총 {total}건 · page {page} / {totalPages}</p>
        </div>
        <Link href="/admin/sites/new">
          <button style={T.btnPrimary}>신규 등록</button>
        </Link>
      </div>

      {/* 검색 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && onSearch()}
          placeholder="사업체명/주소/담당자명/메일/전화/기관 검색" style={T.input} />
        <button onClick={onSearch} style={T.btnSecondary}>검색</button>
      </div>

      {/* 테이블 */}
      <div style={T.tableWrap}>
        <table style={T.table}>
          <thead>
            <tr>
              {["ID", "사업체명", "주소", "담당자", "기관", "GPS 범위", "기준점", "상태"].map(h => (
                <th key={h} style={T.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={T.tdCenter}>로딩 중...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} style={T.tdCenter}>데이터가 없습니다.</td></tr>
            ) : items.map(it => {
              const approval = APPROVAL_LABEL[it.basePointApprovalStatus] || APPROVAL_LABEL.ORIGINAL_SET;
              return (
                <tr key={it.id} style={T.tr}>
                  <td style={{ ...T.td, color: "#9ca3af", fontSize: 12 }}>{it.id}</td>
                  <td style={T.td}>
                    <Link href={`/admin/sites/${it.id}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>
                      {it.companyName}
                    </Link>
                  </td>
                  <td style={T.td}>
                    <div style={{ fontSize: 13 }}>{it.address}</div>
                    {it.detailAddress && <div style={{ fontSize: 12, color: "#9ca3af" }}>{it.detailAddress}</div>}
                  </td>
                  <td style={T.td}>
                    <div style={{ fontSize: 13 }}>{it.managerName || "-"}</div>
                    {it.managerEmail && <div style={{ fontSize: 12, color: "#9ca3af" }}>{it.managerEmail}</div>}
                    {it.managerPhone && <div style={{ fontSize: 12, color: "#9ca3af" }}>{it.managerPhone}</div>}
                  </td>
                  <td style={T.td}><span style={{ fontSize: 12, color: "#6b7280" }}>{it.agencyName || "-"}</span></td>
                  <td style={T.td}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#2563eb" }}>{it.allowanceRange ?? 100}m</span>
                  </td>
                  <td style={T.td}>
                    <span style={{ fontSize: 12, color: it.basePointConfirmed ? "#16a34a" : "#9ca3af" }}>
                      {it.basePointConfirmed ? "확정" : "미확정"}
                    </span>
                  </td>
                  <td style={T.td}>
                    <span style={{ ...T.badge, background: approval.bg, color: approval.color }}>{approval.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={{ ...T.btnSecondary, opacity: page <= 1 ? 0.4 : 1 }}>이전</button>
        <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} style={{ ...T.btnSecondary, opacity: page >= totalPages ? 0.4 : 1 }}>다음</button>
      </div>
    </div>
  );
}

const T = sharedStyles();
