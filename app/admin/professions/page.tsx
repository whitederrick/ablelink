"use client";

// 시스템 운영자 — 직종 자격 증빙 검증 (승인/반려)
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

const PROF_LABEL: Record<string, string> = { JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사" };
const PVERIFY_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  VERIFIED: { label: "승인됨", tone: "emerald" },
  REJECTED: { label: "반려됨", tone: "rose" },
};
const PAGE_SIZE = 15;

interface Item {
  id: string; profession: string; certNumber: string | null; experienceYears: number;
  verifyStatus: string; createdAt: string; verifiedAt: string | null;
  worker: { id: string; name: string; phoneNumber: string; residenceAddress: string | null; bio: string | null };
}

export default function AdminProfessionsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({ PENDING: 0, VERIFIED: 0, REJECTED: 0 });
  const [status, setStatus] = useState("PENDING");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/profession-verifications?status=${status}`);
      const d = await r.json();
      if (d.success) { setItems(d.items); setCounts(d.counts); }
      else if (r.status === 401) router.replace("/admin/login");
    } finally { setLoading(false); }
  }, [status, router]);

  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter(it => !query || it.worker.name.toLowerCase().includes(query) || (it.worker.phoneNumber ?? "").includes(query));
  }, [items, q]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [q, status]);

  async function decide(id: string, action: "approve" | "reject") {
    const r = await fetch(`/api/admin/profession-verifications/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    });
    if ((await r.json()).success) load();
    else alert("처리에 실패했습니다.");
  }

  return (
    <div>
      <PageHeader
        title="자격 검증"
        sub="마켓플레이스 인력의 직무지도원·요양보호사·활동지원사 자격 증빙을 검증합니다."
      />

      <StatCardRow
        className="mb-5"
        cols={3}
        items={[
          { label: "검증 대기", value: counts.PENDING ?? 0, tone: "amber" },
          { label: "승인", value: counts.VERIFIED ?? 0, tone: "emerald" },
          { label: "반려", value: counts.REJECTED ?? 0, tone: "rose" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={q}
          onQueryChange={setQ}
          placeholder="이름·전화 검색"
          filters={[
            { value: "PENDING", label: "검증 대기", count: counts.PENDING ?? 0 },
            { value: "VERIFIED", label: "승인", count: counts.VERIFIED ?? 0 },
            { value: "REJECTED", label: "반려", count: counts.REJECTED ?? 0 },
          ] as FilterChip[]}
          selected={[status]}
          multi={false}
          onToggleFilter={(v) => setStatus(v)}
        />
      </div>

      <div className={T.tableWrap}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={T.th}>신청자</th>
              <th className={T.th}>직종</th>
              <th className={T.th}>자격번호</th>
              <th className={T.th}>경력</th>
              <th className={T.th}>신청일</th>
              <th className={T.th}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className={T.empty}>불러오는 중…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className={T.empty}>해당 상태의 자격 신청이 없습니다.</td></tr>
            ) : (
              pageItems.map((it) => (
                <tr key={it.id} className={T.trBase}>
                  <td className={T.td}>
                    <p className="font-bold text-slate-900">{it.worker.name}</p>
                    <p className="text-xs text-slate-400">{it.worker.phoneNumber}{it.worker.residenceAddress ? ` · ${it.worker.residenceAddress}` : ""}</p>
                  </td>
                  <td className={T.td}>{PROF_LABEL[it.profession] ?? it.profession}</td>
                  <td className={T.td}>{it.certNumber || <span className="text-slate-300">미입력</span>}</td>
                  <td className={T.td}>{it.experienceYears}년</td>
                  <td className={T.td}>{it.createdAt.slice(0, 10)}</td>
                  <td className={T.td}>
                    {it.verifyStatus === "PENDING" ? (
                      <div className="flex gap-2">
                        <button onClick={() => decide(it.id, "reject")} className={T.btnSecondary}>반려</button>
                        <button onClick={() => decide(it.id, "approve")} className={T.btnPrimary}>승인</button>
                      </div>
                    ) : (
                      <StatusBadge status={it.verifyStatus} map={PVERIFY_BADGE} />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      </div>
    </div>
  );
}
