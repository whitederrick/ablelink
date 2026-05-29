"use client";

import { useEffect, useMemo, useState } from "react";
import { T } from "../_styles";
import { X } from "lucide-react";

type ManagerItem = {
  id: string; agencyId: string | null; agencyName: string | null;
  name: string; email: string; phoneNumber: string | null;
};
type FormState = {
  id?: string; name: string; email: string; phoneNumber: string;
  agencyId?: string; agencyName?: string;
};

function isAdminRole(r?: string | null) { return String(r || "").toUpperCase() === "ADMIN"; }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className={T.label}>{label}</label>
      {children}
    </div>
  );
}

export default function AdminManagersPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ManagerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ name: "", email: "", phoneNumber: "", agencyId: "", agencyName: "" });
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);

  async function fetchSessionRole() {
    try {
      const res = await fetch("/api/manager/auth/me", { cache: "no-store" });
      const data = await res.json();
      setSessionRole(data?.success ? String(data.session?.role || "") : null);
    } catch { setSessionRole(null); }
  }

  async function fetchList(nextPage?: number) {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      sp.set("page", String(nextPage ?? page));
      sp.set("pageSize", String(pageSize));
      const res = await fetch(`/api/admin/managers?${sp}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setItems(data.items || []); setTotal(data.total || 0);
    } catch { setItems([]); setTotal(0); alert("담당자 목록 조회에 실패했습니다."); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchSessionRole(); }, []);
  useEffect(() => { fetchList(); }, [page]);

  async function openEdit(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/managers/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.success || !data.item) throw new Error(data.message);
      const it = data.item;
      setForm({ id: it.id, name: it.name || "", email: it.email || "", phoneNumber: it.phoneNumber || "", agencyId: it.agencyId || "", agencyName: it.agencyName || "" });
      setModalOpen(true);
    } catch { alert("담당자 정보를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }

  async function save() {
    if (saving) return;
    const name = form.name.trim(), email = form.email.trim();
    if (!name) return alert("담당자명을 입력해 주세요.");
    if (!email) return alert("이메일을 입력해 주세요.");
    if (isAdminRole(sessionRole)) {
      const agId = String(form.agencyId || "").trim(), agName = String(form.agencyName || "").trim();
      if (!agId && !agName) return alert("ADMIN은 agencyId 또는 agencyName 중 하나를 입력해야 합니다.");
      if (agId && !/^\d+$/.test(agId)) return alert("agencyId는 숫자만 가능합니다.");
    }
    setSaving(true);
    try {
      const payload: any = { name, email, phoneNumber: form.phoneNumber.trim() || null };
      if (isAdminRole(sessionRole)) {
        const agId = String(form.agencyId || "").trim(), agName = String(form.agencyName || "").trim();
        if (agId) payload.agencyId = agId; else if (agName) payload.agencyName = agName;
      }
      const res = await fetch(form.id ? `/api/admin/managers/${form.id}` : "/api/admin/managers", {
        method: form.id ? "PATCH" : "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setModalOpen(false); await fetchList(1); setPage(1);
    } catch { alert("저장에 실패했습니다."); }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (deletingId || !confirm("정말 삭제하시겠습니까?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/managers/${id}`, { method: "DELETE", cache: "no-store" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      const nextTotal = Math.max(0, total - 1);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(nextTotal / pageSize)));
      setTotal(nextTotal); setPage(nextPage); await fetchList(nextPage);
    } catch { alert("삭제에 실패했습니다."); }
    finally { setDeletingId(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className={T.pageTitle}>담당자(기관) 관리</h1>
        <button onClick={() => { setForm({ name: "", email: "", phoneNumber: "", agencyId: "", agencyName: "" }); setModalOpen(true); }}
          className={T.btnPrimary}>+ 신규 등록</button>
      </div>

      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && (setPage(1), fetchList(1))}
          placeholder="담당자명/메일/전화/기관 검색" className={`flex-1 ${T.input}`} />
        <button onClick={() => { setPage(1); fetchList(1); }} className={T.btnSecondary}>검색</button>
      </div>

      <p className="text-sm font-semibold text-slate-400">총 {total}건 (page {page} / {totalPages})</p>

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["ID", "담당자명", "이메일", "전화", "기관", "작업"].map(h => <th key={h} className={T.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className={T.tdCenter}>로딩 중...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className={T.tdCenter}>데이터가 없습니다.</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className={T.trBase}>
                <td className={`${T.td} text-xs text-slate-400`}>{it.id}</td>
                <td className={T.td}>
                  <button onClick={() => openEdit(it.id)} className="font-black text-slate-900 underline transition hover:text-sky-600">
                    {it.name}
                  </button>
                </td>
                <td className={`${T.td} text-slate-600`}>{it.email}</td>
                <td className={`${T.td} text-slate-500`}>{it.phoneNumber ?? "-"}</td>
                <td className={T.td}>
                  <div className="font-semibold text-slate-700">{it.agencyName ?? "-"}</div>
                  <div className="text-xs text-slate-400">{it.agencyId ?? "-"}</div>
                </td>
                <td className={T.td}>
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(it.id)} className={T.btnSecondary}>수정</button>
                    <button onClick={() => remove(it.id)} disabled={deletingId === it.id} className={T.btnDanger}>
                      {deletingId === it.id ? "삭제 중..." : "삭제"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
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

      {modalOpen && (
        <div className={T.modalOverlay} onClick={() => !saving && setModalOpen(false)}>
          <div className={T.modalContent} onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900">
                {form.id ? "담당자 수정" : "담당자 신규 등록"}
              </h2>
              <button onClick={() => !saving && setModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3">
              <Field label="담당자명 *">
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="예) 홍길동" className={`w-full ${T.input}`} />
              </Field>
              <Field label="이메일 *">
                <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="예) manager@agency.com" className={`w-full ${T.input}`} />
              </Field>
              <Field label="전화">
                <input value={form.phoneNumber} onChange={e => setForm(p => ({ ...p, phoneNumber: e.target.value }))}
                  placeholder="예) 01012345678" className={`w-full ${T.input}`} />
              </Field>

              {isAdminRole(sessionRole) ? (
                <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
                  <p className="text-xs font-black text-slate-700">ADMIN 전용: agencyId 또는 agencyName 중 하나 입력</p>
                  <Field label="agencyId">
                    <input value={form.agencyId || ""} onChange={e => setForm(p => ({ ...p, agencyId: e.target.value }))}
                      placeholder="숫자 ID" className={`w-full ${T.input}`} />
                  </Field>
                  <Field label="agencyName">
                    <input value={form.agencyName || ""} onChange={e => setForm(p => ({ ...p, agencyName: e.target.value }))}
                      placeholder="기관명" className={`w-full ${T.input}`} />
                  </Field>
                  <p className="text-xs font-semibold text-slate-400">둘 다 입력하면 agencyId가 우선 적용됩니다.</p>
                </div>
              ) : (
                <p className="text-xs font-semibold text-slate-400">AGENCY 계정은 토큰 기반으로 기관이 자동 지정됩니다.</p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => !saving && setModalOpen(false)} disabled={saving} className={T.btnSecondary}>취소</button>
              <button onClick={save} disabled={saving} className={T.btnPrimary}>
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
