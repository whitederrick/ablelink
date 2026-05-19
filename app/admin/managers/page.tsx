// app/admin/managers/page.tsx
// 담당자(기관 매니저) 관리 페이지 (정식 /api/admin/managers CRUD)

"use client";

import { useEffect, useMemo, useState } from "react";

type ManagerItem = {
  id: string;
  agencyId: string | null;
  agencyName: string | null;
  name: string;
  email: string; // ✅ email은 스키마상 필수
  phoneNumber: string | null;
};

type ListResponse =
  | { success: true; page: number; pageSize: number; total: number; items: ManagerItem[] }
  | { success: false; message?: string };

type ItemResponse =
  | { success: true; item?: ManagerItem }
  | { success: true } // DELETE
  | { success: false; message?: string };

type FormState = {
  id?: string;
  name: string;
  email: string; // ✅ UI에서도 필수로 관리
  phoneNumber: string;
  // ADMIN일 때만 의미 있음 (AGENCY는 토큰으로 자동 지정)
  agencyId?: string;
  agencyName?: string;
};

function isAdminRole(sessionRole?: string | null) {
  return String(sessionRole || "").toUpperCase() === "ADMIN";
}

export default function AdminManagersPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ManagerItem[]>([]);
  const [total, setTotal] = useState(0);

  // 세션 role을 UI 분기용으로만 사용(표시/ADMIN 입력필드 노출)
  const [sessionRole, setSessionRole] = useState<string | null>(null);

  // 모달/폼
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    phoneNumber: "",
    agencyId: "",
    agencyName: "",
  });

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  async function fetchSessionRole() {
    try {
      const res = await fetch("/api/admin/auth/me", { method: "GET", cache: "no-store" });
      const data = await res.json();
      if (data?.success && data?.session?.role) setSessionRole(String(data.session.role));
      else setSessionRole(null);
    } catch {
      setSessionRole(null);
    }
  }

  async function fetchList(nextPage?: number) {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      sp.set("page", String(nextPage ?? page));
      sp.set("pageSize", String(pageSize));

      const res = await fetch(`/api/admin/managers?${sp.toString()}`, { method: "GET", cache: "no-store" });
      const data = (await res.json()) as ListResponse;

      if (!data.success) throw new Error(data.message || "FAILED");

      setItems(data.items || []);
      setTotal(Number(data.total || 0));
    } catch (e) {
      console.error(e);
      setItems([]);
      setTotal(0);
      alert("담당자 목록 조회에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSessionRole();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function onSearch() {
    setPage(1);
    fetchList(1);
  }

  function openCreate() {
    setForm({
      name: "",
      email: "",
      phoneNumber: "",
      agencyId: "",
      agencyName: "",
    });
    setModalOpen(true);
  }

  async function openEdit(id: string) {
    // 목록 row를 그대로 써도 되지만, 안전하게 상세 GET(추후 확장 대비)
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/managers/${id}`, { method: "GET", cache: "no-store" });
      const data = (await res.json()) as ItemResponse;
      if (!data.success || !("item" in data) || !data.item) throw new Error((data as any).message || "FAILED");

      const it = data.item;
      setForm({
        id: it.id,
        name: it.name || "",
        email: it.email || "", // ✅ email 필수(방어적으로 빈문자)
        phoneNumber: it.phoneNumber || "",
        agencyId: it.agencyId || "",
        agencyName: it.agencyName || "",
      });
      setModalOpen(true);
    } catch (e) {
      console.error(e);
      alert("담당자 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
  }

  function validateForm() {
    const name = (form.name || "").trim();
    if (!name) return "담당자명을 입력해 주세요.";

    // ✅ email 필수 (API/스키마 정합)
    const email = (form.email || "").trim();
    if (!email) return "이메일을 입력해 주세요.";

    // ADMIN일 때 agency 지정은 정책에 따라 필수로 둘 수도 있음.
    // 현재 UI는 기존 정책 유지: ADMIN은 agencyId 또는 agencyName 중 하나 필요
    if (isAdminRole(sessionRole)) {
      const agencyId = String(form.agencyId || "").trim();
      const agencyName = String(form.agencyName || "").trim();
      if (!agencyId && !agencyName) return "ADMIN은 agencyId 또는 agencyName 중 하나를 입력해야 합니다.";
      if (agencyId && !/^\d+$/.test(agencyId)) return "agencyId는 숫자만 가능합니다.";
    }

    return null;
  }

  async function save() {
    if (saving) return;

    const msg = validateForm();
    if (msg) {
      alert(msg);
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        name: String(form.name || "").trim(),
        email: String(form.email || "").trim(), // ✅ null 금지
        phoneNumber: form.phoneNumber.trim() ? form.phoneNumber.trim() : null,
      };

      if (isAdminRole(sessionRole)) {
        const agencyId = String(form.agencyId || "").trim();
        const agencyName = String(form.agencyName || "").trim();
        if (agencyId) payload.agencyId = agencyId;
        else if (agencyName) payload.agencyName = agencyName;
      }

      const isEdit = !!form.id;
      const url = isEdit ? `/api/admin/managers/${form.id}` : "/api/admin/managers";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as ItemResponse;
      if (!data.success) throw new Error(data.message || "FAILED");

      setModalOpen(false);

      // 목록 리프레시
      await fetchList(1);
      setPage(1);
    } catch (e) {
      console.error(e);
      alert("저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (deletingId) return;
    if (!confirm("정말 삭제하시겠습니까?")) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/managers/${id}`, { method: "DELETE", cache: "no-store" });
      const data = (await res.json()) as ItemResponse;
      if (!data.success) throw new Error(data.message || "FAILED");

      // 페이지 조정: 마지막 아이템 삭제 시 이전 페이지로
      const nextTotal = Math.max(0, total - 1);
      const nextTotalPages = Math.max(1, Math.ceil(nextTotal / pageSize));
      const nextPage = Math.min(page, nextTotalPages);

      setTotal(nextTotal);
      setPage(nextPage);
      await fetchList(nextPage);
    } catch (e) {
      console.error(e);
      alert("삭제에 실패했습니다.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111", margin: 0 }}>담당자(기관) 관리</h1>
        <button
          onClick={openCreate}
          style={{ padding: "9px 18px", border: "none", borderRadius: 8, background: "#5865F2", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14 }}
        >
          + 신규 등록
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          placeholder="담당자명/메일/전화/기관 검색"
          style={{ flex: 1, height: 40, border: "1px solid #ddd", borderRadius: 8, padding: "0 14px", fontSize: 14, outline: "none" }}
        />
        <button onClick={onSearch} style={{ padding: "0 20px", height: 40, border: "none", borderRadius: 8, background: "#5865F2", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
          검색
        </button>
      </div>

      <div style={{ marginBottom: 12, fontSize: 13, color: "#888" }}>
        총 {total}건 (page {page} / {totalPages})
      </div>

      <div style={{ backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f8f9ff" }}>
            <tr>
              <th style={th}>ID</th>
              <th style={th}>담당자명</th>
              <th style={th}>이메일</th>
              <th style={th}>전화</th>
              <th style={th}>기관</th>
              <th style={th}>작업</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td style={td} colSpan={6}>
                  로딩 중...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td style={td} colSpan={6}>
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id}>
                  <td style={td}>{it.id}</td>
                  <td style={td}>
                    <button
                      onClick={() => openEdit(it.id)}
                      style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
                      title="수정"
                    >
                      <span style={{ textDecoration: "underline" }}>{it.name}</span>
                    </button>
                  </td>
                  <td style={td}>{it.email}</td>
                  <td style={td}>{it.phoneNumber ?? "-"}</td>
                  <td style={td}>
                    <div>{it.agencyName ?? "-"}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>{it.agencyId ?? "-"}</div>
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => openEdit(it.id)}
                        style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 8, background: "#fff" }}
                      >
                        수정
                      </button>
                      <button
                        onClick={() => remove(it.id)}
                        disabled={deletingId === it.id}
                        style={{
                          padding: "6px 10px",
                          border: "1px solid #ef4444",
                          borderRadius: 8,
                          background: "#fff",
                          color: "#ef4444",
                          opacity: deletingId === it.id ? 0.6 : 1,
                        }}
                      >
                        {deletingId === it.id ? "삭제 중..." : "삭제"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          style={{ padding: "8px 16px", border: "1.5px solid #eee", borderRadius: 8, background: "#fff", cursor: "pointer", opacity: page <= 1 ? 0.4 : 1, fontWeight: 600 }}
        >
          이전
        </button>
        <span style={{ fontSize: 13, color: "#888" }}>{page} / {totalPages}</span>
        <button
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          style={{ padding: "8px 16px", border: "1.5px solid #eee", borderRadius: 8, background: "#fff", cursor: "pointer", opacity: page >= totalPages ? 0.4 : 1, fontWeight: 600 }}
        >
          다음
        </button>
      </div>

      {/* ===== Modal ===== */}
      {modalOpen ? (
        <div style={overlay} onClick={closeModal}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                {form.id ? "담당자 수정" : "담당자 신규 등록"}
              </h2>
              <button onClick={closeModal} disabled={saving} style={xBtn}>
                ✕
              </button>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <Field label="담당자명 *">
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="예) 홍길동"
                  style={input}
                />
              </Field>

              <Field label="이메일 *">
                <input
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="예) manager@agency.com"
                  style={input}
                />
              </Field>

              <Field label="전화">
                <input
                  value={form.phoneNumber}
                  onChange={(e) => setForm((p) => ({ ...p, phoneNumber: e.target.value }))}
                  placeholder="예) 01012345678"
                  style={input}
                />
              </Field>

              {isAdminRole(sessionRole) ? (
                <div style={{ padding: 10, border: "1px dashed #d1d5db", borderRadius: 10, background: "#fafafa" }}>
                  <div style={{ fontSize: 12, color: "#374151", marginBottom: 8 }}>
                    ADMIN 전용: agencyId 또는 agencyName 중 하나 입력
                  </div>

                  <Field label="agencyId">
                    <input
                      value={form.agencyId || ""}
                      onChange={(e) => setForm((p) => ({ ...p, agencyId: e.target.value }))}
                      placeholder="숫자 ID"
                      style={input}
                    />
                  </Field>

                  <Field label="agencyName">
                    <input
                      value={form.agencyName || ""}
                      onChange={(e) => setForm((p) => ({ ...p, agencyName: e.target.value }))}
                      placeholder="기관명"
                      style={input}
                    />
                  </Field>

                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                    주의: 둘 다 입력하면 agencyId가 우선 적용됩니다.
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  AGENCY 계정은 토큰 기반으로 기관이 자동 지정됩니다.
                </div>
              )}
            </div>

            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={closeModal} disabled={saving} style={btnSecondary}>
                취소
              </button>
              <button onClick={save} disabled={saving} style={btnPrimary}>
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, color: "#374151", fontWeight: 700 }}>{label}</div>
      {children}
    </label>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: 10,
  fontSize: 13,
  borderBottom: "1px solid #e5e5e5",
};

const td: React.CSSProperties = {
  padding: 10,
  fontSize: 13,
  borderBottom: "1px solid #f0f0f0",
  verticalAlign: "top",
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.38)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 9999,
};

const modal: React.CSSProperties = {
  width: "min(720px, 100%)",
  background: "#fff",
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  padding: 16,
  boxShadow: "0 20px 50px rgba(0,0,0,0.15)",
};

const input: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  fontSize: 13,
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #111827",
  background: "#111827",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontSize: 13,
  cursor: "pointer",
};

const xBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#fff",
  cursor: "pointer",
};
