"use client";

// 파일럿 관리 — 회차 목록·생성.
// 상세 셋업은 /admin/pilots/[id]에서 단계별 카드로 처리한다(별도 위저드를 만들지 않는다).

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "../_components/PageHeader";
import { T } from "../_styles";
import ListToolbar from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import { PILOT_STATUS } from "./_constants";

const PAGE_SIZE = 10;

type PilotItem = {
  id: string; status: string; startDate: string; endDate: string;
  managerDisplayName: string | null;
  agencyId: string; agencyName: string;
  participantCount: number;
};

type AgencyOption = { id: string; name: string };

export default function PilotsPage() {
  const router = useRouter();
  const [items, setItems] = useState<PilotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openNew, setOpenNew] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setLoadErr("");
    try {
      const res = await fetch("/api/admin/pilots", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      // ★실패를 삼키면 빈 화면이 "회차 없음"으로 보인다 — 원인을 표시한다.
      if (!data?.success) { setLoadErr(data?.message || "목록을 불러오지 못했습니다."); return; }
      setItems(data.items ?? []);
    } catch {
      setLoadErr("서버에 연결하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (i) => i.agencyName.toLowerCase().includes(query) || (i.managerDisplayName ?? "").toLowerCase().includes(query),
    );
  }, [items, q]);

  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <PageHeader
        title="파일럿 관리"
        sub="직무지도원 문서 파일럿 회차를 만들고 참여 환경을 설정합니다."
        actions={
          <button type="button" onClick={() => setOpenNew(true)} className={T.btnPrimary}>
            회차 만들기
          </button>
        }
      />

      {loadErr && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3">
          <p className="text-sm font-bold text-rose-600">{loadErr}</p>
          <button type="button" onClick={() => void load()} className={T.btnSecondary}>다시 시도</button>
        </div>
      )}

      <ListToolbar query={q} onQueryChange={(v) => { setQ(v); setPage(1); }} placeholder="위탁기관명·담당자 검색" />

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-[80px]" />
            <col className="w-[200px]" />
            <col className="w-[110px]" />
            <col className="w-[200px]" />
            <col className="w-[150px]" />
            <col className="w-[100px]" />
          </colgroup>
          <thead>
            <tr>{["회차", "위탁기관", "상태", "기간", "위탁기관 담당자", "참여자"].map((h) => (
              <th key={h} className={T.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className={T.tdCenter}>불러오는 중…</td></tr>
            ) : pageItems.length === 0 ? (
              <tr><td colSpan={6} className={T.tdCenter}>
                {items.length === 0 ? "아직 만든 파일럿 회차가 없습니다." : "조건에 맞는 회차가 없습니다."}
              </td></tr>
            ) : pageItems.map((it) => {
              const s = PILOT_STATUS[it.status] ?? { label: it.status, cls: "bg-slate-100 text-slate-600" };
              return (
                <tr
                  key={it.id}
                  onClick={() => router.push(`/admin/pilots/${it.id}`)}
                  className={`${T.trBase} cursor-pointer hover:bg-slate-50`}
                >
                  <td className={`${T.td} truncate text-slate-400`}>{it.id}</td>
                  <td className={`${T.td} truncate`}><span className="font-bold text-sky-600">{it.agencyName}</span></td>
                  <td className={T.td}>
                    <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-bold ${s.cls}`}>{s.label}</span>
                  </td>
                  <td className={`${T.td} truncate`}>{it.startDate} ~ {it.endDate}</td>
                  <td className={`${T.td} truncate`}>
                    {it.managerDisplayName || <span className="text-slate-400">미입력(수기)</span>}
                  </td>
                  <td className={T.td}>{it.participantCount}명</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))} total={filtered.length} onPageChange={setPage} />

      {openNew && (
        <NewPilotModal
          onClose={() => setOpenNew(false)}
          onCreated={(id) => { setOpenNew(false); router.push(`/admin/pilots/${id}`); }}
        />
      )}
    </div>
  );
}

// ── 회차 생성 모달 ────────────────────────────────────────────────
function NewPilotModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [agencies, setAgencies] = useState<AgencyOption[]>([]);
  const [agencyId, setAgencyId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [managerDisplayName, setManagerDisplayName] = useState("");
  const [err, setErr] = useState("");
  const [agencyErr, setAgencyErr] = useState("");
  const [saving, setSaving] = useState(false);

  const loadAgencies = useCallback(async () => {
    setAgencyErr("");
    try {
      // ★목록 API가 아니라 선택지 전용 경량 경로를 쓴다(플랜·결제·카운트를 받지 않는다).
      const res = await fetch("/api/admin/pilots/options?kind=agencies", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) { setAgencyErr(data?.message || "위탁기관 목록을 불러오지 못했습니다."); return; }
      setAgencies(data.agencies ?? []);
    } catch {
      // ★네트워크 예외도 잡는다 — 예전에는 catch가 없어 목록이 조용히 비었다.
      setAgencyErr("위탁기관 목록을 불러오지 못했습니다. 연결을 확인해주세요.");
    }
  }, []);

  useEffect(() => { void loadAgencies(); }, [loadAgencies]);

  async function submit() {
    setErr(""); setSaving(true);
    try {
      const res = await fetch("/api/admin/pilots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agencyId, startDate, endDate, managerDisplayName }),
      });
      const data = await res.json().catch(() => ({}));
      // ★서버가 준 사유를 그대로 사람 말로 보여준다(400/409를 삼키지 않는다).
      if (!data?.success) { setErr(data?.message || "회차를 만들지 못했습니다."); return; }
      onCreated(String(data.id));
    } catch {
      setErr("서버에 연결하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-black text-slate-900">파일럿 회차 만들기</h2>
        <p className="mt-1 text-[13px] font-semibold text-slate-500">
          실재 위탁기관을 지정합니다. 회차를 만든 뒤에는 위탁기관을 바꿀 수 없습니다.
        </p>

        <div className="mt-4 space-y-3">
          <Field label="위탁기관">
            {agencyErr ? (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-rose-50 px-3 py-2">
                <span className="text-[13px] font-bold text-rose-600">{agencyErr}</span>
                <button type="button" onClick={() => void loadAgencies()} className={T.btnSecondary}>다시 시도</button>
              </div>
            ) : (
              <select value={agencyId} onChange={(e) => setAgencyId(e.target.value)} className={T.input}>
                <option value="">선택하세요</option>
                {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="시작일">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={T.input} />
            </Field>
            <Field label="종료일">
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={T.input} />
            </Field>
          </div>
          <Field label="위탁기관 담당자 표시명 (선택)">
            <input
              value={managerDisplayName}
              onChange={(e) => setManagerDisplayName(e.target.value)}
              placeholder="모르면 비워두세요 — PDF에 수기 기입 공간이 나옵니다"
              className={T.input}
            />
          </Field>
        </div>

        {err && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{err}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={T.btnSecondary}>취소</button>
          <button type="button" onClick={submit} disabled={saving || !agencyId || !startDate || !endDate} className={T.btnPrimary}>
            {saving ? "만드는 중…" : "만들기"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[13px] font-bold text-slate-600">{label}</label>
      {children}
    </div>
  );
}
