"use client";

// 에이전시 상세 본문 — 목록의 모달 팝업과 /admin/agencies/[id] 페이지가 공유.
// onClose 제공 시 모달 모드(닫기 버튼), 미제공 시 페이지 모드(router.back).
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Users, MapPin, Activity, Cpu, UserPlus, Copy } from "lucide-react";
import { T } from "../_styles";

const PLAN_COLORS: Record<string, string> = {
  FREE:     "bg-slate-100 text-slate-600",
  TRIAL:    "bg-amber-100 text-amber-700",
  STARTER:  "bg-sky-100 text-sky-700",
  STANDARD: "bg-violet-100 text-violet-700",
  PRO:      "bg-emerald-100 text-emerald-700",
};

type AgencyDetail = {
  id: string; name: string; planType: string; isActive: boolean;
  trialEndsAt: string | null; subscribedAt: string | null; nextBillingAt: string | null;
  maxWorkers: number; maxSites: number; createdAt: string;
  billingCycle: string; customAmount: number | null; billingNote: string | null;
};
type Manager = { id: string; loginId: string; displayName: string | null; isActive: boolean; lastLoginAt: string | null };
type Site    = { id: string; companyName: string; traineeCount: number };
type Worker   = { id: string; workerName: string; status: string };
type Stats   = { logCount: number; attCount: number; apiUsage: { service: string; count: number }[] };

function fmt(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR");
}
function fmtDt(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("ko-KR");
}

