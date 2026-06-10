"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Plus, UserCheck, UserX, KeyRound, Pencil, Mail, Phone } from "lucide-react";
import PageHeader from "../_components/PageHeader";
import { T } from "../_styles";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import { StatCardRow } from "../_components/StatCard";

const PAGE_SIZE = 20;

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
    if (data.success) { showToast(data.message); load(); }
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
            <Plus className="h-4 w-4" />운영자 생성
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
          <p className="text-base font-black text-slate-900">신규 운영자 생성</p>
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
              {processing ? "생성 중..." : "운영자 생성"}
            </button>
          </div>
        </div>
      )}

      {/* 비밀번호 초기화 모달 */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-5">
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
            <div className="mt-5 flex gap-2">
              <button onClick={() => setDetailTarget(null)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 active:scale-95">닫기</button>
              <button onClick={saveDetail} disabled={processing}
                className="flex-1 rounded-xl bg-slate-950 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-60">
                {processing ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-5 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">계정</th>
                <th className="px-5 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">연락처</th>
                <th className="px-5 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">마지막 로그인</th>
                <th className="px-5 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">상태</th>
                <th className="px-5 py-3 text-center text-xs font-black uppercase tracking-wide text-slate-500">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">{admins.length===0?"운영자가 없습니다.":"조건에 맞는 운영자가 없습니다."}</td></tr>
              ) : pageItems.map(a => (
                <tr key={a.id} className={`hover:bg-slate-50 transition ${!a.isActive ? "opacity-50" : ""}`}>
                  <td className="px-5 py-2.5">
                    <button onClick={() => openDetail(a)} className="text-[15px] font-black text-slate-900 hover:text-sky-600 hover:underline">{a.loginId}</button>
                    {a.displayName ? <span className="text-[13px] text-slate-500"> ({a.displayName})</span> : ""}
                  </td>
                  <td className="px-5 py-2.5 text-[13px] text-slate-600">
                    <div className="flex items-center gap-3">
                      {a.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5 text-slate-400" />{a.email}</span>}
                      {a.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5 text-slate-400" />{a.phone}</span>}
                      {!a.email && !a.phone && <span className="text-slate-300">—</span>}
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-[15px] font-medium text-slate-800">
                    {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleDateString("ko-KR") : "없음"}
                  </td>
                  <td className="px-5 py-2.5">
                    <span className={`${T.badge} ${a.isActive ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                      {a.isActive ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => openDetail(a)} title="상세·편집"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 active:scale-95">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setResetTarget(a)} title="비밀번호 초기화"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 active:scale-95">
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => toggleActive(a)} disabled={processing}
                        title={a.isActive ? "비활성화" : "활성화"}
                        className={`rounded-lg border p-1.5 active:scale-95 ${a.isActive ? "border-rose-200 text-rose-500 hover:bg-rose-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}>
                        {a.isActive ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
        </div>
      )}

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
