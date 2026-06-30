"use client";

// 매니저 문서 허브 — 직무지도원이 제출한 문서를 한 곳에서 조회 → 확정 → 서명.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import { workerLabel } from "../_format";
import { docSubmitStatus, DOC_SUBMIT_BADGE } from "../_docStatus";

const DOC_PAGE_SIZE = 12;

type Item = {
  id: string;
  docLabel: string;
  traineeName: string | null;
  workerName: string;
  workerLoginId: string;
  siteName: string;
  periodStart: string;
  periodEnd: string;
  signStage: string;
  govStatus: string;
  govSubmittedAt: string | null;
  govSubmitCount: number;
  currentVersionId: string | null;
  versionNo: number | null;
  versionCount: number;
  submittedAt: string | null;
  updatedAt: string;
};

export default function ManagerDocumentsHub() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  // 딥링크: ?q=대상 검색 시드 + ?focus=문서ID 로 해당 문서 미리보기 자동 오픈(대시보드 제출 문서 현황 클릭)
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sq = sp.get("q");
    const sf = sp.get("focus");
    if (sq) setQ(sq);
    if (sf) setFocusId(sf);
  }, []);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  // 대시보드 '전체 목록 보기' → ?stage=SUBMITTED|CONFIRMED 로 진입 시 해당 상태 필터 적용
  useEffect(() => {
    const st = new URLSearchParams(window.location.search).get("stage");
    if (st) setStatusFilter(st.split(",").map(s => s.trim()).filter(Boolean));
  }, []);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [preview, setPreview] = useState<Item | null>(null);
  const [zipping, setZipping] = useState(false);
  const [versions, setVersions] = useState<{ id: string; versionNo: number; createdAt: string }[]>([]);
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);

  // 문서 발송(→ 장애인고용공단)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [govContacts, setGovContacts] = useState<{ name: string; email: string }[]>([]);
  const govEmailDefault = govContacts.map(c => c.email).filter(Boolean).join(", ");
  const govNames = govContacts.map(c => c.name).filter(Boolean).join(" · ");
  const [sendGroupBy, setSendGroupBy] = useState<"site" | "worker" | "none">("site");
  const [useSiteGov, setUseSiteGov] = useState(false);
  const [sendMsg, setSendMsg] = useState("");
  const [sending, setSending] = useState(false);

  // 설정에 저장된 공단 담당자(발송 기본 수신자) 로드
  useEffect(() => {
    fetch("/api/admin/agency-profile")
      .then(r => r.json())
      .then(d => { if (d.success) setGovContacts(Array.isArray(d.data?.govContacts) ? d.data.govContacts : []); })
      .catch(() => {});
  }, []);

  const toggleSel = (id: string) => setSelected(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function openPreview(item: Item) {
    setPreview(item);
    setViewVersionId(item.currentVersionId);
    setVersions([]);
    // 버전 이력 조회(과거 버전 포함)
    fetch(`/api/admin/document-versions?runId=${item.id}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setVersions((d.items || []).map((v: any) => ({ id: String(v.id), versionNo: v.versionNo, createdAt: v.createdAt })));
      })
      .catch(() => {});
  }

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    // 처리 대기(미제출·재제출요구)만. 공단 제출완료분은 '공단 제출 내역' 메뉴에서 조회.
    fetch(`/api/admin/document-runs/inbox?govStatus=NONE,RESUBMIT`)
      .then(r => r.json())
      .then(d => { if (d.success) setItems(d.items); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // 딥링크 focus: 목록이 로드되면 해당 문서 미리보기를 1회 자동 오픈
  useEffect(() => {
    if (!focusId || items.length === 0) return;
    const target = items.find(it => it.id === focusId);
    if (target) openPreview(target);
    setFocusId(null);
  }, [focusId, items]);

  const summary = useMemo(() => {
    const c = { SUBMITTED: 0, CONFIRMED: 0, MANAGER_SIGNED: 0, CHANGES_REQUESTED: 0 } as Record<string, number>;
    for (const it of items) if (c[it.signStage] != null) c[it.signStage]++;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items
      .filter(it => statusFilter.length === 0 || statusFilter.includes(it.signStage))
      .filter(it => !query || it.workerName.toLowerCase().includes(query) || (it.siteName ?? "").toLowerCase().includes(query) || (it.traineeName ?? "").toLowerCase().includes(query) || it.docLabel.toLowerCase().includes(query));
  }, [items, q, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / DOC_PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * DOC_PAGE_SIZE, page * DOC_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [q, statusFilter]);

  const filters: FilterChip[] = [
    { value: "SUBMITTED", label: "제출완료", count: summary.SUBMITTED },
    { value: "CONFIRMED", label: "확정", count: summary.CONFIRMED },
    { value: "MANAGER_SIGNED", label: "서명완료", count: summary.MANAGER_SIGNED },
    { value: "CHANGES_REQUESTED", label: "수정요청", count: summary.CHANGES_REQUESTED },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  function fileNameOf(item: Item) {
    return `${item.docLabel}_${item.workerName}${item.traineeName ? `_${item.traineeName}` : ""}_${item.periodStart}_${item.periodEnd}.pdf`;
  }

  async function downloadPdf(item: Item) {
    if (!item.currentVersionId) { showToast("다운로드할 버전이 없습니다."); return; }
    try {
      const res = await fetch(`/api/admin/document-versions/${item.currentVersionId}/pdf`);
      if (!res.ok) { showToast("다운로드 실패"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileNameOf(item); a.click();
      URL.revokeObjectURL(url);
    } catch { showToast("다운로드 실패"); }
  }

  async function downloadSelected() {
    if (selected.size === 0) { showToast("다운로드할 문서를 선택해주세요."); return; }
    setZipping(true);
    try {
      const res = await fetch(`/api/admin/document-runs/zip?ids=${[...selected].join(",")}`);
      if (!res.ok) { showToast("다운로드 실패"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `제출문서_${new Date().toISOString().slice(0, 10)}.zip`; a.click();
      URL.revokeObjectURL(url);
    } catch { showToast("다운로드 실패"); }
    finally { setZipping(false); }
  }

  // 공단 제출 상태 수동 변경(앱 외 제출 반영 등). 일지 관리에선 '제출완료로 표시'만 노출.
  async function markGov(status: "SUBMITTED" | "RESUBMIT" | "NONE") {
    if (selected.size === 0) { showToast("대상 문서를 선택해주세요."); return; }
    try {
      const res = await fetch(`/api/admin/document-runs/gov-status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], status }),
      });
      const d = await res.json();
      if (!d.success) { showToast(d.message || "변경 실패"); return; }
      showToast(d.message || "변경되었습니다.");
      setSelected(new Set()); load();
    } catch { showToast("변경 실패"); }
  }

  function openSend() {
    if (selected.size === 0) { showToast("발송할 문서를 선택해주세요."); return; }
    setSendTo(govEmailDefault);
    setSendMsg("");
    setSendOpen(true);
  }

  async function doSend() {
    const siteGov = useSiteGov && sendGroupBy === "site";
    const emails = sendTo.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!siteGov) {
      if (emails.length === 0 || !emails.every(e => re.test(e))) { showToast("유효한 수신자 이메일을 입력해주세요. (여러 명은 쉼표로 구분)"); return; }
    } else if (emails.length && !emails.every(e => re.test(e))) {
      showToast("추가 수신자 이메일 형식이 올바르지 않습니다."); return;
    }
    const to = emails.join(",");
    setSending(true);
    try {
      const res = await fetch(`/api/admin/document-runs/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], to, groupBy: sendGroupBy, message: sendMsg.trim(), useSiteContacts: siteGov }),
      });
      const d = await res.json();
      if (!d.success) {
        // 서명 누락은 여러 줄 목록이라 토스트로는 잘림 → 전체를 alert로 안내
        if (d.code === "MISSING_SIGNATURES") alert(d.message);
        else showToast(d.message || "발송 실패");
        return;
      }
      showToast(d.message || "발송되었습니다.");
      setSendOpen(false); setSelected(new Set()); load();
    } catch { showToast("발송 실패"); }
    finally { setSending(false); }
  }

  async function act(id: string, action: string, reason?: string) {
    const res = await fetch(`/api/admin/document-runs/${id}/action`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    return res.json();
  }

  async function handleConfirm(item: Item) {
    if (!confirm(`${item.docLabel}${item.traineeName ? `(${item.traineeName})` : ""} — 내용을 확인하셨나요?\n확정 처리합니다.`)) return;
    setBusy(item.id);
    try {
      const d = await act(item.id, "confirm");
      if (!d.success) { showToast(d.message || "확정 실패"); return; }
      if (confirm("확정되었습니다. 지금 매니저 서명을 등록할까요?")) {
        await handleSign(item);
      } else { showToast("확정되었습니다."); load(); }
    } finally { setBusy(null); }
  }

  async function handleSign(item: Item) {
    setBusy(item.id);
    try {
      const d = await act(item.id, "sign");
      if (!d.success) {
        if (d.needSignature && confirm(`${d.message}\n\n'내 서명' 화면으로 이동할까요?`)) router.push("/manager/signature");
        else showToast(d.message || "서명 실패");
        return;
      }
      showToast("서명까지 완료되었습니다."); setPreview(null); load();
    } finally { setBusy(null); }
  }

  async function handleRequestChanges(item: Item) {
    const reason = prompt("수정요청 사유를 입력하세요 (직무지도원에게 알림으로 전달됩니다):", "");
    if (reason === null) return;
    setBusy(item.id);
    try {
      const d = await act(item.id, "request-changes", reason);
      if (!d.success) { showToast(d.message || "요청 실패"); return; }
      showToast("수정요청을 보냈습니다."); setPreview(null); load();
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="일지 관리" sub="처리할 문서(공단 미제출·재제출요구)를 조회·확정·서명하고, 공단에 발송합니다. 발송하면 ‘공단 제출 내역’으로 이동합니다." />

      <StatCardRow
        cols={4}
        items={[
          { label: "제출완료", value: summary.SUBMITTED, tone: "sky" },
          { label: "확정", value: summary.CONFIRMED, tone: "amber" },
          { label: "서명완료", value: summary.MANAGER_SIGNED, tone: "emerald" },
          { label: "수정요청", value: summary.CHANGES_REQUESTED, tone: "rose" },
        ]}
      />

      <ListToolbar
        query={q}
        onQueryChange={setQ}
        placeholder="직무지도원·현장·훈련생·문서명 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
        extraFirst
        extra={
          <div className="flex items-center gap-2">
            <button onClick={openSend} disabled={selected.size === 0} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white active:scale-95 disabled:opacity-40">
              선택 발송{selected.size > 0 ? ` (${selected.size})` : ""}
            </button>
            <button onClick={downloadSelected} disabled={zipping} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 active:scale-95 disabled:opacity-50">
              {zipping ? "압축 중…" : `선택 다운로드${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </button>
            <button onClick={() => markGov("SUBMITTED")} disabled={selected.size === 0} title="공단에 직접(앱 외) 제출한 경우 제출완료로 표시"
              className="rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-black text-emerald-700 active:scale-95 disabled:opacity-40">
              공단 제출완료로 표시
            </button>
          </div>
        }
      />

      {loading ? (
        <p className="py-16 text-center text-sm font-semibold text-slate-300">불러오는 중…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white py-16 text-center">
          <p className="text-sm font-semibold text-slate-400">{items.length === 0 ? "제출된 문서가 없습니다." : "조건에 맞는 문서가 없습니다."}</p>
          {items.length === 0 && <p className="mt-1 text-xs font-semibold text-slate-300">직무지도원이 앱에서 문서를 제출하면 여기에 표시됩니다.</p>}
        </div>
      ) : (
        <>
        <div className={T.tableWrap}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={`${T.th} w-10`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-slate-900"
                    aria-label="현재 페이지 전체 선택"
                    checked={pageItems.length > 0 && pageItems.every(it => selected.has(it.id))}
                    onChange={e => setSelected(p => {
                      const n = new Set(p);
                      if (e.target.checked) pageItems.forEach(it => n.add(it.id));
                      else pageItems.forEach(it => n.delete(it.id));
                      return n;
                    })}
                  />
                </th>
                {["일지 제출 상태", "문서명", "직무지도원 성명(아이디)", "현장(사업체)", "근무 기간", "작업"].map(h => <th key={h} className={T.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {pageItems.map(item => (
                <tr key={item.id} className={`${T.trBase} ${selected.has(item.id) ? "bg-sky-50/60" : ""}`}>
                  <td className={T.td}>
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-slate-900" aria-label="선택"
                      checked={selected.has(item.id)} onChange={() => toggleSel(item.id)} />
                  </td>
                  <td className={T.td}><StatusBadge status={docSubmitStatus(item)} map={DOC_SUBMIT_BADGE} /></td>
                  <td className={T.td}>
                    <span className="font-semibold text-slate-900">{item.docLabel}</span>
                    {item.traineeName && <span className="text-[13px] text-slate-500"> · {item.traineeName}</span>}
                    {item.versionNo && item.versionNo > 1 && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[12px] font-black text-amber-700">v{item.versionNo}</span>
                    )}
                  </td>
                  <td className={`${T.td} whitespace-nowrap`}>{workerLabel(item.workerName, item.workerLoginId)}</td>
                  <td className={T.td}><div className="max-w-[150px] truncate">{item.siteName}</div></td>
                  <td className={`${T.td} whitespace-nowrap text-[13px] text-slate-500`}>{item.periodStart}~{item.periodEnd}</td>
                  <td className={T.td}>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => openPreview(item)} className="inline-flex h-7 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-bold text-slate-700 active:scale-95">문서 보기</button>
                      <button onClick={() => downloadPdf(item)} className="inline-flex h-7 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-bold text-slate-700 active:scale-95">다운로드</button>
                      {item.signStage === "SUBMITTED" && (
                        <>
                          <button disabled={busy === item.id} onClick={() => handleConfirm(item)} className="inline-flex h-7 items-center rounded-lg bg-slate-950 px-2.5 text-[13px] font-bold text-white active:scale-95 disabled:opacity-50">확정</button>
                          <button disabled={busy === item.id} onClick={() => handleRequestChanges(item)} className="inline-flex h-7 items-center rounded-lg border border-rose-200 bg-white px-2.5 text-[13px] font-bold text-rose-600 active:scale-95 disabled:opacity-50">수정요청</button>
                        </>
                      )}
                      {item.signStage === "CONFIRMED" && (
                        <button disabled={busy === item.id} onClick={() => handleSign(item)} className="inline-flex h-7 items-center rounded-lg bg-emerald-600 px-2.5 text-[13px] font-bold text-white active:scale-95 disabled:opacity-50">서명</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination className="mt-4" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
        </>
      )}

      {/* 문서 보기 모달 */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setPreview(null)}>
          <div className="flex h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-900">
                  {preview.docLabel}{preview.traineeName ? ` · ${preview.traineeName}` : ""}
                  {preview.versionNo && preview.versionNo > 1 ? ` (v${preview.versionNo})` : ""}
                </p>
                <p className="truncate text-xs font-semibold text-slate-400">{preview.workerName} · {preview.periodStart}~{preview.periodEnd}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => downloadPdf(preview)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 active:scale-95">다운로드</button>
                {preview.signStage === "SUBMITTED" && (
                  <>
                    <button disabled={busy === preview.id} onClick={() => handleConfirm(preview)} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-black text-white active:scale-95 disabled:opacity-50">확정</button>
                    <button disabled={busy === preview.id} onClick={() => handleRequestChanges(preview)} className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-black text-rose-600 active:scale-95 disabled:opacity-50">수정요청</button>
                  </>
                )}
                {preview.signStage === "CONFIRMED" && (
                  <button disabled={busy === preview.id} onClick={() => handleSign(preview)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white active:scale-95 disabled:opacity-50">서명</button>
                )}
                <button onClick={() => setPreview(null)} className="rounded-lg px-2 py-1.5 text-sm font-black text-slate-400 active:scale-95">✕</button>
              </div>
            </div>
            {/* 버전 이력 — 과거 버전 조회 */}
            {versions.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-100 bg-slate-50 px-4 py-2">
                <span className="shrink-0 text-[11px] font-black text-slate-400">버전</span>
                {versions.map(v => {
                  const isLatest = v.id === preview.currentVersionId;
                  const active = v.id === viewVersionId;
                  return (
                    <button
                      key={v.id}
                      onClick={() => setViewVersionId(v.id)}
                      title={new Date(v.createdAt).toLocaleString("ko-KR")}
                      className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-black transition ${active ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
                    >
                      v{v.versionNo}{isLatest ? " (최신)" : ""}
                    </button>
                  );
                })}
              </div>
            )}
            {viewVersionId ? (
              <iframe src={`/api/admin/document-versions/${viewVersionId}/pdf`} className="flex-1 border-0 bg-slate-100" title="문서 미리보기" />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm font-semibold text-slate-400">조회할 버전이 없습니다.</div>
            )}
          </div>
        </div>
      )}

      {/* 문서 발송 모달 (→ 장애인고용공단) */}
      {sendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => !sending && setSendOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-base font-black text-slate-900">문서 발송</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-400">선택한 <strong className="text-slate-700">{selected.size}건</strong>의 최종본 PDF를 장애인고용공단 담당자에게 이메일로 발송합니다.</p>

            <div className="mt-5 space-y-4">
              <div>
                <label className={T.label}>{useSiteGov && sendGroupBy === "site" ? "추가 수신자 이메일 (선택)" : "수신자 이메일"}</label>
                <input value={sendTo} onChange={e => setSendTo(e.target.value)} type="email" inputMode="email"
                  placeholder="officer@kead.or.kr" className={`w-full ${T.input}`} />
                <p className="mt-1 text-[11px] font-semibold text-slate-400">
                  {useSiteGov && sendGroupBy === "site"
                    ? "현장별 공단 담당자에게 자동 발송됩니다. 추가로 받을 사람만 입력하세요."
                    : govEmailDefault ? `설정 기본값${govNames ? ` · ${govNames}` : ""} · 여러 명은 쉼표(,)로 구분 (수정 가능)` : "운영관리 > 위탁기관 정보 관리에서 공단 담당자를 저장하면 기본값으로 채워집니다."}
                </p>
              </div>

              <div>
                <label className={T.label}>묶음 방식</label>
                <div className="grid grid-cols-3 gap-2">
                  {([["site", "현장별 묶음"], ["worker", "직무지도원별 묶음"], ["none", "개별 발송"]] as const).map(([v, lbl]) => (
                    <button key={v} type="button" onClick={() => setSendGroupBy(v)}
                      className={`rounded-xl border px-3 py-2 text-[13px] font-bold transition ${sendGroupBy === v ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] font-semibold text-slate-400">
                  {sendGroupBy === "site" ? "현장 단위로 한 통에 묶어 발송합니다." : sendGroupBy === "worker" ? "직무지도원 단위로 한 통에 묶어 발송합니다." : "문서마다 개별 메일로 발송합니다."}
                </p>
                {sendGroupBy === "site" && (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <input type="checkbox" checked={useSiteGov} onChange={e => setUseSiteGov(e.target.checked)} className="h-4 w-4 accent-slate-950" />
                    <span className="text-[13px] font-bold text-slate-700">현장별 공단 담당자에게 자동 발송 <span className="font-semibold text-slate-400">(현장에 지정된 공단 담당자, 없으면 기관 기본값)</span></span>
                  </label>
                )}
              </div>

              <div>
                <label className={T.label}>메시지 (선택)</label>
                <textarea value={sendMsg} onChange={e => setSendMsg(e.target.value)} rows={3}
                  placeholder="메일 본문 상단에 함께 보낼 안내 문구를 입력하세요." className={`w-full ${T.input} py-2`} />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button onClick={() => setSendOpen(false)} disabled={sending} className={T.btnSecondary}>취소</button>
              <button onClick={doSend} disabled={sending} className={T.btnPrimary}>{sending ? "발송 중…" : "발송"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-8 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg">{toast}</div>}
    </div>
  );
}
