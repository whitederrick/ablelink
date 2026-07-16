"use client";
// app/worker/leave/page.tsx
// 직무지도원 연차 — 기관별 잔여·이력 조회 + 연차 사용 신청(Phase7, 달력 선택) +
// 매니저 직접 등록 확인/이의 + 신청 내역. 승인/반려는 위탁기관 담당자가 처리.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarCheck, X } from "lucide-react";

type Entry = {
  kind: string; kindLabel: string; days: number;
  effectiveDate: string; expiresAt: string | null; label: string | null;
};
type Group = { agencyId: string; agencyName: string; balance: number; entries: Entry[] };
type LeaveRequest = {
  id: string; agencyId: string; agencyName: string; kind: string; status: string; statusLabel: string;
  effectiveDate: string; days: number; reason: string | null; responseNote: string | null; createdAt: string;
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const KIND_CLS: Record<string, string> = {
  ACCRUAL_MONTHLY: "text-emerald-600", ACCRUAL_ANNUAL: "text-emerald-600",
  USE: "text-sky-600", EXPIRE: "text-slate-400", PAYOUT: "text-amber-600", ADJUST: "text-rose-500",
};
const STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-600", APPROVED: "bg-emerald-50 text-emerald-600",
  REJECTED: "bg-rose-50 text-rose-600", CONFIRMED: "bg-emerald-50 text-emerald-600",
  DISPUTED: "bg-rose-50 text-rose-600", CANCELED: "bg-slate-100 text-slate-400",
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const todayKst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

// ── 신청 모달(달력 선택 + 일수 + 사유) ─────────────────────────
function RequestModal({ agencyId, agencyName, balance, onClose, onDone }: {
  agencyId: string; agencyName: string; balance: number; onClose: () => void; onDone: () => void;
}) {
  const today = todayKst();
  const [ty, tm] = today.split("-").map(Number);
  const [year, setYear] = useState(ty);
  const [month, setMonth] = useState(tm);
  const [selDate, setSelDate] = useState<string | null>(null);
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cells = useMemo(() => {
    const firstDow = new Date(year, month - 1, 1).getDay();
    const lastDate = new Date(year, month, 0).getDate();
    const arr: (number | null)[] = Array(firstDow).fill(null);
    for (let d = 1; d <= lastDate; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [year, month]);

  const move = (delta: number) => {
    const m = month + delta;
    if (m < 1) { setYear(year - 1); setMonth(12); }
    else if (m > 12) { setYear(year + 1); setMonth(1); }
    else setMonth(m);
  };

  async function submit() {
    if (!selDate) { setErr("달력에서 사용일을 선택해주세요."); return; }
    const d = Number(days);
    if (!Number.isFinite(d) || d <= 0 || Math.round(d * 4) !== d * 4) { setErr("일수는 0.25일 단위로 입력해주세요."); return; }
    if (d > balance) { setErr(`잔여 연차(${fmt(balance)}일)를 초과합니다.`); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/worker/leave/requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencyId, effectiveDate: selDate, days: d, reason: reason.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.message || "신청에 실패했습니다.");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "신청에 실패했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900">연차 신청</h2>
            <p className="mt-0.5 text-xs font-semibold text-slate-400">{agencyName} · 잔여 {fmt(balance)}일</p>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>

        {/* 달력 */}
        <div className="mt-4 rounded-2xl border border-slate-100 p-3">
          <div className="flex items-center justify-between px-1">
            <button onClick={() => move(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
            <p className="text-sm font-black text-slate-800">{year}년 {month}월</p>
            <button onClick={() => move(1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={`py-1 text-center text-[10px] font-black ${i === 0 ? "text-rose-400" : i === 6 ? "text-blue-400" : "text-slate-400"}`}>{w}</div>
            ))}
            {cells.map((d, idx) => {
              if (!d) return <div key={idx} className="aspect-square" />;
              const key = `${year}-${pad2(month)}-${pad2(d)}`;
              const selected = key === selDate;
              const dow = idx % 7;
              return (
                <button
                  key={idx}
                  onClick={() => setSelDate(key)}
                  className={`aspect-square rounded-xl text-sm font-bold transition active:scale-95 ${
                    selected ? "bg-emerald-500 text-white"
                      : dow === 0 ? "text-rose-400 hover:bg-slate-50"
                      : dow === 6 ? "text-blue-500 hover:bg-slate-50"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <p className="mt-1 px-1 text-[11px] font-semibold text-emerald-600">{selDate ? `사용일: ${selDate}` : "사용할 날짜를 선택하세요."}</p>
        </div>

        {/* 일수 */}
        <div className="mt-3">
          <p className="text-xs font-black text-slate-500">사용 일수</p>
          <div className="mt-1.5 flex items-center gap-2">
            {["1", "0.5", "0.25"].map(v => (
              <button key={v} onClick={() => setDays(v)}
                className={`rounded-xl px-3.5 py-2 text-sm font-black transition active:scale-95 ${days === v ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-600"}`}>
                {v}일
              </button>
            ))}
            <input
              type="number" step={0.25} min={0.25} max={30} value={days} onChange={e => setDays(e.target.value)}
              className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800"
            />
          </div>
        </div>

        {/* 사유 */}
        <div className="mt-3">
          <p className="text-xs font-black text-slate-500">사유 (선택)</p>
          <textarea
            value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={200}
            placeholder="예: 개인 사정"
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800"
          />
        </div>

        {err && <p className="mt-2 text-xs font-bold text-rose-500">{err}</p>}

        <button
          onClick={submit} disabled={busy}
          className="mt-4 w-full rounded-2xl bg-emerald-500 py-3.5 text-sm font-black text-white transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "신청 중..." : "연차 신청하기"}
        </button>
        <p className="mt-2 text-center text-[11px] font-medium text-slate-400">신청하면 위탁기관 담당자에게 전달되며, 승인 시 연차가 차감됩니다.</p>
      </div>
    </div>
  );
}

// ── 페이지 ─────────────────────────────────────────────
export default function WorkerLeavePage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // 로드 실패를 '빈 상태'로 위장하지 않음(급여명세서와 동일)
  const [modal, setModal] = useState<{ agencyId: string; agencyName: string; balance: number } | null>(null);
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [actBusy, setActBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const runFetch = () => {
    Promise.all([
      fetch("/api/worker/leave").then(async r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch("/api/worker/leave/requests").then(async r => { if (!r.ok) throw new Error(); return r.json(); }),
    ])
      .then(([a, b]) => {
        if (!a.success || !b.success) throw new Error();
        setGroups(a.groups); setRequests(b.items);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  const load = () => { setLoading(true); setError(false); runFetch(); };
  useEffect(() => { runFetch(); }, []);

  const confirmsPending = requests.filter(r => r.kind === "MANAGER_ENTRY_CONFIRM" && r.status === "PENDING");
  const history = requests.filter(r => !(r.kind === "MANAGER_ENTRY_CONFIRM" && r.status === "PENDING"));

  async function respondConfirm(id: string, action: "confirm" | "dispute") {
    if (action === "dispute" && !disputeReason.trim()) { setToast("이의 사유를 입력해주세요."); return; }
    setActBusy(true);
    try {
      const res = await fetch(`/api/worker/leave/requests/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: action === "dispute" ? disputeReason.trim() : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.message || "처리에 실패했습니다.");
      setDisputeId(null); setDisputeReason("");
      setToast(action === "confirm" ? "확인했습니다." : "이의를 전달했습니다.");
      runFetch();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "처리에 실패했습니다.");
    } finally { setActBusy(false); }
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-100 bg-white px-4 py-3">
        <button onClick={() => router.push("/worker/home")} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-black text-slate-900">내 연차</h1>
      </header>

      <div className="mx-auto max-w-lg space-y-3 px-4 py-5">
        {loading ? (
          <p className="py-10 text-center text-sm font-semibold text-slate-400">불러오는 중...</p>
        ) : error ? (
          <div className="rounded-2xl border border-rose-100 bg-white py-12 text-center">
            <p className="text-sm font-semibold text-rose-500">연차 정보를 불러오지 못했습니다.</p>
            <button onClick={load} className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white active:scale-95">다시 시도</button>
          </div>
        ) : (
          <>
            {/* 매니저 등록 확인 요청(대기) */}
            {confirmsPending.map(r => (
              <div key={r.id} className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                <p className="text-[13px] font-black text-amber-700">연차 사용 등록 확인 요청</p>
                <p className="mt-1 text-sm font-bold text-slate-800">{r.agencyName} · {r.effectiveDate} · {fmt(r.days)}일</p>
                {r.reason && <p className="mt-0.5 truncate text-xs font-medium text-slate-500">메모: {r.reason}</p>}
                {disputeId === r.id ? (
                  <div className="mt-2.5">
                    <textarea
                      value={disputeReason} onChange={e => setDisputeReason(e.target.value)} rows={2} maxLength={200}
                      placeholder="이의 사유를 입력해주세요."
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                    />
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => { setDisputeId(null); setDisputeReason(""); }} className="flex-1 rounded-xl bg-white py-2.5 text-xs font-black text-slate-500 ring-1 ring-slate-200 active:scale-95">취소</button>
                      <button onClick={() => respondConfirm(r.id, "dispute")} disabled={actBusy} className="flex-1 rounded-xl bg-rose-500 py-2.5 text-xs font-black text-white active:scale-95 disabled:opacity-50">이의 전달</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2.5 flex gap-2">
                    <button onClick={() => setDisputeId(r.id)} disabled={actBusy} className="flex-1 rounded-xl bg-white py-2.5 text-xs font-black text-rose-500 ring-1 ring-rose-200 active:scale-95 disabled:opacity-50">이의</button>
                    <button onClick={() => respondConfirm(r.id, "confirm")} disabled={actBusy} className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-xs font-black text-white active:scale-95 disabled:opacity-50">확인</button>
                  </div>
                )}
              </div>
            ))}

            {groups.length === 0 ? (
              <div className="rounded-2xl border border-slate-100 bg-white py-12 text-center">
                <CalendarCheck className="mx-auto h-10 w-10 text-slate-200" />
                <p className="mt-3 text-sm font-semibold text-slate-400">아직 연차 이력이 없습니다.</p>
                <p className="mt-1 px-6 text-xs font-medium text-slate-300">연차는 근로계약 후 1개월 개근 시마다 자동으로 쌓이며, 쌓인 연차는 이 화면에서 신청할 수 있습니다.</p>
              </div>
            ) : groups.map(g => (
              <div key={g.agencyId} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
                <div className="flex items-center justify-between border-b border-slate-50 px-4 py-3">
                  <div>
                    <p className="text-[13px] font-bold text-slate-400">{g.agencyName}</p>
                    <p className="mt-0.5 text-lg font-black text-slate-900">잔여 {fmt(g.balance)}일</p>
                  </div>
                  <button
                    onClick={() => setModal({ agencyId: g.agencyId, agencyName: g.agencyName, balance: g.balance })}
                    disabled={g.balance <= 0}
                    className="rounded-xl bg-emerald-500 px-3.5 py-2.5 text-xs font-black text-white transition active:scale-95 disabled:bg-slate-100 disabled:text-slate-300"
                  >
                    연차 신청
                  </button>
                </div>
                <ul>
                  {g.entries.map((e, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 border-b border-slate-50 px-4 py-2.5 last:border-0">
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-slate-700">
                          {e.kindLabel}
                          <span className={`ml-1.5 font-black ${KIND_CLS[e.kind] ?? "text-slate-500"}`}>{e.days > 0 ? "+" : ""}{fmt(e.days)}일</span>
                        </p>
                        {e.label && <p className="truncate text-[11px] font-medium text-slate-400">{e.label}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-semibold text-slate-400">{e.effectiveDate}</p>
                        {e.expiresAt && <p className="text-[10px] font-medium text-slate-300">{e.expiresAt} 소멸</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {/* 신청 내역 */}
            {history.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
                <p className="border-b border-slate-50 px-4 py-3 text-[13px] font-black text-slate-700">신청·확인 내역</p>
                <ul>
                  {history.map(r => (
                    <li key={r.id} className="border-b border-slate-50 px-4 py-2.5 last:border-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-[13px] font-bold text-slate-700">
                          {r.effectiveDate} · {fmt(r.days)}일
                          <span className="ml-1.5 text-[11px] font-semibold text-slate-400">{r.kind === "MANAGER_ENTRY_CONFIRM" ? "담당자 등록" : "내 신청"}</span>
                        </p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${STATUS_BADGE[r.status] ?? "bg-slate-100 text-slate-500"}`}>{r.statusLabel}</span>
                      </div>
                      {r.responseNote && <p className="mt-0.5 truncate text-[11px] font-medium text-rose-400">사유: {r.responseNote}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {modal && (
        <RequestModal
          agencyId={modal.agencyId} agencyName={modal.agencyName} balance={modal.balance}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); setToast("연차 신청이 접수되었습니다."); runFetch(); }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-2xl bg-slate-950/90 px-4 py-2.5 text-xs font-bold text-white">
          {toast}
        </div>
      )}
    </div>
  );
}
