// app/admin/sites/page.tsx
// This is the client component for the site management page in the admin panel.
// It provides search, pagination, and links to site details.

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

type SiteItem = {
  id: string; // API에서 문자열로 내려오므로 string 고정 권장
  companyName: string;
  address: string;
  detailAddress: string | null;

  agencyName: string | null;

  managerName: string | null;
  managerEmail: string | null;
  managerPhone: string | null;

  basePointConfirmed: boolean;
  basePointApprovalStatus: string;
  basePointUpdatedAt: string | null;

  isActive: boolean;
};

export default function AdminSitesPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SiteItem[]>([]);
  const [total, setTotal] = useState(0);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize]
  );

  async function fetchList(targetPage: number) {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      sp.set("page", String(targetPage));
      sp.set("pageSize", String(pageSize));
      sp.set("isActive", "true");

      const res = await fetch(`/api/admin/sites?${sp.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.message || "FAILED");

      setItems((data.items || []) as SiteItem[]);
      setTotal(Number(data.total || 0));
    } catch (e) {
      console.error(e);
      setItems([]);
      setTotal(0);
      alert("목록 조회에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchList(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function onSearch() {
    // 검색은 1페이지로 고정 후, useEffect(page)로 조회되게 처리
    if (page !== 1) setPage(1);
    else fetchList(1);
  }

  const fmt = (v: string | null | undefined) => (v && String(v).trim() ? String(v) : "-");

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Site 관리</h1>
        <Link href="/admin/sites/new">
          <button style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6 }}>
            신규 등록
          </button>
        </Link>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="사업체명/주소/담당자명/메일/전화/기관 검색"
          style={{ flex: 1, padding: 10, border: "1px solid #ccc", borderRadius: 6 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSearch();
          }}
        />
        <button
          onClick={onSearch}
          style={{ padding: "10px 14px", border: "1px solid #ccc", borderRadius: 6 }}
        >
          검색
        </button>
      </div>

      <div style={{ marginTop: 12, fontSize: 13, color: "#555" }}>
        총 {total}건 (page {page} / {totalPages})
      </div>

      <div style={{ backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f8f9ff" }}>
            <tr>
              <th style={th}>ID</th>
              <th style={th}>사업체명</th>
              <th style={th}>주소</th>
              <th style={th}>담당자</th>
              <th style={th}>기관</th>
              <th style={th}>GPS 범위</th>
              <th style={th}>기준점</th>
              <th style={th}>상태</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td style={td} colSpan={7}>로딩 중...</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td style={td} colSpan={7}>데이터가 없습니다.</td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id}>
                  <td style={td}>{it.id}</td>
                  <td style={td}>
                    <Link href={`/admin/sites/${it.id}`} style={{ textDecoration: "underline" }}>
                      {it.companyName}
                    </Link>
                  </td>
                  <td style={td}>
                    <div>{it.address}</div>
                    {it.detailAddress ? (
                      <div style={{ fontSize: 12, color: "#666" }}>{it.detailAddress}</div>
                    ) : null}
                  </td>
                  <td style={td}>
                    <div>{fmt(it.managerName)}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>{fmt(it.managerEmail)}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>{fmt(it.managerPhone)}</div>
                  </td>
                  <td style={td}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#5865F2" }}>
                      {(it as any).allowanceRange ?? 100}m
                    </span>
                  </td>
                  <td style={td}>{fmt(it.agencyName)}</td>
                  <td style={td}>{it.basePointConfirmed ? "확정" : "미확정"}</td>
                  <td style={td}>{it.basePointApprovalStatus}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, opacity: page <= 1 ? 0.5 : 1 }}
        >
          이전
        </button>
        <button
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, opacity: page >= totalPages ? 0.5 : 1 }}
        >
          다음
        </button>
      </div>
    </div>
  );
}

const th: CSSProperties = {
  textAlign: "left",
  padding: 10,
  fontSize: 13,
  borderBottom: "1px solid #e5e5e5",
};

const td: CSSProperties = {
  padding: 10,
  fontSize: 13,
  borderBottom: "1px solid #f0f0f0",
  verticalAlign: "top",
};
