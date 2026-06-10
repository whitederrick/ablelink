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

// 패널 내부용 미니 페이저(목록이 많아질 때만 노출)
function MiniPager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / size);
  if (pages <= 1) return null;
  return (
    <div className="mt-2 flex items-center justify-end gap-2 text-xs font-semibold text-slate-500">
      <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}
        className="rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-40">‹</button>
      <span>{page}/{pages}</span>
      <button onClick={() => onPage(Math.min(pages, page + 1))} disabled={page >= pages}
        className="rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-40">›</button>
    </div>
  );
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

  // 하단 패널 내부 페이징(목록이 늘어나도 모달 높이 고정)
  const [mgrPage,    setMgrPage]    = useState(1);
  const [sitePage,   setSitePage]   = useState(1);
  const [workerPage, setWorkerPage] = useState(1);
  const PANEL_SIZE = 6;

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
      <div className="grid grid-cols-4 gap-3">
        {[
          { v: managers.length, l: "관리자" },
          { v: sites.length, l: "현장" },
          { v: workers.length, l: "직무지도원" },
          { v: stats?.attCount ?? 0, l: "출근 기록" },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl border border-slate-100 bg-white px-4 py-3 text-center">
            <p className="text-2xl font-black leading-none text-slate-900">{s.v}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">{s.l}</p>
          </div>
        ))}
      </div>

      {/* 상단: 구독 정보 | 결제 딜 | AI 사용량(좁게·세로) */}
      <div className="grid items-start gap-3 lg:grid-cols-[1.1fr_1.1fr_0.7fr]">
        {/* 구독 정보 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="mb-2.5 text-sm font-black text-slate-700">구독 정보</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <div><p className="text-xs font-semibold text-slate-400">구독 시작</p><p className="mt-0.5 font-semibold text-slate-800">{fmt(agency.subscribedAt)}</p></div>
            <div><p className="text-xs font-semibold text-slate-400">다음 결제</p><p className="mt-0.5 font-semibold text-slate-800">{fmt(agency.nextBillingAt)}</p></div>
            <div><p className="text-xs font-semibold text-slate-400">체험 종료</p><p className="mt-0.5 font-semibold text-slate-800">{fmt(agency.trialEndsAt)}</p></div>
            <div><p className="text-xs font-semibold text-slate-400">일지 기록 수</p><p className="mt-0.5 font-semibold text-slate-800">{(stats?.logCount ?? 0).toLocaleString()}</p></div>
            <div><p className="text-xs font-semibold text-slate-400">최대 직무지도원</p><p className="mt-0.5 font-semibold text-slate-800">{agency.maxWorkers || "무제한"}</p></div>
            <div><p className="text-xs font-semibold text-slate-400">최대 현장</p><p className="mt-0.5 font-semibold text-slate-800">{agency.maxSites || "무제한"}</p></div>
          </div>
        </div>

        {/* 결제 딜 설정 (건바이건) */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-black text-slate-700">결제 딜 설정</p>
          <p className="mb-2.5 text-[11px] text-slate-400">협상가 입력 시 표준 월정액 대신 청구. 비우면 표준. 다음 결제부터 적용.</p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs font-semibold text-slate-400">주기</span>
              {(["MONTHLY", "ANNUAL"] as const).map(c => (
                <button key={c} onClick={() => setDealCycle(c)}
                  className={`flex-1 rounded-xl border px-2 py-1.5 text-sm font-semibold transition ${
                    dealCycle === c ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}>{c === "MONTHLY" ? "월" : "연"}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs font-semibold text-slate-400">협상가</span>
              <input value={dealAmount} inputMode="numeric"
                onChange={e => setDealAmount(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="예: 990000 (비우면 표준)"
                className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs font-semibold text-slate-400">메모</span>
              <input value={dealNote} onChange={e => setDealNote(e.target.value)}
                placeholder="협상 근거 등"
                className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" />
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              <button onClick={saveDeal} disabled={savingDeal} className={T.btnPrimary + " py-1.5"}>{savingDeal ? "저장 중..." : "딜 저장"}</button>
              {dealMsg && <span className="text-[11px] font-semibold text-slate-500">{dealMsg}</span>}
            </div>
          </div>
        </div>

        {/* AI 사용량 (좁게·세로 배치) */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2.5 flex items-center gap-1.5">
            <Cpu className="h-4 w-4 text-slate-500" />
            <p className="text-sm font-black text-slate-700">AI 사용량</p>
          </div>
          {!stats || stats.apiUsage.length === 0 ? (
            <p className="text-xs text-slate-400">사용 기록 없음</p>
          ) : (
            <div className="space-y-1.5">
              {stats.apiUsage.map(u => (
                <div key={u.service} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5">
                  <span className="text-[11px] font-semibold text-slate-400">{u.service}</span>
                  <span className="text-sm font-black text-slate-900">{u.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 하단: 관리자 | 현장 | 직무지도원 (각 패널 내부 페이징) */}
      <div className="grid items-start gap-3 lg:grid-cols-3">
        {/* 관리자 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-slate-500" />
              <p className="text-sm font-black text-slate-700">관리자 ({managers.length})</p>
            </div>
            <button onClick={issueInvite} disabled={inviting}
              className="flex items-center gap-1 rounded-lg bg-slate-950 px-2 py-1 text-[11px] font-black text-white active:scale-95 disabled:opacity-50">
              <UserPlus className="h-3 w-3" />{inviting ? "..." : "초대"}
            </button>
          </div>
          {inviteUrl && (
            <div className="mb-2 rounded-lg border border-sky-100 bg-sky-50 p-2">
              <p className="mb-1 text-[10px] font-black text-sky-700">초대 링크(7일)</p>
              <div className="flex items-center gap-1.5">
                <input readOnly value={inviteUrl} className="min-w-0 flex-1 rounded border border-sky-200 bg-white px-1.5 py-1 text-[10px] text-slate-700" />
                <button onClick={() => navigator.clipboard?.writeText(inviteUrl)}
                  className="flex shrink-0 items-center gap-1 rounded border border-sky-200 bg-white px-1.5 py-1 text-[10px] font-black text-sky-700"><Copy className="h-3 w-3" /></button>
              </div>
            </div>
          )}
          {managers.length === 0 ? (
            <p className="text-sm text-slate-400">관리자가 없습니다.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                {managers.slice((mgrPage - 1) * PANEL_SIZE, mgrPage * PANEL_SIZE).map(m => (
                  <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-900">{m.loginId}{m.displayName && <span className="font-medium text-slate-400"> · {m.displayName}</span>}</p>
                      <p className="text-[10px] text-slate-400">{m.lastLoginAt ? `최근 ${fmtDt(m.lastLoginAt)}` : "로그인 없음"}</p>
                    </div>
                    <button onClick={() => toggleManager(m.id, !m.isActive)} disabled={togglingId === m.id}
                      className={`shrink-0 rounded-lg border px-2 py-1 text-[11px] font-black active:scale-95 disabled:opacity-50 ${m.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-400"}`}>
                      {togglingId === m.id ? "..." : m.isActive ? "활성" : "비활성"}
                    </button>
                  </div>
                ))}
              </div>
              <MiniPager page={mgrPage} total={managers.length} size={PANEL_SIZE} onPage={setMgrPage} />
            </>
          )}
        </div>

        {/* 현장 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2.5 flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-slate-500" />
            <p className="text-sm font-black text-slate-700">현장 ({sites.length})</p>
          </div>
          {sites.length === 0 ? (
            <p className="text-sm text-slate-400">등록된 현장이 없습니다.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                {sites.slice((sitePage - 1) * PANEL_SIZE, sitePage * PANEL_SIZE).map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                    <p className="truncate text-sm font-semibold text-slate-800">{s.companyName}</p>
                    <p className="shrink-0 text-xs text-slate-400">훈련생 {s.traineeCount}</p>
                  </div>
                ))}
              </div>
              <MiniPager page={sitePage} total={sites.length} size={PANEL_SIZE} onPage={setSitePage} />
            </>
          )}
        </div>

        {/* 직무지도원 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2.5 flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-slate-500" />
            <p className="text-sm font-black text-slate-700">직무지도원 ({workers.length})</p>
          </div>
          {workers.length === 0 ? (
            <p className="text-sm text-slate-400">배정된 직무지도원이 없습니다.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                {workers.slice((workerPage - 1) * PANEL_SIZE, workerPage * PANEL_SIZE).map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                    <p className="truncate text-sm font-semibold text-slate-800">{c.workerName}</p>
                    <span className={`shrink-0 ${T.badge} ${c.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {c.status === "ACTIVE" ? "활성" : c.status}
                    </span>
                  </div>
                ))}
              </div>
              <MiniPager page={workerPage} total={workers.length} size={PANEL_SIZE} onPage={setWorkerPage} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
