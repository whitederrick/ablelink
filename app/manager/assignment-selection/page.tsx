"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import Pagination from "../_components/Pagination";
import { workerLabel } from "../_format";
import { Search } from "lucide-react";

const SITE_PAGE = 10;    // 좌측 현장 목록 페이지당
const DETAIL_PAGE = 10;  // 우측 후보 페이지당
const CELL = "px-2.5 py-3 align-middle text-[15px]";
const TH = "border-b border-slate-100 bg-slate-50 px-2.5 py-2 text-left text-[14px] font-black text-slate-500 whitespace-nowrap";

const WT_LABEL: Record<string, string> = { AM: "오전", PM: "오후", FULL_DAY: "전일", CUSTOM: "직접" };
const fmtDate = (iso: string | null) => (iso ? iso.slice(5, 10).replace("-", ".") : "");
const fmtPhone = (p: string) => p.replace(/-/g, "").replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3");

// 요청 상태 = 직무지도원 회신 결과(후보 응답 축). 4종만 존재.
// DROPPED는 '제외'(담당자가 수락 후보를 선정에서 뺀 상태)로, 요청 상태로는 '요청 수락'으로 표기한다.
const STATE: Record<string, { label: string; cls: string }> = {
  REQUESTED: { label: "회신 대기", cls: "bg-sky-50 text-sky-600" },
  ACCEPTED:  { label: "요청 수락", cls: "bg-emerald-50 text-emerald-600" },
  REJECTED:  { label: "요청 거절", cls: "bg-rose-50 text-rose-600" },
  EXPIRED:   { label: "기한 초과", cls: "bg-slate-100 text-slate-400" },
};
// 요청 상태 표시용: 제외(DROPPED)는 '요청 수락'으로 보여준다.
const reqStatusOf = (s: string) => (s === "DROPPED" ? "ACCEPTED" : s);
// 선정/제외 토글 대상 = 수락(ACCEPTED) 또는 제외(DROPPED)
const isSelectable = (s: string) => s === "ACCEPTED" || s === "DROPPED";

type Candidate = {
  assignmentId: string; workerId: string; workerName: string; loginId: string; phone: string; status: string;
  chosenWorkType: string | null; requestedWorkTypes: string[]; replyDeadline: string | null;
  requestedAt: string | null; // 요청 발송일(assignedAt)
};
type Group = { siteId: string; siteName: string; siteAddress: string; capacity: number; capAm?: number; capPm?: number; capFull?: number; candidates: Candidate[] };

// 근무 형태 표기(오전 / 오후 / 전일 / 오전·오후)
function workTypeText(c: Candidate): string {
  // 수락·제외(수락했던 후보)는 선택한 근무형태, 그 외는 요청한 근무형태 목록
  const list = isSelectable(c.status) && c.chosenWorkType ? [c.chosenWorkType] : c.requestedWorkTypes;
  return list.map(w => WT_LABEL[w] ?? w).join("/") || "-";
}