export default function AgencyDetail({ id, onClose }: { id: string; onClose?: () => void }) {
  const router  = useRouter();

  const [agency,   setAgency]   = useState<AgencyDetail | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [sites,    setSites]    = useState<Site[]>([]);
  const [workers, setWorkers]  = useState<Worker[]>([]);
  const [stats,    setStats]    = useState<Stats | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");

  // 결제 딜 설정 (건바이건)
  const [dealCycle,  setDealCycle]  = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [dealAmount, setDealAmount] = useState("");
  const [dealNote,   setDealNote]   = useState("");
  const [savingDeal, setSavingDeal] = useState(false);
  const [dealMsg,    setDealMsg]    = useState("");

  // 관리자 초대/토글
  const [inviting,   setInviting]   = useState(false);
  const [inviteUrl,  setInviteUrl]  = useState("");
  const [togglingId, setTogglingId] = useState("");

  const loadDetail = useCallback(async (withSpinner = true) => {
    if (withSpinner) setLoading(true);
    try {
      const res = await fetch(`/api/admin/system/agencies/${id}/detail`, { cache: "no-store" });
      const d = await res.json();
      if (d.success) {
        setAgency(d.agency);
        setManagers(d.managers);
        setSites(d.sites);
        setWorkers(d.workers);
        setStats(d.stats);
        setDealCycle(d.agency.billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY");
        setDealAmount(d.agency.customAmount != null ? String(d.agency.customAmount) : "");
        setDealNote(d.agency.billingNote ?? "");
      } else {
        setError(d.message ?? "로드 실패");
      }
    } catch { setError("서버 오류"); }
    finally { if (withSpinner) setLoading(false); }
  }, [id]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  async function issueInvite() {
    setInviting(true); setInviteUrl("");
    try {
      const res = await fetch(`/api/admin/system/agencies/${id}/manager-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (d.success) setInviteUrl(d.inviteUrl);
      else alert(d.message || "초대 발급 실패");
    } catch { alert("서버 오류"); }
    finally { setInviting(false); }
  }

  async function toggleManager(mid: string, next: boolean) {
    setTogglingId(mid);
    try {
      const res = await fetch(`/api/admin/system/managers/${mid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      const d = await res.json();
      if (!d.success) { alert(d.message || "변경 실패"); return; }
      await loadDetail(false);
    } catch { alert("서버 오류"); }
    finally { setTogglingId(""); }
  }

  async function saveDeal() {
    setSavingDeal(true); setDealMsg("");
    try {
      const res = await fetch(`/api/admin/system/agencies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billingCycle: dealCycle,
          customAmount: dealAmount.trim() === "" ? null : Number(dealAmount),
          billingNote:  dealNote.trim() || null,
        }),
      });
      const d = await res.json();
      if (d.success) {
        setDealMsg("저장되었습니다. 다음 결제·구독부터 적용됩니다.");
        setAgency(a => a ? { ...a, billingCycle: dealCycle, customAmount: dealAmount.trim() === "" ? null : Number(dealAmount), billingNote: dealNote.trim() || null } : a);
      } else {
        setDealMsg(d.message ?? "저장 실패");
      }
    } catch { setDealMsg("서버 오류"); }
    finally { setSavingDeal(false); }
  }

  if (loading) return (
    <div className="flex h-60 items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
    </div>
  );

  if (error || !agency) return (
    <div className="flex h-60 flex-col items-center justify-center gap-3">
      <p className="text-sm text-slate-500">{error || "에이전시를 찾을 수 없습니다."}</p>
      <button onClick={() => onClose ? onClose() : router.back()} className={T.btnSecondary}>← 뒤로</button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <button onClick={() => onClose ? onClose() : router.back()} className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" />{onClose ? "닫기" : "에이전시 목록"}
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <Building2 className="h-6 w-6 text-slate-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black text-slate-900">{agency.name}</h1>
              <span className={`${T.badge} ${PLAN_COLORS[agency.planType] ?? "bg-slate-100 text-slate-600"}`}>
                {agency.planType}
              </span>
              {!agency.isActive && (
                <span className={`${T.badge} bg-rose-100 text-rose-600`}>비활성</span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-slate-400">가입일: {fmt(agency.createdAt)}</p>
          </div>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-3.5">
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{managers.length}</p>
          <p className={T.summaryLabel}>관리자</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{sites.length}</p>
          <p className={T.summaryLabel}>현장</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{workers.length}</p>
          <p className={T.summaryLabel}>직무지도원</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{stats?.attCount ?? 0}</p>
          <p className={T.summaryLabel}>출근 기록</p>
        </div>
      </div>

      {/* 구독 정보 */}
      <div className={T.card}>
        <p className="mb-3 text-sm font-black text-slate-700">구독 정보</p>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-slate-400">구독 시작</p>
            <p className="mt-0.5 font-semibold text-slate-800">{fmt(agency.subscribedAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">다음 결제</p>
            <p className="mt-0.5 font-semibold text-slate-800">{fmt(agency.nextBillingAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">체험 종료</p>
            <p className="mt-0.5 font-semibold text-slate-800">{fmt(agency.trialEndsAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">최대 직무지도원</p>
            <p className="mt-0.5 font-semibold text-slate-800">{agency.maxWorkers || "무제한"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">최대 현장</p>
            <p className="mt-0.5 font-semibold text-slate-800">{agency.maxSites || "무제한"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">일지 기록 수</p>
            <p className="mt-0.5 font-semibold text-slate-800">{(stats?.logCount ?? 0).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* 결제 딜 설정 (건바이건) */}
      <div className={T.card}>
        <p className="mb-1 text-sm font-black text-slate-700">결제 딜 설정 (건바이건)</p>
        <p className="mb-3 text-xs text-slate-400">
          협상가를 입력하면 표준 월정액 대신 그 금액으로 청구됩니다. 비우면 표준 월정액. 다음 결제·구독부터 적용.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <label className="text-xs font-semibold text-slate-400">결제 주기</label>
            <div className="mt-1 flex gap-2">
              {(["MONTHLY", "ANNUAL"] as const).map(c => (
                <button key={c} onClick={() => setDealCycle(c)}
                  className={`flex-1 rounded-xl border px-3 py-2 font-semibold transition ${
                    dealCycle === c ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}>
                  {c === "MONTHLY" ? "월" : "연"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-400">협상가 (원, 비우면 표준)</label>
            <input value={dealAmount} inputMode="numeric"
              onChange={e => setDealAmount(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="예: 990000"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-900 outline-none focus:border-sky-400" />
          </div>
        </div>
        <div className="mt-3">
          <label className="text-xs font-semibold text-slate-400">딜 메모</label>
          <input value={dealNote} onChange={e => setDealNote(e.target.value)}
            placeholder="협상 내용·근거 등 (운영자 참고)"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={saveDeal} disabled={savingDeal} className={T.btnPrimary}>
            {savingDeal ? "저장 중..." : "딜 저장"}
          </button>
          {dealMsg && <span className="text-xs font-semibold text-slate-500">{dealMsg}</span>}
        </div>
      </div>

      {/* AI 사용량 */}
      {stats && stats.apiUsage.length > 0 && (
        <div className={T.card}>
          <div className="mb-3 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-slate-500" />
            <p className="text-sm font-black text-slate-700">AI 사용량 (누적)</p>
          </div>
          <div className="flex gap-4">
            {stats.apiUsage.map(u => (
              <div key={u.service} className="rounded-xl bg-slate-50 px-4 py-2.5 text-center">
                <p className="text-lg font-black text-slate-900">{u.count.toLocaleString()}</p>
                <p className="mt-0.5 text-xs font-semibold text-slate-400">{u.service}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* 관리자 */}
        <div className={T.card}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />
              <p className="text-sm font-black text-slate-700">관리자 계정</p>
            </div>
            <button
              onClick={issueInvite}
              disabled={inviting}
              className="flex items-center gap-1 rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-black text-white active:scale-95 disabled:opacity-50"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {inviting ? "발급 중..." : "관리자 초대"}
            </button>
          </div>

          {inviteUrl && (
            <div className="mb-3 rounded-xl border border-sky-100 bg-sky-50 p-3">
              <p className="mb-1 text-[11px] font-black text-sky-700">초대 링크(7일 유효) — 대상자에게 전달하세요</p>
              <div className="flex items-center gap-2">
                <input readOnly value={inviteUrl} className="flex-1 rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-[11px] text-slate-700" />
                <button
                  onClick={() => { navigator.clipboard?.writeText(inviteUrl); }}
                  className="flex items-center gap-1 rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-[11px] font-black text-sky-700 active:scale-95"
                >
                  <Copy className="h-3 w-3" /> 복사
                </button>
              </div>
            </div>
          )}

          {managers.length === 0 ? (
            <p className="text-sm text-slate-400">관리자가 없습니다. ‘관리자 초대’로 추가하세요.</p>
          ) : (
            <div className="space-y-2">
              {managers.map(m => (
                <div key={m.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-black text-slate-900">{m.loginId}</p>
                    {m.displayName && <p className="text-xs text-slate-400">{m.displayName}</p>}
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {m.lastLoginAt ? `최근 ${fmtDt(m.lastLoginAt)}` : "로그인 없음"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`${T.badge} ${m.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                      {m.isActive ? "활성" : "비활성"}
                    </span>
                    <button
                      onClick={() => toggleManager(m.id, !m.isActive)}
                      disabled={togglingId === m.id}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-black text-slate-600 active:scale-95 disabled:opacity-50"
                    >
                      {togglingId === m.id ? "..." : m.isActive ? "비활성화" : "활성화"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 현장 */}
        <div className={T.card}>
          <div className="mb-3 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-slate-500" />
            <p className="text-sm font-black text-slate-700">현장 목록</p>
          </div>
          {sites.length === 0 ? (
            <p className="text-sm text-slate-400">등록된 현장이 없습니다.</p>
          ) : (
            <div className="max-h-60 space-y-1.5 overflow-y-auto">
              {sites.map(s => (
                <div key={s.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-800">{s.companyName}</p>
                  <p className="text-xs text-slate-400">훈련생 {s.traineeCount}명</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 직무지도원 */}
      <div className={T.card}>
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-slate-500" />
          <p className="text-sm font-black text-slate-700">직무지도원 ({workers.length}명)</p>
        </div>
        {workers.length === 0 ? (
          <p className="text-sm text-slate-400">배정된 직무지도원이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
            {workers.map(c => (
              <div key={c.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-sm font-semibold text-slate-800">{c.workerName}</p>
                <span className={`${T.badge} ${c.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {c.status === "ACTIVE" ? "활성" : c.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
