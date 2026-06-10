"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import { X } from "lucide-react";

type WorkType = "AM" | "PM" | "FULL_DAY" | "CUSTOM" | "";
type ContractStatus = "PENDING" | "SIGNED" | "COMPLETED" | "CANCELLED";

const CONTRACT_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING:   { label: "서명 대기",       tone: "amber" },
  SIGNED:    { label: "직무지도원 서명", tone: "sky" },
  COMPLETED: { label: "계약 완료",       tone: "emerald" },
  CANCELLED: { label: "취소",            tone: "slate" },
};
const PAGE_SIZE = 10;

interface ContractItem {
  id: string; workerId: string; workerName: string; userPhone: string;
  contractStart: string; contractEnd: string; siteName: string | null;
  workType: string | null; status: ContractStatus; signToken: string;
  workerSignedAt: string | null; adminSignedAt: string | null; createdAt: string;
}

interface SearchResult {
  id: string; workerName: string; phoneNumber: string; email: string;
  siteName: string | null; contractStart: string | null; contractEnd: string | null;
}

const WORK_TYPE_LABELS: Record<string, string> = {
  AM: "오전 4H (09:00~12:00)", PM: "오후 4H (13:00~17:00)",
  FULL_DAY: "전일 8H (09:00~18:00)", CUSTOM: "직접 입력",
};

function formatPeriod(start: string | null, end: string | null): string {
  if (!start) return "-";
  const s = start.slice(0, 7).replace("-", ".");
  const e = end ? end.slice(0, 7).replace("-", ".") : "진행중";
  return `${s} ~ ${e}`;
}

