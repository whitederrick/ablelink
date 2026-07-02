"use client";

// 위탁기관 관리자 관리 — 전체 위탁기관의 관리자(Manager) 계정을 시스템 관리자가 관리.
// (자가가입 폐지로 '가입 신청 검토'는 폐기. 목록 조회 → 행 클릭 상세 모달 → 활성/비활성·비번 초기화·정보 수정, 상단 초대 발급.)
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, X, Copy } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

const ACTIVE_MAP = { ACTIVE: { label: "활성", tone: "sky" as const }, INACTIVE: { label: "비활성", tone: "rose" as const } };
const PAGE_SIZE = 10;

type Manager = {
  id: string; loginId: string; displayName: string | null;
  isActive: boolean; lastLoginAt: string | null; createdAt: string;
  agencyId: string | null; agencyName: string;
};
type AgencyOpt = { id: string; name: string };

export default function ManagerAccountsPage() {
  const [items, setItems]   = useState<Manager[]>([]);
  const [agencies, setAgencies] = useState<AgencyOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery]   = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage]     = useState(1);
  const [toast, setToast]   = useState("");
  const [processing, setProcessing] = useState(false);

  // 상세 모달
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newPw, setNewPw]       = useState("");

  // 초대 모달
  const [inviteOpen, setInviteOpen]   = useState(false);
  const [inviteAgency, setInviteAgency] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl]     = useState("");
  const [inviteMsg, setInviteMsg]     = useState("");
  const [inviting, setInviting]       = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/system/managers").then(r => r.json())
      .then(d => { if (d.success) setItems(d.managers ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/admin/system/agencies").then(r => r.json())
      .then(d => { if (d.success) setAgencies((d.agencies ?? []).map((a: any) => ({ id: a.id, name: a.name }))); })
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(m => statusFilter.length === 0
        || (statusFilter.includes("ACTIVE") && m.isActive)
        || (statusFilter.includes("INACTIVE") && !m.isActive))
      .filter(m => !q || m.agencyName.toLowerCase().includes(q) || m.loginId.toLowerCase().includes(q) || (m.displayName ?? "").toLowerCase().includes(q));
  }, [items, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  const detail = useMemo(() => items.find(m => m.id === detailId) ?? null, [items, detailId]);
  function openDetail(m: Manager) { setDetailId(m.id); setEditName(m.displayName ?? ""); setNewPw(""); }
  function closeDetail() { setDetailId(null); setNewPw(""); }

  async function patch(id: string, body: any) {
    setProcessing(true);
    const res = await fetch(`/api/admin/system/managers/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json();
    setProcessing(false);
    return data;
  }

  async function toggleActive(m: Manager) {
    const d = await patch(m.id, { action: "toggle-active" });
    if (d.success) { showToast(d.message); load(); } else showToast(d.message || "실패");
  }
  async function saveName() {
    if (!detail) return;
    const d = await patch(detail.id, { action: "update", displayName: editName });
    if (d.success) { showToast(d.message); load(); } else showToast(d.message || "저장 실패");
  }
  async function resetPw() {
    if (!detail) return;
    if (newPw.length < 8) { showToast("비밀번호는 8자 이상이어야 합니다."); return; }
    const d = await patch(detail.id, { action: "reset-password", newPassword: newPw });
    if (d.success) { showToast(d.message); setNewPw(""); } else showToast(d.message || "실패");
  }

  async function issueInvite() {
    if (!inviteAgency) { setInviteMsg("위탁기관을 선택해주세요."); return; }
    setInviting(true); setInviteUrl(""); setInviteMsg("");
    try {
      const res = await fetch(`/api/admin/system/agencies/${inviteAgency}/manager-invite`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim() || null }),
      });
      const d = await res.json();
      if (d.success) {
        setInviteUrl(d.inviteUrl);
        if (d.emailSent) setInviteMsg(`초대 메일을 ${inviteEmail.trim()} 으로 발송했습니다.`);
        else if (d.emailError) setInviteMsg(d.emailError);
        else setInviteMsg("초대 링크를 발급했습니다. 복사해 전달해주세요.");
      } else setInviteMsg(d.message || "초대 발급 실패");
    } catch { setInviteMsg("서버 오류"); }
    finally { setInviting(false); }
  }
  function openInvite() { setInviteOpen(true); setInviteAgency(""); setInviteEmail(""); setInviteUrl(""); setInviteMsg(""); }

  const activeCnt = items.filter(m => m.isActive).length;
  const inactiveCnt = items.length - activeCnt;
  const filters: FilterChip[] = [
    { value: "ACTIVE", label: "활성", count: activeCnt },
    { value: "INACTIVE", label: "비활성", count: inactiveCnt },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  const COLS = ["위탁기관", "아이디", "담당자명", "마지막 로그인", "상태"];

  return (
    <div>
      <PageHeader
        title="위탁기관 관리자 관리"
        sub="전체 위탁기관의 관리자 계정을 관리합니다. 목록에서 관리자를 선택하면 활성/비활성·비밀번호 초기화·정보 수정을 할 수 있습니다."
        actions={
          <button onClick={openInvite} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white active:scale-95">
            <Plus className="h-4 w-4" />관리자 초대
          </button>
        }
      />

      <StatCardRow
        className="mb-5"
        cols={3}
        items={[
          { label: "전체 관리자", value: items.length },
          { label: "활성", value: activeCnt, tone: "emerald" },
          { label: "비활성", value: inactiveCnt, tone: "slate" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="기관명·아이디·담당자명 검색"
          filters={filters}
          selected={statusFilter}
          onToggleFilter={toggleStatus}
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[200px]" />{/* 위탁기관 */}
            <col className="w-[150px]" />{/* 아이디 */}
            <col className="w-[130px]" />{/* 담당자명 */}
            <col className="w-[130px]" />{/* 마지막 로그인 */}
            <col className="w-[90px]" />{/* 상태 */}
          </colgroup>
          <thead>
            <tr>{COLS.map(h => <th key={h} className={T.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={COLS.length} className={T.tdCenter}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={COLS.length} className={T.tdCenter}>{items.length === 0 ? "관리자가 없습니다." : "조건에 맞는 관리자가 없습니다."}</td></tr>
            ) : pageItems.map(m => (
              <tr key={m.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50 ${!m.isActive ? "opacity-50" : ""}`} onClick={() => openDetail(m)}>
                <td className={`${T.td} truncate`}><span className="font-bold text-sky-600">{m.agencyName}</span></td>
                <td className={T.td}>{m.loginId}</td>
                <td className={T.td}>{m.displayName || "-"}</td>
                <td className={T.td}>{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString("ko-KR").slice(2) : "없음"}</td>
                <td className={T.td}><StatusBadge status={m.isActive ? "ACTIVE" : "INACTIVE"} map={ACTIVE_MAP} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <Pagination className="pt-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      )}

      {/* 상세 모달 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5" onClick={closeDetail}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-lg font-black text-slate-900">{detail.loginId}</h2>
              <StatusBadge status={detail.isActive ? "ACTIVE" : "INACTIVE"} map={ACTIVE_MAP} />
            </div>
            <p className="mb-4 text-[13px] font-semibold text-slate-400">
              {detail.agencyName} · 가입 {new Date(detail.createdAt).toLocaleDateString("ko-KR")}
              {detail.lastLoginAt ? ` · 최근 로그인 ${new Date(detail.lastLoginAt).toLocaleDateString("ko-KR")}` : " · 로그인 없음"}
            </p>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">담당자명</label>
                <div className="flex gap-2">
                  <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="담당자명"
                    className={`${T.input} w-full`} />
                  <button onClick={saveName} disabled={processing} className={`${T.btnPrimary} shrink-0`}>저장</button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">비밀번호 초기화</label>
                <div className="flex gap-2">
                  <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="새 비밀번호 (8자 이상)"
                    className={`${T.input} w-full`} />
                  <button onClick={resetPw} disabled={processing} className={`${T.btnSecondary} shrink-0`}>초기화</button>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
              <button onClick={() => toggleActive(detail)} disabled={processing}
                className={detail.isActive ? T.btnDanger
                  : "inline-flex items-center justify-center min-h-10 rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-600 transition hover:bg-emerald-50 active:scale-95"}>
                {detail.isActive ? "비활성화" : "활성화"}
              </button>
              <button onClick={closeDetail} className={T.btnSecondary}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 관리자 초대 모달 */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-5" onClick={() => setInviteOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-base font-black text-slate-900">관리자 초대</p>
              <button onClick={() => setInviteOpen(false)}><X className="h-5 w-5 text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">위탁기관 *</label>
                <select value={inviteAgency} onChange={e => setInviteAgency(e.target.value)} className={`${T.select} w-full`}>
                  <option value="">기관 선택</option>
                  {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">이메일 (선택)</label>
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  placeholder="입력 시 초대 메일 자동 발송" className={`${T.input} w-full`} />
                <p className="mt-1 text-[10px] text-slate-400">비우면 링크만 발급됩니다.</p>
              </div>
              {inviteMsg && <p className="text-[12px] font-semibold text-slate-600">{inviteMsg}</p>}
              {inviteUrl && (
                <div className="rounded-lg border border-sky-100 bg-sky-50 p-2">
                  <p className="mb-1 text-[10px] font-black text-sky-700">초대 링크(7일)</p>
                  <div className="flex items-center gap-1.5">
                    <input readOnly value={inviteUrl} className="min-w-0 flex-1 rounded border border-sky-200 bg-white px-1.5 py-1 text-[10px] text-slate-700" />
                    <button onClick={() => navigator.clipboard?.writeText(inviteUrl)}
                      className="flex shrink-0 items-center gap-1 rounded border border-sky-200 bg-white px-1.5 py-1 text-[10px] font-black text-sky-700"><Copy className="h-3 w-3" /></button>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setInviteOpen(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 active:scale-95">닫기</button>
              <button onClick={issueInvite} disabled={inviting} className="flex-1 rounded-xl bg-slate-950 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-60">{inviting ? "발급 중..." : "초대 발급"}</button>
            </div>
          </div>
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
