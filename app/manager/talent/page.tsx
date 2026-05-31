"use client";

// 에이전시 — 구직중 후보자 풀 검색 + 제안(컨택) 보내기 (방향 B)
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "../_styles";

const PROF_LABEL: Record<string, string> = { JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사" };
const PROFS = [{ value: "", label: "전체" }, { value: "JOB_COACH", label: "직무지도원" }, { value: "CAREGIVER", label: "요양보호사" }, { value: "ACTIVITY_ASSISTANT", label: "활동지원사" }];

interface Cand {
  id: string; name: string; region: string | null; bio: string | null; ratingAvg: number; ratingCount: number;
  professions: { profession: string; experienceYears: number; isPrimary: boolean; verifyStatus: string }[];
}

export default function ManagerTalentPage() {
  const router = useRouter();
  const [cands, setCands] = useState<Cand[]>([]);
  const [loading, setLoading] = useState(true);
  const [profession, setProfession] = useState("");
  const [region, setRegion] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [offerTo, setOfferTo] = useState<Cand | null>(null);
  const [offerMsg, setOfferMsg] = useState("");
  const [offerSite, setOfferSite] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (profession) sp.set("profession", profession);
      if (region.trim()) sp.set("region", region.trim());
      if (verifiedOnly) sp.set("verifiedOnly", "1");
      const r = await fetch(`/api/admin/talent?${sp}`);
      const d = await r.json();
      if (d.success) setCands(d.candidates);
      else if (r.status === 401) router.replace("/manager/login");
    } finally { setLoading(false); }
  }, [profession, region, verifiedOnly, router]);

  useEffect(() => { load(); }, [profession, verifiedOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendOffer() {
    if (!offerTo) return;
    setSending(true);
    try {
      const r = await fetch("/api/admin/talent/offer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId: offerTo.id, profession: profession || undefined, siteName: offerSite.trim() || undefined, message: offerMsg.trim() || undefined }),
      });
      const d = await r.json();
      if (d.success) { alert("제안을 보냈습니다."); setOfferTo(null); setOfferMsg(""); setOfferSite(""); }
      else alert(d.message || "제안 전송에 실패했습니다.");
    } finally { setSending(false); }
  }

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className={T.pageTitle}>인력풀 검색</h1>
        <p className={T.pageSub}>구직 중인 직무지도원·요양보호사·활동지원사 후보자를 찾아 제안을 보냅니다.</p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PROFS.map((p) => (
          <button key={p.value} onClick={() => setProfession(p.value)} className={`rounded-xl px-3.5 py-2 text-sm font-black transition ${profession === p.value ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-500"}`}>{p.label}</button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-sm font-semibold text-slate-600">
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> 검증된 자격만
        </label>
        <div className="ml-auto flex items-center gap-2">
          <input value={region} onChange={(e) => setRegion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="지역 검색" className={T.input} />
          <button onClick={load} className={T.btnSecondary}>검색</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {loading ? (
          <p className={`col-span-2 ${T.empty}`}>불러오는 중…</p>
        ) : cands.length === 0 ? (
          <p className={`col-span-2 ${T.empty}`}>구직 중인 후보자가 없습니다.</p>
        ) : (
          cands.map((c) => {
            const primary = c.professions.find((p) => p.isPrimary) ?? c.professions[0];
            return (
              <div key={c.id} className={T.card}>
                <div className="flex items-center justify-between">
                  <p className="text-base font-black text-slate-900">{c.name}</p>
                  {c.ratingCount > 0 && <span className="text-xs font-black text-amber-500">★ {c.ratingAvg.toFixed(1)}</span>}
                </div>
                <p className="mt-0.5 text-xs font-semibold text-slate-400">{c.region ?? "지역 미입력"}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.professions.map((p) => (
                    <span key={p.profession} className={`rounded px-1.5 py-0.5 text-[11px] font-black ${p.verifyStatus === "VERIFIED" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                      {PROF_LABEL[p.profession] ?? p.profession} {p.experienceYears}년{p.verifyStatus === "VERIFIED" ? " ✓" : ""}
                    </span>
                  ))}
                </div>
                {c.bio && <p className="mt-2 line-clamp-2 text-xs font-semibold text-slate-500">{c.bio}</p>}
                <button onClick={() => setOfferTo(c)} className={`mt-3 w-full ${T.btnPrimary}`}>제안 보내기</button>
              </div>
            );
          })
        )}
      </div>

      {offerTo && (
        <div className={T.modalOverlay} onClick={() => setOfferTo(null)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-black text-slate-900">{offerTo.name} 님에게 제안</p>
            <input value={offerSite} onChange={(e) => setOfferSite(e.target.value)} placeholder="제안 현장/사업체명 (선택)" className={`mt-3 w-full ${T.input}`} />
            <textarea value={offerMsg} onChange={(e) => setOfferMsg(e.target.value)} rows={4} placeholder="제안 메시지 (근무 조건, 연락 방법 등)" className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOfferTo(null)} className={T.btnSecondary}>취소</button>
              <button onClick={sendOffer} disabled={sending} className={T.btnPrimary}>{sending ? "전송 중…" : "제안 전송"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