export default function AssignmentSelectionPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"deadline" | "recent" | "site">("deadline");
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [siteFilter, setSiteFilter] = useState<"all" | "selectable" | "waiting">("all");
  const [siteListPage, setSiteListPage] = useState(1);
  const [detailPage, setDetailPage] = useState(1);
  useEffect(() => { setDetailPage(1); }, [selectedSiteId]);

  // 담당자 선정(수락) 집합: siteId → 수락할 assignmentId 들
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});

  async function load() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/admin/assignment-requests", { cache: "no-store" });
      const d = await res.json();
      if (d.success) setGroups(d.groups ?? []);
      else setError(d.message || "불러오지 못했습니다.");
    } catch { setError("불러오지 못했습니다."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const dl = (c: Candidate) => (c.replyDeadline ? new Date(c.replyDeadline).getTime() : Infinity);
  const acceptedOf = (g: Group) => g.candidates.filter(c => c.status === "ACCEPTED");
  // 수락한 전체(이후 제외된 사람 포함). 수락 인원 수 = 요청을 수락한 전체.
  const acceptedAllOf = (g: Group) => g.candidates.filter(c => isSelectable(c.status));

  const processed = useMemo(() => {
    const q = search.trim().toLowerCase();
    let gs = groups
      .map(g => {
        if (!q || g.siteName.toLowerCase().includes(q)) return g;
        const cands = g.candidates.filter(c => c.workerName.toLowerCase().includes(q) || c.phone.replace(/-/g, "").includes(q.replace(/-/g, "")));
        return { ...g, candidates: cands };
      })
      .filter(g => g.candidates.length > 0);
    gs.sort((a, b) => {
      if (sort === "site") return a.siteName.localeCompare(b.siteName, "ko");
      if (sort === "recent") return Math.max(...b.candidates.map(c => Number(c.assignmentId))) - Math.max(...a.candidates.map(c => Number(c.assignmentId)));
      return Math.min(...a.candidates.map(dl)) - Math.min(...b.candidates.map(dl));
    });
    return gs;
  }, [groups, search, sort]);

  const siteFiltered = useMemo(() => processed.filter(g => {
    if (siteFilter === "selectable") return acceptedOf(g).length > 0;
    if (siteFilter === "waiting") return acceptedOf(g).length === 0;
    return true;
  }), [processed, siteFilter]);
  const sitePages = Math.max(1, Math.ceil(siteFiltered.length / SITE_PAGE));
  const pageGroups = siteFiltered.slice((siteListPage - 1) * SITE_PAGE, siteListPage * SITE_PAGE);
  useEffect(() => { setSiteListPage(1); }, [search, sort, siteFilter]);

  // 선택 현장 자동 지정
  useEffect(() => {
    if (loading) return;
    if (siteFiltered.length === 0) { setSelectedSiteId(null); return; }
    if (!selectedSiteId || !siteFiltered.some(g => g.siteId === selectedSiteId)) setSelectedSiteId(siteFiltered[0].siteId);
  }, [siteFiltered, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = processed.find(g => g.siteId === selectedSiteId) ?? null;

  // 현장 진입 시: 아직 담당자가 손대지 않았으면 수락(ACCEPTED) 후보를 기본 선정으로 채움
  useEffect(() => {
    if (!sel) return;
    setSelected(prev => {
      if (prev[sel.siteId] !== undefined) return prev;
      return { ...prev, [sel.siteId]: new Set(sel.candidates.filter(c => c.status === "ACCEPTED").map(c => c.assignmentId)) };
    });
  }, [sel?.siteId, sel?.candidates.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function setPick(siteId: string, assignmentId: string, pick: boolean) {
    setSelected(prev => {
      const set = new Set(prev[siteId] ?? []);
      if (pick) set.add(assignmentId); else set.delete(assignmentId);
      return { ...prev, [siteId]: set };
    });
  }

  async function finalize(g: Group) {
    const ids = Array.from(selected[g.siteId] ?? []);
    if (g.capacity <= 0) { alert("현장 정원이 설정되지 않았습니다. 현장 관리에서 정원을 먼저 설정하세요."); return; }
    if (ids.length < 1 || ids.length > g.capacity) { alert(`선정 인원은 1명 이상 모집 인원(${g.capacity}명) 이하여야 합니다. (현재 ${ids.length}명)`); return; }
    const waitingCount = g.candidates.filter(c => c.status === "REQUESTED").length;
    if (waitingCount > 0 && ids.length !== g.capacity) {
      alert(`아직 회신 대기 중인 후보(${waitingCount}명)가 있습니다. 모집 인원(${g.capacity}명)을 다 채우거나, 회신 마감 후 부분 확정하세요.`);
      return;
    }
    const isPartial = ids.length < g.capacity;
    const msg = isPartial
      ? `${g.siteName}에 ${ids.length}명만 부분 확정할까요? (모집 ${g.capacity}명 중 ${ids.length}명)\n확정 후 남은 ${g.capacity - ids.length}자리를 채우는 추가 배정 요청 화면으로 이동합니다.`
      : `${g.siteName}에 ${ids.length}명을 최종 확정할까요?\n확정된 직무지도원은 배정 관리(계약 대기)로 넘어가며, 선정하지 않은 수락 후보는 '제외' 처리됩니다(부분 재요청 시 복원 가능).`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/assignment-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finalize", siteId: g.siteId, selectedAssignmentIds: ids }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      setSelected(prev => { const n = { ...prev }; delete n[g.siteId]; return n; });
      if (isPartial) {
        // 부분 확정 → 무조건 같은 현장 부족분 추가 배정 요청 화면으로 이동. 남은 근무형태·원 회신기한을 모달 프리필(현장 재생성 없음).
        const picked = g.candidates.filter(c => ids.includes(c.assignmentId));
        const cnt = (w: string) => picked.filter(c => c.chosenWorkType === w).length;
        const remWts: string[] = [];
        if ((g.capAm ?? 0) - cnt("AM") > 0) remWts.push("AM");
        if ((g.capPm ?? 0) - cnt("PM") > 0) remWts.push("PM");
        if ((g.capFull ?? 0) - cnt("FULL_DAY") > 0) remWts.push("FULL_DAY");
        const dl = g.candidates.find(c => c.replyDeadline)?.replyDeadline?.slice(0, 10) ?? "";
        const params = new URLSearchParams({ requestSite: g.siteId });
        if (remWts.length) params.set("wt", remWts.join(","));
        if (dl) params.set("deadline", dl);
        router.push(`/manager/workers?${params.toString()}`);
        return;
      }
      await load();
    } catch (e: any) { alert(e.message || "최종 확정에 실패했습니다."); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="직무지도원 배정 확정"
        sub="직무지도원이 수락한 후보 중 모집 인원만큼 선정해 확정합니다. 거절·기한 초과 건은 담당자가 변경할 수 없으며, 모집 인원이 다 차야 최종 확정할 수 있습니다."
      />
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}

      <div className="grid gap-5 lg:grid-cols-[11fr_9fr]">
        {/* ── 좌: 현장 목록 ── */}
        <div>
          <div className="mb-3 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="현장명 · 후보 검색" className={`w-full pl-9 ${T.input}`} />
            </div>
            <div className="flex gap-2">
              <select value={sort} onChange={e => setSort(e.target.value as any)} className={`flex-1 ${T.select}`}>
                <option value="deadline">회신 기한 임박순</option>
                <option value="recent">최신 요청순</option>
                <option value="site">현장명순</option>
              </select>
              <select value={siteFilter} onChange={e => setSiteFilter(e.target.value as any)} className={`flex-1 ${T.select}`}>
                <option value="all">전체</option>
                <option value="selectable">선정 가능</option>
                <option value="waiting">회신 대기</option>
              </select>
            </div>
          </div>

          {loading ? (
            <p className={T.empty}>불러오는 중…</p>
          ) : siteFiltered.length === 0 ? (
            <p className={T.empty}>{groups.length === 0 ? "확정할 배정 요청이 없습니다." : "조건에 맞는 현장이 없습니다."}</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full min-w-[856px] table-fixed">
                <colgroup>
                  <col style={{ width: "230px" }} />
                  <col />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "92px" }} />
                  <col style={{ width: "96px" }} />
                  <col style={{ width: "104px" }} />
                </colgroup>
                <thead>
                  <tr>{["현장(사업체)", "주소", "요청/수락/모집", "충족 여부", "요청 일자", "회신 기한"].map(h => <th key={h} className={TH}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {pageGroups.map(g => {
                    const reqN = g.candidates.length;          // 요청 = 요청 보낸 전체
                    const accN = acceptedAllOf(g).length;      // 수락 = 요청 수락한 전체(제외 포함)
                    const nearest = Math.min(...g.candidates.map(dl));
                    const reqTimes = g.candidates.map(c => (c.requestedAt ? new Date(c.requestedAt).getTime() : 0)).filter(t => t > 0);
                    const reqDate = reqTimes.length ? Math.max(...reqTimes) : null; // 대표 요청일 = 가장 최근 요청
                    const active = g.siteId === selectedSiteId;
                    const full = g.capacity > 0 && accN === g.capacity;
                    const over = g.capacity > 0 && accN > g.capacity; // 수락 > 모집(초과)
                    return (
                      <tr key={g.siteId} onClick={() => setSelectedSiteId(g.siteId)} className={`${T.trBase} cursor-pointer ${active ? "bg-sky-50" : "hover:bg-slate-50"}`}>
                        <td className={`${CELL} font-bold text-sky-600`}><div className="truncate" title={g.siteName}>{g.siteName}</div></td>
                        <td className={`${CELL} text-[13px] font-bold text-slate-900`}><div className="truncate" title={g.siteAddress}>{g.siteAddress || "-"}</div></td>
                        <td className={`${CELL} whitespace-nowrap font-bold text-slate-900`}>{reqN} / {accN} / {g.capacity || 0}</td>
                        <td className={CELL}>
                          {over
                            ? <span className={`${T.badge} bg-amber-50 text-amber-600`}>초과</span>
                            : full
                              ? <span className={`${T.badge} bg-emerald-50 text-emerald-600`}>충족</span>
                              : <span className={`${T.badge} bg-rose-50 text-rose-600`}>미충족</span>}
                        </td>
                        <td className={`${CELL} whitespace-nowrap text-[13px] font-bold text-slate-900`}>{reqDate ? fmtDate(new Date(reqDate).toISOString()) : "-"}</td>
                        <td className={`${CELL} whitespace-nowrap text-[13px] font-bold text-slate-900`}>{Number.isFinite(nearest) ? `~${fmtDate(new Date(nearest).toISOString())}` : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {siteFiltered.length > 0 && <Pagination className="mt-4" page={siteListPage} totalPages={sitePages} total={siteFiltered.length} onPageChange={setSiteListPage} />}
        </div>

        {/* ── 우: 선택 현장 상세 ── */}
        <div className="min-h-[420px] rounded-2xl border border-slate-200 bg-white">
          {!sel ? (
            <div className="flex h-[420px] items-center justify-center text-sm font-semibold text-slate-300">왼쪽에서 현장을 선택하세요.</div>
          ) : (() => {
            const selN = selected[sel.siteId]?.size ?? 0;
            const waitingCount = sel.candidates.filter(c => c.status === "REQUESTED").length; // 회신 대기(확정 게이트용)
            const reqTotal = sel.candidates.length;                       // 요청 = 요청 보낸 전체
            const acceptedTotal = sel.candidates.filter(c => isSelectable(c.status)).length; // 수락 = 요청 수락한 전체(제외 포함)
            // 회신 대기자가 있으면 모집 다 차야(==) 확정. 대기 0(전원 응답·기한초과)이면 부분 확정 허용(1~모집).
            const canFinalize = sel.capacity > 0 && selN >= 1 && selN <= sel.capacity && (waitingCount > 0 ? selN === sel.capacity : true);
            const partial = canFinalize && selN < sel.capacity;
            const order: Record<string, number> = { ACCEPTED: 0, REQUESTED: 1, REJECTED: 2, EXPIRED: 3, DROPPED: 4 };
            const ordered = [...sel.candidates].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || Number(a.assignmentId) - Number(b.assignmentId));
            const pages = Math.max(1, Math.ceil(ordered.length / DETAIL_PAGE));
            const rows = ordered.slice((detailPage - 1) * DETAIL_PAGE, detailPage * DETAIL_PAGE);
            return (
              <>
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-black text-slate-900" title={sel.siteName}>{sel.siteName}</p>
                    <p className="mt-1 text-[15px] font-black text-slate-600">
                      요청 인원 수: {reqTotal} / 수락 인원 수: {acceptedTotal} / 모집 인원 수: {sel.capacity}
                      <span className="ml-1 font-semibold text-slate-400">(오전 {sel.capAm ?? 0} · 오후 {sel.capPm ?? 0} · 전일 {sel.capFull ?? 0})</span>
                    </p>
                  </div>
                  <button type="button" disabled={!canFinalize || busy} onClick={() => finalize(sel)}
                    className={T.btnPrimary} title={!canFinalize ? (waitingCount > 0 ? "회신 대기자가 있어 모집 인원만큼 선정해야 확정할 수 있습니다." : "수락한 후보를 1명 이상 선정하세요.") : undefined}>
                    {busy ? "확정 중..." : partial ? "부분 확정" : "최종 확정"}
                  </button>
                </div>

                <div className="p-4">
                  <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                    <table className="w-full min-w-[700px] table-fixed">
                      <colgroup>
                        <col style={{ width: "200px" }} />
                        <col style={{ width: "132px" }} />
                        <col style={{ width: "112px" }} />
                        <col style={{ width: "104px" }} />
                        <col style={{ width: "150px" }} />
                      </colgroup>
                      <thead>
                        <tr>{["성명(아이디)", "전화번호", "요청 상태", "근무 형태", "처리 상태"].map(h => <th key={h} className={TH}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {rows.map(c => {
                          const st = STATE[reqStatusOf(c.status)] ?? { label: c.status, cls: "bg-slate-100 text-slate-500" };
                          const selectable = isSelectable(c.status);
                          const isPicked = selected[sel.siteId]?.has(c.assignmentId) ?? false;
                          return (
                            <tr key={c.assignmentId} className={`${T.trBase} ${selectable && isPicked ? "bg-sky-50" : ""}`}>
                              <td className={`${CELL} font-bold text-sky-600`}><div className="truncate" title={workerLabel(c.workerName, c.loginId)}>{workerLabel(c.workerName, c.loginId)}</div></td>
                              <td className={`${CELL} whitespace-nowrap text-[13px] font-bold text-slate-900`}>{fmtPhone(c.phone)}</td>
                              <td className={CELL}><span className={`${T.badge} ${st.cls}`}>{st.label}</span></td>
                              <td className={`${CELL} whitespace-nowrap font-bold text-slate-900`}>{workTypeText(c)}</td>
                              <td className={CELL}>
                                <div className="flex h-8 items-center">
                                {selectable ? (
                                  <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
                                    <button type="button" disabled={busy} onClick={() => setPick(sel.siteId, c.assignmentId, true)}
                                      className={`px-3 py-[5px] text-[13px] font-black transition ${isPicked ? "bg-emerald-600 text-white" : "bg-white text-slate-500 hover:bg-emerald-50 hover:text-emerald-600"}`}>선정</button>
                                    <button type="button" disabled={busy} onClick={() => setPick(sel.siteId, c.assignmentId, false)}
                                      className={`border-l border-slate-200 px-3 py-[5px] text-[13px] font-black transition ${!isPicked ? "bg-rose-600 text-white" : "bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-600"}`}>제외</button>
                                  </div>
                                ) : c.status === "EXPIRED" ? (
                                  <span className="text-[13px] font-bold text-slate-400">선정 불가</span>
                                ) : (
                                  <span className="text-[13px] text-slate-300">-</span>
                                )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {ordered.length > DETAIL_PAGE && <Pagination className="mt-4" page={detailPage} totalPages={pages} total={ordered.length} onPageChange={setDetailPage} />}
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
