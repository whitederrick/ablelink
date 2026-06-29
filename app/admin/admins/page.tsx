"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Plus } from "lucide-react";
import PageHeader from "../_components/PageHeader";
import { T } from "../_styles";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

const ACTIVE_STATUS_MAP = { ACTIVE: { label: "활성", tone: "sky" as const }, INACTIVE: { label: "비활성", tone: "rose" as const } };

const PAGE_SIZE = 10;

type AdminAccount = {
  id: string;
  loginId: string;
  displayName: string;
  email: string;
  phone: string;
  note: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

const EMPTY_FORM = { loginId: "", password: "", displayName: "", email: "", phone: "", note: "" };

export default function AdminsPage() {
  const [admins, setAdmins]       = useState<AdminAccount[]>([]);
  const [loading, setLoading]     = useState(true);
  const [query, setQuery]         = useState("");
  const [activeFilter, setActiveFilter] = useState<string[]>([]);
  const [page, setPage]           = useState(1);
  const [toast, setToast]         = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminAccount | null>(null);
  const [newPw, setNewPw]         = useState("");
  const [processing, setProcessing] = useState(false);

  // 신규 계정 폼
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // 상세/편집 모달
  const [detailTarget, setDetailTarget] = useState<AdminAccount | null>(null);
  const [edit, setEdit] = useState({ displayName: "", email: "", phone: "", note: "" });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/system/admins").then(r => r.json())
      .then(res => { if (res.success) setAdmins(res.admins); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return admins
      .filter(a => activeFilter.length === 0
        || (activeFilter.includes("ACTIVE") && a.isActive)
        || (activeFilter.includes("INACTIVE") && !a.isActive))
      .filter(a => !q || a.loginId.toLowerCase().includes(q) || (a.displayName ?? "").toLowerCase().includes(q) || (a.email ?? "").toLowerCase().includes(q));
  }, [admins, query, activeFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, activeFilter]);

  async function createAdmin() {
    if (!form.loginId || !form.password) { showToast("아이디와 비밀번호를 입력해주세요."); return; }
    setProcessing(true);
    const res = await fetch("/api/admin/system/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setProcessing(false);
    if (data.success) { showToast("운영자 계정이 생성되었습니다."); setShowCreate(false); setForm({ ...EMPTY_FORM }); load(); }
    else showToast(data.message || "생성 실패");
  }

  async function toggleActive(admin: AdminAccount) {
    setProcessing(true);
    const res = await fetch(`/api/admin/system/admins/${admin.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle-active" }),
    });
    const data = await res.json();
    setProcessing(false);
    if (data.success) {
      showToast(data.message);
      setDetailTarget(t => (t && t.id === admin.id ? { ...t, isActive: !t.isActive } : t));
      load();
    }
    else showToast(data.message || "실패");
  }

  async function resetPassword() {
    if (!resetTarget || !newPw || newPw.length < 8) { showToast("비밀번호는 8자 이상이어야 합니다."); return; }
    setProcessing(true);
    const res = await fetch(`/api/admin/system/admins/${resetTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset-password", newPassword: newPw }),
    });
    const data = await res.json();
    setProcessing(false);
    if (data.success) { showToast(data.message); setResetTarget(null); setNewPw(""); }
    else showToast(data.message || "실패");
  }

  function openDetail(a: AdminAccount) {
    setDetailTarget(a);
    setEdit({ displayName: a.displayName, email: a.email, phone: a.phone, note: a.note });
  }

  async function saveDetail() {
    if (!detailTarget) return;
    setProcessing(true);
    const res = await fetch(`/api/admin/system/admins/${detailTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", ...edit }),
    });
    const data = await res.json();
    setProcessing(false);
    if (data.success) { showToast("운영자 정보가 저장되었습니다."); setDetailTarget(null); load(); }
    else showToast(data.message || "저장 실패");
  }

  return (
    <div>
      <PageHeader
        title="시스템 운영자 관리"
        sub="플랫폼 시스템 운영자 계정을 관리합니다."
        actions={
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white active:scale-95">
            <Plus className="h-4 w-4" />운영자 등록
          </button>
        }
      />

      <StatCardRow
        className="mb-5"
        cols={3}
        items={[
          { label: "전체 운영자", value: admins.length },
          { label: "활성", value: admins.filter(a=>a.isActive).length, tone: "emerald" },
          { label: "비활성", value: admins.filter(a=>!a.isActive).length, tone: "slate" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="아이디·이름·이메일 검색"
          filters={[
            { value: "ACTIVE", label: "활성", count: admins.filter(a=>a.isActive).length },
            { value: "INACTIVE", label: "비활성", count: admins.filter(a=>!a.isActive).length },
          ] as FilterChip[]}
          selected={activeFilter}
          onToggleFilter={(v)=>setActiveFilter(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v])}
        />
      </div>

      {/* 계정 생성 폼 */}
      {showCreate && (
        <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-5 space-y-4">
          <p className="text-base font-black text-slate-900">운영자 등록</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">아이디 *</label>
              <input value={form.loginId} onChange={e => setForm(f => ({ ...f, loginId: e.target.value }))}
                placeholder="로그인 아이디"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">비밀번호 *</label>
              <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="8자 이상"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">이름</label>
              <input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                placeholder="이름 (선택)"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">이메일</label>
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="이메일 (선택)"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">연락처</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="연락처 (선택)"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-600">메모</label>
              <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="담당 업무·비고 (선택)"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowCreate(false); setForm({ ...EMPTY_FORM }); }}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 active:scale-95">
              취소
            </button>
            <button onClick={createAdmin} disabled={processing}
              className="flex-1 rounded-xl bg-slate-950 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-60">
              {processing ? "등록 중..." : "운영자 등록"}
            </button>
          </div>
        </div>
      )}

      {/* 비밀번호 초기화 모달 */}
      {resetTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 px-5">
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-2xl">
            <p className="mb-1 text-base font-black text-slate-900">비밀번호 초기화</p>
            <p className="mb-4 text-sm text-slate-500">{resetTarget.loginId}</p>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
              placeholder="새 비밀번호 (8자 이상)"
              className="mb-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400" />
            <div className="flex gap-2">
              <button onClick={() => { setResetTarget(null); setNewPw(""); }}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 active:scale-95">취소</button>
              <button onClick={resetPassword} disabled={processing}
                className="flex-1 rounded-xl bg-slate-950 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-60">
                {processing ? "..." : "초기화"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 상세/편집 모달 */}
      {detailTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-5" onClick={() => setDetailTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4">
              <p className="text-base font-black text-slate-900">{detailTarget.loginId}</p>
              <p className="mt-0.5 text-[13px] font-semibold text-slate-400">
                가입 {new Date(detailTarget.createdAt).toLocaleDateString("ko-KR")} ·
                {detailTarget.lastLoginAt ? ` 최근 로그인 ${new Date(detailTarget.lastLoginAt).toLocaleDateString("ko-KR")}` : " 로그인 없음"}
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">이름</label>
                <input value={edit.displayName} onChange={e => setEdit(s => ({ ...s, displayName: e.target.value }))}
                  placeholder="이름"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">이메일</label>
                <input value={edit.email} onChange={e => setEdit(s => ({ ...s, email: e.target.value }))}
                  placeholder="이메일"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">연락처</label>
                <input value={edit.phone} onChange={e => setEdit(s => ({ ...s, phone: e.target.value }))}
                  placeholder="연락처"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">메모</label>
                <textarea value={edit.note} onChange={e => setEdit(s => ({ ...s, note: e.target.value }))}
                  placeholder="담당 업무·비고" rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400" />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
              <div className="flex items-center gap-2">
                <button onClick={() => toggleActive(detailTarget)} disabled={processing}
                  className={detailTarget.isActive ? T.btnDanger
                    : "inline-flex items-center justify-center min-h-10 rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-600 transition hover:bg-emerald-50 active:scale-95"}>
                  {detailTarget.isActive ? "비활성화" : "활성화"}
                </button>
                <button onClick={() => setResetTarget(detailTarget)} className={T.btnSecondary}>비밀번호 초기화</button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setDetailTarget(null)} className={T.btnSecondary}>닫기</button>
                <button onClick={saveDetail} disabled={processing} className={T.btnPrimary}>
                  {processing ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[150px]" />{/* 아이디 */}
            <col className="w-[110px]" />{/* 이름 */}
            <col className="w-[220px]" />{/* 이메일 */}
            <col className="w-[140px]" />{/* 연락처 */}
            <col className="w-[120px]" />{/* 마지막 로그인 */}
            <col className="w-[88px]" />{/* 상태 */}
          </colgroup>
          <thead>
            <tr>{["아이디", "이름", "이메일", "연락처", "마지막 로그인", "상태"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className={T.tdCenter}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className={T.tdCenter}>{admins.length === 0 ? "운영자가 없습니다." : "조건에 맞는 운영자가 없습니다."}</td></tr>
            ) : pageItems.map(a => (
              <tr key={a.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50 ${!a.isActive ? "opacity-50" : ""}`} onClick={() => openDetail(a)}>
                <td className={`${T.td} truncate`}><span className="font-bold text-sky-600">{a.loginId}</span></td>
                <td className={`${T.td} truncate`}>{a.displayName || "-"}</td>
                <td className={`${T.td} truncate`}>{a.email || "-"}</td>
                <td className={`${T.td} truncate`}>{a.phone || "-"}</td>
                <td className={T.td}>{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleDateString("ko-KR").slice(2) : "없음"}</td>
                <td className={T.td}><StatusBadge status={a.isActive ? "ACTIVE" : "INACTIVE"} map={ACTIVE_STATUS_MAP} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <Pagination className="pt-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      )}

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
