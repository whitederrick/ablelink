"use client";

// 위탁기관 — 구직중 후보자 풀 검색 + 제안(컨택) 보내기 (방향 B)
import { useCallback, useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";

// 매칭은 현재 직무지도원 직종만 운영 → 직종 필터 미노출(서버도 JOB_COACH 강제).
const PROF_LABEL: Record<string, string> = { JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사" };
const CARD_PAGE_SIZE = 9;

type SortKey = "rating" | "experience" | "reviews" | "ageDesc" | "ageAsc";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "rating",     label: "평점 높은순" },
  { value: "experience", label: "경력 많은순" },
  { value: "reviews",    label: "리뷰 많은순" },
  { value: "ageDesc",    label: "나이 많은순" },
  { value: "ageAsc",     label: "나이 적은순" },
];

interface Cand {
  id: string; name: string; region: string | null; bio: string | null; ratingAvg: number; ratingCount: number; age: number | null;
  professions: { profession: string; experienceYears: number; isPrimary: boolean; verifyStatus: string }[];
}

interface CandDetail extends Cand {
  professions: { profession: string; experienceYears: number; isPrimary: boolean; verifyStatus: string; certifiedAt: string | null }[];
  experiences: { profession: string | null; orgName: string; title: string | null; startDate: string; endDate: string | null; description: string | null }[];
  reviews: { rating: number; comment: string | null; createdAt: string }[];
}

const maxExp = (c: Cand) => c.professions.reduce((m, p) => Math.max(m, p.experienceYears), 0);
function sortCands(list: Cand[], key: SortKey): Cand[] {
  const arr = [...list];
  switch (key) {
    case "experience": return arr.sort((a, b) => maxExp(b) - maxExp(a) || b.ratingAvg - a.ratingAvg);
    case "reviews":    return arr.sort((a, b) => b.ratingCount - a.ratingCount || b.ratingAvg - a.ratingAvg);
    case "ageDesc":    return arr.sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
    case "ageAsc":     return arr.sort((a, b) => (a.age ?? 999) - (b.age ?? 999));
    default:           return arr.sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount);
  }
}

function PanelPager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / size);
  if (pages <= 1) return null;
  return (
    <div className="mt-2 flex items-center justify-end gap-2 text-xs font-semibold text-slate-500">
      <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} className="rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-40">‹</button>
      <span>{page}/{pages}</span>
      <button onClick={() => onPage(Math.min(pages, page + 1))} disabled={page >= pages} className="rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-40">›</button>
    </div>
  );
}