function WorkerSearchPopup({ onSelect, onClose }: {
  onSelect: (r: SearchResult) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setSearched(false); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/contracts/worker-search?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        if (data.success) setResults(data.items);
      } finally { setSearching(false); setSearched(true); }
    }, 400);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className={T.modalOverlay} style={{ zIndex: 1100 }}>
      <div className="flex w-full max-w-2xl max-h-[80vh] flex-col overflow-hidden rounded-3xl bg-white p-7 shadow-2xl shadow-slate-950/20">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900">직무지도원 검색</h3>
            <p className="mt-0.5 text-xs font-semibold text-slate-400">이름 또는 전화번호로 검색 (과거 근로계약 이력 기준)</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
          placeholder="이름 또는 전화번호 (2자 이상 입력)"
          className={`mb-4 w-full ${T.input}`} />

        <div className="flex-1 overflow-y-auto">
          {searching && <p className={T.empty}>검색 중...</p>}
          {!searching && searched && results.length === 0 && <p className={T.empty}>검색 결과가 없습니다.</p>}
          {!searching && results.length > 0 && (
            <div className={T.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>{["이름", "전화번호", "이메일", "최근 직무지도 사업체", "근무 기간"].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.id} onClick={() => { onSelect(r); onClose(); }}
                      className={`${T.trBase} cursor-pointer hover:bg-sky-50`}>
                      <td className={`${T.td}`}>{r.workerName}</td>
                      <td className={`${T.td}`}>{r.phoneNumber}</td>
                      <td className={`${T.td}`}>{r.email || "-"}</td>
                      <td className={`${T.td}`}>{r.siteName || <span className="text-slate-300">미지정</span>}</td>
                      <td className={`${T.td} whitespace-nowrap`}>{formatPeriod(r.contractStart, r.contractEnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateContractModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: (item: ContractItem, url: string) => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [contractStart, setStart] = useState("");
  const [contractEnd, setEnd] = useState("");
  const [siteName, setSiteName] = useState("");
  const [workType, setWorkType] = useState<WorkType>("FULL_DAY");
  const [commuteGuide, setCommuteGuide] = useState(true);
  const [customStart, setCustomStart] = useState("09:00");
  const [customEnd, setCustomEnd] = useState("18:00");
  const [adminMemo, setAdminMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function handleSelectWorker(r: SearchResult) { setSelectedUserId(r.id); setManualName(r.workerName); setManualPhone(r.phoneNumber); }
  function clearSelection() { setSelectedUserId(""); }

  async function handleCreate() {
    if (!manualName.trim() || !manualPhone.trim()) { setError("직무지도원 이름과 전화번호는 필수입니다."); return; }
    if (!contractStart || !contractEnd) { setError("계약 시작일과 종료일은 필수입니다."); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/admin/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: selectedUserId || undefined,
          manualName: manualName.trim(), manualPhone: manualPhone.trim(),
          contractStart, contractEnd, siteName: siteName || null, workType: workType || null,
          commuteGuidanceIncluded: workType === "FULL_DAY" ? false : commuteGuide,
          customWorkStart: workType === "CUSTOM" ? customStart : null,
          customWorkEnd:   workType === "CUSTOM" ? customEnd   : null,
          adminMemo: adminMemo || null,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      alert(data.message);
      onCreated({} as ContractItem, data.contractUrl);
      onClose();
    } catch (e: any) { setError(e.message || "생성에 실패했습니다."); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className={T.modalOverlay} onClick={() => !saving && onClose()}>
        <div className={T.modalContent} onClick={e => e.stopPropagation()}>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-base font-black text-slate-900">근로계약서 생성</h2>
            <button onClick={() => !saving && onClose()}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <label className={T.label}>직무지도원 정보 *</label>
              <div className="flex gap-2">
                <input value={manualName} onChange={e => { setManualName(e.target.value); clearSelection(); }}
                  placeholder="이름" className={`flex-1 ${T.input}`} />
                <button type="button" onClick={() => setShowSearch(true)}
                  className="whitespace-nowrap rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100">
                  이력 검색
                </button>
              </div>
              <input value={manualPhone} onChange={e => { setManualPhone(e.target.value); clearSelection(); }}
                placeholder="전화번호 (예: 010-1234-5678)" className={`w-full ${T.input}`} />
              {selectedUserId ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                  ✓ 과거 이력에서 선택됨 — <strong>{manualName}</strong>
                </div>
              ) : (
                <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700">
                  과거 계약 이력이 있으면 검색으로 자동 입력됩니다. 신규 직무지도원은 이름과 전화번호를 직접 입력하세요.
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className={T.label}>계약 시작일 *</label>
                <input type="date" value={contractStart} onChange={e => setStart(e.target.value)} className={`w-full ${T.input}`} />
              </div>
              <div className="space-y-1.5">
                <label className={T.label}>계약 종료일 *</label>
                <input type="date" value={contractEnd} onChange={e => setEnd(e.target.value)} className={`w-full ${T.input}`} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={T.label}>근무 사업체명 (미입력 시 직무지도원이 직접 입력)</label>
              <input value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="사업체명" className={`w-full ${T.input}`} />
            </div>

            <div className="space-y-1.5">
              <label className={T.label}>근무형태 (미입력 시 직무지도원이 직접 입력)</label>
              <div className="grid grid-cols-2 gap-2">
                {(["AM", "PM", "FULL_DAY", "CUSTOM", ""] as WorkType[]).map(wt => (
                  <button key={wt || "none"} type="button" onClick={() => setWorkType(wt)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition active:scale-95 ${
                      workType === wt ? "border-slate-950 bg-slate-950 font-black text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}>
                    {wt ? WORK_TYPE_LABELS[wt] : "미정 (직무지도원 입력)"}
                  </button>
                ))}
              </div>
            </div>

            {workType === "CUSTOM" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className={T.label}>근무 시작</label>
                  <input type="time" value={customStart} onChange={e => setCustomStart(e.target.value)} className={`w-full ${T.input}`} />
                </div>
                <div className="space-y-1.5">
                  <label className={T.label}>근무 종료</label>
                  <input type="time" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className={`w-full ${T.input}`} />
                </div>
              </div>
            )}

            {workType && workType !== "FULL_DAY" && (
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <input type="checkbox" checked={commuteGuide} onChange={e => setCommuteGuide(e.target.checked)}
                  className="h-4 w-4 accent-slate-950" />
                <span className="text-sm font-semibold text-slate-700">출퇴근 지도 포함 (+60분) — 기본: 포함</span>
              </label>
            )}
            {workType === "FULL_DAY" && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-600">
                전일 8시간 근무는 출퇴근/휴게 지도를 포함할 수 없습니다.
              </div>
            )}

            <div className="space-y-1.5">
              <label className={T.label}>관리자 메모 (선택)</label>
              <textarea value={adminMemo} onChange={e => setAdminMemo(e.target.value)}
                placeholder="내부 메모" rows={3}
                className={`w-full resize-none py-2 ${T.input} h-auto`} />
            </div>
          </div>

          {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => !saving && onClose()} disabled={saving} className={T.btnSecondary}>취소</button>
            <button onClick={handleCreate} disabled={saving} className={T.btnPrimary}>
              {saving ? "생성 중..." : "계약서 생성 및 발송"}
            </button>
          </div>
        </div>
      </div>

      {showSearch && (
        <WorkerSearchPopup onSelect={handleSelectWorker} onClose={() => setShowSearch(false)} />
      )}
    </>
  );
}

export default function AdminContractsPage() {
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [lastCreatedUrl, setLastCreatedUrl] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contracts
      .filter(c => statusFilter.length === 0 || statusFilter.includes(c.status))
      .filter(c => !q || c.workerName.toLowerCase().includes(q) || (c.userPhone ?? "").includes(q) || (c.siteName ?? "").toLowerCase().includes(q));
  }, [contracts, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  const statusCount = (s: string) => contracts.filter(c => c.status === s).length;
  const filters: FilterChip[] = [
    { value: "PENDING",   label: "서명 대기", count: statusCount("PENDING") },
    { value: "SIGNED",    label: "지도원 서명", count: statusCount("SIGNED") },
    { value: "COMPLETED", label: "완료",      count: statusCount("COMPLETED") },
    { value: "CANCELLED", label: "취소",      count: statusCount("CANCELLED") },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  useEffect(() => {
    fetch("/api/admin/contracts")
      .then(r => r.json())
      .then(c => { if (c.success) setContracts(c.items); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${baseUrl}/contract/${token}`).then(() => alert("링크가 복사되었습니다."));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="근로계약서 관리"
        sub="직무지도원 전자 근로계약서를 생성하고 발송·서명 상태를 관리합니다."
        actions={<button onClick={() => setShowCreate(true)} className={T.btnPrimary}>+ 계약서 생성</button>}
      />

      <StatCardRow
        cols={4}
        items={[
          { label: "전체", value: contracts.length },
          { label: "서명 대기", value: statusCount("PENDING"), tone: "amber" },
          { label: "계약 완료", value: statusCount("COMPLETED"), tone: "emerald" },
          { label: "취소", value: statusCount("CANCELLED"), tone: "slate" },
        ]}
      />

      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="직무지도원·전화번호·사업체 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
      />

      {lastCreatedUrl && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex-1">
            <p className="text-sm font-black text-emerald-700">계약서가 생성되었습니다</p>
            <p className="mt-0.5 break-all text-xs font-semibold text-slate-600">{lastCreatedUrl}</p>
          </div>
          <button onClick={() => { navigator.clipboard.writeText(lastCreatedUrl); alert("복사되었습니다."); }}
            className="whitespace-nowrap rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50">
            링크 복사
          </button>
        </div>
      )}

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead>
            <tr>{["직무지도원", "계약 기간", "사업체", "근무형태", "상태", "서명일", "링크"].map(h => (
              <th key={h} className={T.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className={T.tdCenter}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className={T.tdCenter}>{contracts.length === 0 ? "계약서가 없습니다." : "조건에 맞는 계약서가 없습니다."}</td></tr>
            ) : pageItems.map(c => (
                <tr key={c.id} className={T.trBase}>
                  <td className={T.td}>
                    <span className="font-semibold text-slate-800">{c.workerName}</span>
                    {c.userPhone && <span className="ml-1.5 text-[13px] text-slate-500">{c.userPhone}</span>}
                  </td>
                  <td className={`${T.td} whitespace-nowrap`}>
                    {c.contractStart?.slice(0, 10)} ~ {c.contractEnd?.slice(0, 10)}
                  </td>
                  <td className={`${T.td}`}>{c.siteName || <span className="text-slate-300">미지정</span>}</td>
                  <td className={`${T.td}`}>{c.workType ? (WORK_TYPE_LABELS[c.workType] ?? c.workType) : <span className="text-slate-300">미지정</span>}</td>
                  <td className={T.td}><StatusBadge status={c.status} map={CONTRACT_BADGE} /></td>
                  <td className={`${T.td}`}>{c.workerSignedAt ? c.workerSignedAt.slice(0, 10) : "-"}</td>
                  <td className={T.td}>
                    <button onClick={() => copyLink(c.signToken)} className={T.btnSecondary}>링크 복사</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {filtered.length > 0 && (
          <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
        )}
      </div>

      {showCreate && (
        <CreateContractModal
          onClose={() => setShowCreate(false)}
          onCreated={(_, url) => {
            setLastCreatedUrl(url);
            fetch("/api/admin/contracts").then(r => r.json()).then(d => { if (d.success) setContracts(d.items); });
          }}
        />
      )}
    </div>
  );
}
