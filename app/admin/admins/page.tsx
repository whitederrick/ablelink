"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, RefreshCw, UserCheck, UserX, KeyRound, Building2 } from "lucide-react";

type AdminAccount = {
  id: string;
  loginId: string;
  role: "ADMIN" | "AGENCY" | "GOV";
  displayName: string;
  agencyId: string | null;
  agencyName: string | null;
  planType: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type Agency = { id: string; name: string; planType: string };

const ROLE_COLORS: Record<string, string> = {
  ADMIN:  "bg-emerald-100 text-emerald-700",
  AGENCY: "bg-sky-100 text-sky-700",
  GOV:    "bg-slate-100 text-slate-600",
};

export default function AdminsPage() {
  const [admins, setAdmins]       = useState<AdminAccount[]>([]);
  const [agencies, setAgencies]   = useState<Agency[]>([]);
  const [loading, setLoading]     = useState(true);
  const [toast, setToast]         = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminAccount | null>(null);
  const [newPw, setNewPw]         = useState("");
  const [processing, setProcessing] = useState(false);

  // 신규 계정 폼
  const [form, setForm] = useState({ loginId: "", password: "", role: "AGENCY", displayName: "", agencyId: "" });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/system/admins").then(r => r.json()),
      fetch("/api/admin/system/agencies").then(r => r.json()),
    ]).then(([aRes, agRes]) => {
      if (aRes.success)  setAdmins(aRes.admins);
      if (agRes.success) setAgencies(agRes.agencies);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createAdmin() {
    if (!form.loginId || !form.password) { showToast("아이디와 비밀번호를 입력해주세요."); return; }
    if (form.role === "AGENCY" && !form.agencyId) { showToast("에이전시를 선택해주세요."); return; }
    setProcessing(true);
    const res = await fetch("/api/admin/system/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, agencyId: form.agencyId || null }),
    });
    const data = await res.json();
    setProcessing(false);
    if (data.success) { showToast("계정이 생성되었습니다."); setShowCreate(false); setForm({ loginId: "", password: "", role: "AGENCY", displayName: "", agencyId: "" }); load(); }
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">운영자 계정 관리</h1>
          <p className="mt-0.5 text-sm text-slate-500">시스템 운영자 및 에이전시 관리자 계정을 관리합니다.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white active:scale-95">
          <Plus className="h-4 w-4" />계정 생성
        </button>
      </div>

      {/* 계정 생성 폼 */}
      {showCreate && (
        <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-5 space-y-4">
          <p className="text-base font-black text-slate-900">신규 계정 생성</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">아이디</label>
              <input value={form.loginId} onChange={e => setForm(f => ({ ...f, loginId: e.target.value }))}
                placeholder="로그인 아이디"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">비밀번호</label>
              <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="8자 이상"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">표시 이름</label>
              <input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                placeholder="이름 (선택)"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">역할</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value, agencyId: "" }))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400">
                <option value="ADMIN">시스템 운영자 (ADMIN)</option>
                <option value="AGENCY">에이전시 관리자 (AGENCY)</option>
              </select>
            </div>
            {form.role === "AGENCY" && (
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-600">소속 에이전시</label>
                <select value={form.agencyId} onChange={e => setForm(f => ({ ...f, agencyId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400">
                  <option value="">에이전시 선택</option>
                  {agencies.map(a => <option key={a.id} value={a.id}>{a.name} ({a.planType})</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 active:scale-95">
              취소
            </button>
            <button onClick={createAdmin} disabled={processing}
              className="flex-1 rounded-xl bg-slate-950 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-60">
              {processing ? "생성 중..." : "계정 생성"}
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
                <th className="px-5 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">역할</th>
                <th className="px-5 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">소속 에이전시</th>
                <th className="px-5 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">마지막 로그인</th>
                <th className="px-5 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">상태</th>
                <th className="px-5 py-3 text-center text-xs font-black uppercase tracking-wide text-slate-500">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {admins.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">계정이 없습니다.</td></tr>
              ) : admins.map(a => (
                <tr key={a.id} className={`hover:bg-slate-50 transition ${!a.isActive ? "opacity-50" : ""}`}>
                  <td className="px-5 py-3.5">
                    <p className="font-semibold text-slate-900">{a.loginId}</p>
                    {a.displayName && <p className="text-xs text-slate-400">{a.displayName}</p>}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-black ${ROLE_COLORS[a.role] ?? "bg-slate-100 text-slate-600"}`}>
                      {a.role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {a.agencyName ? (
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <Building2 className="h-3.5 w-3.5" />
                        <span className="font-semibold">{a.agencyName}</span>
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-5 py-3.5 text-slate-400 text-xs">
                    {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleDateString("ko-KR") : "없음"}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${a.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {a.isActive ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-center gap-1.5">
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