export default function ManagerTalentPage() {
  const router = useRouter();
  const [cands, setCands] = useState<Cand[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("rating");
  const sorted = useMemo(() => sortCands(cands, sortBy), [cands, sortBy]);
  const [cardPage, setCardPage] = useState(1);
  const cardTotalPages = Math.max(1, Math.ceil(sorted.length / CARD_PAGE_SIZE));
  const pagedCands = sorted.slice((cardPage - 1) * CARD_PAGE_SIZE, cardPage * CARD_PAGE_SIZE);
  useEffect(() => { setCardPage(1); }, [cands, sortBy, verifiedOnly]);
  const [offerTo, setOfferTo] = useState<Cand | null>(null);
  const [detailFor, setDetailFor] = useState<Cand | null>(null);
  const [detail, setDetail] = useState<CandDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expPage, setExpPage] = useState(1);
  const [revPage, setRevPage] = useState(1);
  const PANEL = 5;
  const [offerMsg, setOfferMsg] = useState("");
  const [offerSite, setOfferSite] = useState("");
  const [offerSiteId, setOfferSiteId] = useState("");
  const [offerStart, setOfferStart] = useState("");
  const [offerEnd, setOfferEnd] = useState("");
  const [sites, setSites] = useState<{ id: string; companyName: string; agencyName: string | null }[]>([]);
  const [sending, setSending] = useState(false);

  // 제안에 연결할 현장 목록(수락 시 자동 배정). admin=전체, manager=본인 agency.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/sites?pageSize=100", { cache: "no-store", headers: { "x-admin-context": "1" } });
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
      const r = await fetch(`/api/admin/talent?${sp}`, { headers: { "x-admin-context": "1" } });
      const d = await r.json();
      if (d.success) setCands(d.candidates);
      else if (r.status === 401) router.replace("/admin/login");
    } finally { setLoading(false); }
  }, [region, verifiedOnly, router]);

  useEffect(() => { load(); }, [verifiedOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openDetail(c: Cand) {
    setDetailFor(c); setDetail(null); setDetailLoading(true); setExpPage(1); setRevPage(1);
    try {
      const r = await fetch(`/api/admin/talent/${c.id}`, { headers: { "x-admin-context": "1" } });
      const d = await r.json();
      if (d.success) setDetail(d.candidate);
    } finally { setDetailLoading(false); }
  }

  async function sendOffer() {
    if (!offerTo) return;
    if (!offerStart || !offerEnd) { alert("직무지도 기간(시작일·종료일)을 입력해주세요."); return; }
    if (offerStart > offerEnd) { alert("직무지도 시작일이 종료일보다 늦습니다."); return; }
    setSending(true);
    try {
      const r = await fetch("/api/admin/talent/offer", {
        method: "POST", headers: { "Content-Type": "application/json", "x-admin-context": "1" },
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
        title="인재풀 검색"
        sub="구직 중인 직무지도원 후보자를 찾아 제안을 보냅니다."
      />

      <div className="mb-4">
        <ListToolbar
          query={region}
          onQueryChange={setRegion}
          placeholder="지역 검색"
          onSearch={load}
          filters={[{ value: "verified", label: "검증된 자격만" }] as FilterChip[]}
          selected={verifiedOnly ? ["verified"] : []}
          onToggleFilter={() => setVerifiedOnly(v => !v)}
          extra={
            <select value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)} className={`w-auto ${T.select}`}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <p className={`col-span-full ${T.empty}`}>불러오는 중…</p>
        ) : cands.length === 0 ? (
          <p className={`col-span-full ${T.empty}`}>구직 중인 후보자가 없습니다.</p>
        ) : (
          pagedCands.map((c) => (
            <div key={c.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="shrink-0 text-[16px] font-black text-slate-900">{c.name}</p>
                  {c.professions.map((p) => (
                    <span key={p.profession} className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-black ${p.verifyStatus === "VERIFIED" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                      {PROF_LABEL[p.profession] ?? p.profession} {p.experienceYears}년{p.verifyStatus === "VERIFIED" ? " ✓" : ""}
                    </span>
                  ))}
                  {c.ratingCount > 0 && <span className="ml-auto shrink-0 text-[13px] font-black text-amber-500">★ {c.ratingAvg.toFixed(1)} <span className="font-semibold text-slate-400">({c.ratingCount})</span></span>}
                </div>
                <p className="mt-0.5 text-[13px] font-semibold text-slate-400">{c.region ?? "지역 미입력"}{c.age != null ? ` · ${c.age}세` : ""}</p>
                {c.bio && <p className="mt-1.5 line-clamp-2 text-[13px] font-semibold text-slate-500">{c.bio}</p>}
              </div>
              <div className="mt-2.5 flex gap-2">
                <button onClick={() => openDetail(c)} className="inline-flex h-8 flex-1 items-center justify-center rounded-lg border border-slate-200 bg-white text-[13px] font-bold text-slate-600 hover:bg-slate-50 active:scale-95">상세 보기</button>
                <button onClick={() => setOfferTo(c)} className="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-slate-950 text-[13px] font-bold text-white hover:bg-slate-800 active:scale-95">제안 보내기</button>
              </div>
            </div>
          ))
        )}
      </div>
      {!loading && sorted.length > 0 && (
        <Pagination className="mt-4" page={cardPage} totalPages={cardTotalPages} total={sorted.length} onPageChange={setCardPage} />
      )}

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

      {detailFor && (
        <div className={T.modalOverlay} onClick={() => setDetailFor(null)}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-black text-slate-900">{detailFor.name}</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-400">
                  {detailFor.region ?? "지역 미입력"}{detailFor.age != null ? ` · ${detailFor.age}세` : ""}
                  {detailFor.ratingCount > 0 ? <span className="ml-2 font-black text-amber-500">★ {detailFor.ratingAvg.toFixed(1)} ({detailFor.ratingCount})</span> : null}
                </p>
              </div>
              <button onClick={() => setDetailFor(null)} className="text-2xl leading-none text-slate-300 hover:text-slate-500">×</button>
            </div>

            <div className="mt-4 grid flex-1 gap-5 overflow-y-auto pr-1 sm:grid-cols-2">
              {detailLoading ? (
                <p className={`sm:col-span-2 ${T.empty}`}>불러오는 중…</p>
              ) : !detail ? (
                <p className={`sm:col-span-2 ${T.empty}`}>상세 정보를 불러올 수 없습니다.</p>
              ) : (
                <>
                  {/* 자격·직종 */}
                  <section>
                    <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">자격·직종</p>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.professions.map((p) => (
                        <span key={p.profession} className={`rounded-md px-2 py-1 text-[13px] font-bold ${p.verifyStatus === "VERIFIED" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                          {PROF_LABEL[p.profession] ?? p.profession} · 경력 {p.experienceYears}년
                          {p.certifiedAt ? ` · 취득 ${p.certifiedAt}` : ""}{p.verifyStatus === "VERIFIED" ? " ✓검증" : ""}
                        </span>
                      ))}
                    </div>
                  </section>

                  {/* 소개 */}
                  {detail.bio && (
                    <section>
                      <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">소개</p>
                      <p className="whitespace-pre-wrap text-sm font-semibold text-slate-600">{detail.bio}</p>
                    </section>
                  )}

                  {/* 경력 이력 */}
                  <section>
                    <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">경력 이력</p>
                    {detail.experiences.length === 0 ? (
                      <p className="text-sm font-semibold text-slate-400">등록된 경력 이력이 없습니다.</p>
                    ) : (
                      <>
                      <ul className="space-y-2">
                        {detail.experiences.slice((expPage - 1) * PANEL, expPage * PANEL).map((e, i) => (
                          <li key={i} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-black text-slate-800">{e.orgName}{e.title ? ` · ${e.title}` : ""}</p>
                              <p className="whitespace-nowrap text-[13px] font-semibold text-slate-400">{e.startDate} ~ {e.endDate ?? "재직중"}</p>
                            </div>
                            {e.profession && <p className="mt-0.5 text-[13px] font-semibold text-slate-500">{PROF_LABEL[e.profession] ?? e.profession}</p>}
                            {e.description && <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-500">{e.description}</p>}
                          </li>
                        ))}
                      </ul>
                      <PanelPager page={expPage} total={detail.experiences.length} size={PANEL} onPage={setExpPage} />
                      </>
                    )}
                  </section>

                  {/* 후기 */}
                  <section>
                    <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">후기 ({detail.reviews.length})</p>
                    {detail.reviews.length === 0 ? (
                      <p className="text-sm font-semibold text-slate-400">아직 등록된 후기가 없습니다.</p>
                    ) : (
                      <>
                      <ul className="space-y-2">
                        {detail.reviews.slice((revPage - 1) * PANEL, revPage * PANEL).map((r, i) => (
                          <li key={i} className="rounded-xl border border-slate-100 px-3 py-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-black text-amber-500">{"★".repeat(r.rating)}<span className="text-slate-200">{"★".repeat(5 - r.rating)}</span></span>
                              <span className="text-[13px] font-semibold text-slate-400">{r.createdAt}</span>
                            </div>
                            {r.comment && <p className="mt-1 text-sm text-slate-600">{r.comment}</p>}
                          </li>
                        ))}
                      </ul>
                      <PanelPager page={revPage} total={detail.reviews.length} size={PANEL} onPage={setRevPage} />
                      </>
                    )}
                  </section>
                </>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button onClick={() => setDetailFor(null)} className={T.btnSecondary}>닫기</button>
              <button onClick={() => { const c = detailFor; setDetailFor(null); setOfferTo(c); }} className={T.btnPrimary}>제안 보내기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
