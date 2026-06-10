"use client";

// 에이전시 — 구직중 후보자 풀 검색 + 제안(컨택) 보내기 (방향 B)
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";

// 매칭은 현재 직무지도원 직종만 운영 → 직종 필터 미노출(서버도 JOB_COACH 강제).
const PROF_LABEL: Record<string, string> = { JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사" };

interface Cand {
  id: string; name: string; region: string | null; bio: string | null; ratingAvg: number; ratingCount: number;
  professions: { profession: string; experienceYears: number; isPrimary: boolean; verifyStatus: string }[];
}

export default function ManagerTalentPage() {
  const router = useRouter();
  const [cands, setCands] = useState<Cand[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [offerTo, setOfferTo] = useState<Cand | null>(null);
  const [offerMsg, setOfferMsg] = useState("");
  const [offerSite, setOfferSite] = useState("");
  const [offerSiteId, setOfferSiteId] = useState("");
  const [offerStart, setOfferStart] = useState("");
  const [offerEnd, setOfferEnd] = useState("");
  const [sites, setSites] = useState<{ id: string; companyName: string; agencyName: string | null }[]>([]);
  const [sending, setSending] = useState(false);

  // 제안에 연결할 현장 목록(수락 시 자동 배정). manager=본인 agency 사이트.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/sites?pageSize=100", { cache: "no-store" });
        const d = await r.json();
        if (d.success) setSites((d.items || []).map((s: any) => ({ id: s.id, companyName: s.companyName, agencyName: s.agencyName })));
      } catch { /* noop */ }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (region.trim()) sp.set("region", region.trim());
      if (verifiedOnly) sp.set("verifiedOnly", "1");
      const r = await fetch(`/api/admin/talent?${sp}`);
      const d = await r.json();
      if (d.success) setCands(d.candidates);
      else if (r.status === 401) router.replace("/manager/login");
    } finally { setLoading(false); }
  }, [region, verifiedOnly, router]);

  useEffect(() => { load(); }, [verifiedOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendOffer() {
    if (!offerTo) return;
    if (!offerStart || !offerEnd) { alert("직무지도 기간(시작일·종료일)을 입력해주세요."); return; }
    if (offerStart > offerEnd) { alert("직무지도 시작일이 종료일보다 늦습니다."); return; }
    setSending(true);
    try {
      const r = await fetch("/api/admin/talent/offer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId: offerTo.id, siteName: offerSite.trim() || undefined, siteId: offerSiteId || undefined, message: offerMsg.trim() || undefined, serviceStart: offerStart, serviceEnd: offerEnd }),
      });
      const d = await r.json();
      if (d.success) { alert("제안을 보냈습니다."); setOfferTo(null); setOfferMsg(""); setOfferSite(""); setOfferSiteId(""); setOfferStart(""); setOfferEnd(""); }
      else alert(d.message || "제안 전송에 실패했습니다.");
    } finally { setSending(false); }
  }

  return (
    <div>
      <PageHeader
        title="인재풀 검색 (Pro+)"
        sub="구직 중인 직무지도원 후보자를 찾아 제안을 보냅니다."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-600">
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
            <label className="mt-3 block text-xs font-bold text-slate-500">현장 연결 (선택) — 후보자 수락 시 자동 배정</label>
            <select value={offerSiteId} onChange={(e) => setOfferSiteId(e.target.value)} className={`mt-1 w-full ${T.select ?? T.input}`}>
              <option value="">연결 안 함 (텍스트만)</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.companyName}{s.agencyName ? ` (${s.agencyName})` : ""}</option>
              ))}
            </select>
            <input value={offerSite} onChange={(e) => setOfferSite(e.target.value)} placeholder="제안 현장/사업체명 (선택, 텍스트)" className={`mt-2 w-full ${T.input}`} />
            <label className="mt-3 block text-xs font-bold text-slate-500">직무지도 기간 * — 일정 겹침 판정 기준</label>
            <div className="mt-1 flex items-center gap-2">
              <input type="date" value={offerStart} onChange={(e) => setOfferStart(e.target.value)} className={`w-full ${T.input}`} />
              <span className="text-slate-400">~</span>
              <input type="date" value={offerEnd} min={offerStart || undefined} onChange={(e) => setOfferEnd(e.target.value)} className={`w-full ${T.input}`} />
            </div>
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
