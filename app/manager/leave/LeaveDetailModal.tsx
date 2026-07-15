"use client";

// 연차 원장 상세 — 목록 행 클릭 시 뜨는 모달(현장 관리 모달과 동일 구성).
// 잔여·부여분별 만료 요약 + 원장 이력 + 사용/조정 등록 + 수동 행 삭제(오입력 정정).
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { T } from "../_styles";
import { workerLabel } from "../_format";

type Grant = { id: string; remaining: number; expiresAt: string | null };
type Entry = {
  id: string; kind: string; kindLabel: string; days: number;
  effectiveDate: string; expiresAt: string | null; sourceLabel: string | null; memo: string | null;
  manual: boolean; deletable: boolean; remaining: number | null;
};
type Detail = {
  worker: { name: string; loginId: string };
  hireDate: string | null; balance: number; grants: Grant[]; entries: Entry[];
};

const KIND_CLS: Record<string, string> = {
  ACCRUAL_MONTHLY: "bg-emerald-50 text-emerald-600",
  ACCRUAL_ANNUAL: "bg-emerald-50 text-emerald-600",
  USE: "bg-sky-50 text-sky-600",
  EXPIRE: "bg-slate-100 text-slate-500",
  PAYOUT: "bg-amber-50 text-amber-600",
  ADJUST: "bg-rose-50 text-rose-600",
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const todayISO = () => {
  const d = new Date(Date.now() + 9 * 3600e3);
  return d.toISOString().slice(0, 10);
};

export default function LeaveDetailModal({ workerId, onClose, onChanged }: {
  workerId: string; onClose: () => void; onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 등록 폼
  const [mode, setMode] = useState<"use" | "adjust">("use");
  const [days, setDays] = useState("1");
  const [effectiveDate, setEffectiveDate] = useState(todayISO());
  const [memo, setMemo] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/leave/${workerId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.message || "FAILED");
      setDetail(data);
    } catch { setDetail(null); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [workerId]);

  async function submit() {
    setErr("");
    const n = Number(days);
    if (!Number.isFinite(n) || n === 0) { setErr("일수를 입력해주세요."); return; }
    if (mode === "adjust" && !memo.trim()) { setErr("조정 사유를 입력해주세요."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/leave/${workerId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, days: n, effectiveDate, memo: memo.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.message || "등록 실패");
      setMemo(""); setDays("1");
      await load();
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "등록 실패"); }
    finally { setBusy(false); }
  }

  async function removeEntry(entryId: string) {
    if (!confirm("이 항목을 삭제할까요? (오입력 정정 용도 — 감사로그에 기록됩니다)")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/leave/${workerId}?entryId=${entryId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.message || "삭제 실패");
      await load();
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "삭제 실패"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div className="w-full max-w-[52rem] max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">연차 상세</h2>
            {detail && (
              <p className="mt-0.5 text-[13px] font-semibold text-slate-400">
                <span className="text-sky-600">{workerLabel(detail.worker.name, detail.worker.loginId)}</span>
                {detail.hireDate ? ` · 입사 ${detail.hireDate}` : ""}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"><X size={18} /></button>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm font-semibold text-slate-300">불러오는 중…</p>
        ) : !detail ? (
          <p className="py-10 text-center text-sm font-semibold text-slate-400">정보를 불러오지 못했습니다.</p>
        ) : (
          <div className="space-y-5">
            {/* 요약: 잔여 + 부여분별 만료 */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-xl px-3 py-1.5 text-sm font-black ${detail.balance > 0 ? "bg-emerald-50 text-emerald-700" : detail.balance < 0 ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500"}`}>
                잔여 {fmt(detail.balance)}일
              </span>
              {detail.grants.map(g => (
                <span key={g.id} className="inline-flex items-center rounded-xl bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-500">
                  {fmt(g.remaining)}일 · {g.expiresAt ? `${g.expiresAt} 소멸` : "기한 없음"}
                </span>
              ))}
            </div>

            {/* 등록 폼: 사용 / 조정 */}
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center gap-2">
                {(["use", "adjust"] as const).map(m => (
                  <button key={m} onClick={() => { setMode(m); setErr(""); }}
                    className={`inline-flex h-8 items-center rounded-lg border px-3 text-[13px] font-bold transition ${
                      mode === m ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}>
                    {m === "use" ? "사용 등록" : "수동 조정"}
                  </button>
                ))}
                <p className="ml-1 text-xs font-semibold text-slate-400">
                  {mode === "use" ? "연차를 사용한 날짜와 일수(반차 0.5)를 등록합니다." : "발생 누락·정정 등 ± 조정(사유 필수)."}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2.5">
                <label className="text-xs font-bold text-slate-500">
                  {mode === "use" ? "사용일" : "기준일"}
                  <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} className={`mt-1 block ${T.input}`} />
                </label>
                <label className="text-xs font-bold text-slate-500">
                  일수{mode === "adjust" ? "(±)" : ""}
                  <input type="number" step="0.25" value={days} onChange={e => setDays(e.target.value)} className={`mt-1 block w-24 ${T.input}`} />
                </label>
                <label className="min-w-[200px] flex-1 text-xs font-bold text-slate-500">
                  {mode === "use" ? "메모(선택)" : "조정 사유(필수)"}
                  <input value={memo} onChange={e => setMemo(e.target.value)} maxLength={200}
                    placeholder={mode === "use" ? "예: 개인 사유" : "예: 전산 도입 전 발생분 이관"} className={`mt-1 block w-full ${T.input}`} />
                </label>
                <button onClick={submit} disabled={busy}
                  className="inline-flex h-9 items-center rounded-xl bg-slate-950 px-4 text-[13px] font-bold text-white transition hover:bg-slate-800 disabled:opacity-40">
                  등록
                </button>
              </div>
              {err && <p className="mt-2 text-xs font-bold text-rose-600">{err}</p>}
            </div>

            {/* 원장 이력 */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr>{["종류", "일수", "기준일", "소멸기한", "근거·메모", ""].map((h, i) => (
                    <th key={i} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {detail.entries.length === 0 ? (
                    <tr><td colSpan={6} className={T.tdCenter}>아직 연차 이력이 없습니다. 발생은 매일 자동 기록됩니다.</td></tr>
                  ) : [...detail.entries].reverse().map(e => (
                    <tr key={e.id} className={T.trBase}>
                      <td className={`${T.td} whitespace-nowrap`}>
                        <span className={`${T.badge} ${KIND_CLS[e.kind] ?? "bg-slate-100 text-slate-500"}`}>{e.kindLabel}</span>
                        {!e.manual && <span className="ml-1 text-[11px] font-semibold text-slate-300">자동</span>}
                      </td>
                      <td className={`${T.td} whitespace-nowrap font-bold ${e.days > 0 ? "text-emerald-600" : "text-slate-600"}`}>{e.days > 0 ? "+" : ""}{fmt(e.days)}</td>
                      <td className={`${T.td} whitespace-nowrap`}>{e.effectiveDate}</td>
                      <td className={`${T.td} whitespace-nowrap`}>{e.expiresAt ?? "-"}</td>
                      <td className={T.td}><div className="max-w-[220px] truncate">{e.sourceLabel || e.memo || "-"}</div></td>
                      <td className={`${T.td} whitespace-nowrap text-right`}>
                        {e.deletable && (
                          <button onClick={() => removeEntry(e.id)} disabled={busy}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">
                            삭제
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
