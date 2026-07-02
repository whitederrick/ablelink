"use client";

// 직무지도 매칭 — 수요측(위탁기관 매니저) 내 공고 목록
import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import { StatCardRow } from "../_components/StatCard";
import RecruitDetailBody from "./RecruitDetailBody";

const PROF_LABEL: Record<string, string> = {
  JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사",
};
const PAGE_SIZE = 10;

interface Post {
  id: string; title: string; companyName: string; agencyName: string | null; profession: string;
  taskName: string | null; region: string | null; headcount: number;
  status: string; applicationCount?: number; createdAt: string;
}

export default function ManagerRecruitPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/recruit-posts", { headers: { "x-admin-context": "1" } });
      const d = await r.json();
      if (d.success) setPosts(d.posts);
      else if (r.status === 401) router.replace("/admin/login");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const open = posts.filter(p => p.status === "OPEN").length;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts
      .filter(p => statusFilter.length === 0 || statusFilter.includes(p.status))
      .filter(p => !q || p.title.toLowerCase().includes(q) || (p.companyName ?? "").toLowerCase().includes(q) || (p.agencyName ?? "").toLowerCase().includes(q) || (p.region ?? "").toLowerCase().includes(q));
  }, [posts, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  return (
    <div>
      <PageHeader
        title="직무지도 공고"
        sub="직무지도원을 모집할 공고를 등록하고 신청자를 관리합니다."
        actions={<Link href="/admin/recruit/new" className={`${T.btnPrimary} no-underline`}>+ 신규 공고 등록</Link>}
      />

      <StatCardRow
        className="mb-5"
        cols={3}
        items={[
          { label: "전체 공고", value: posts.length },
          { label: "모집중", value: open, tone: "emerald" },
          { label: "마감", value: posts.length - open, tone: "slate" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="공고·현장·위탁기관·지역 검색"
          filters={[
            { value: "OPEN", label: "모집중", count: open },
            { value: "CLOSED", label: "마감", count: posts.length - open },
          ] as FilterChip[]}
          selected={statusFilter}
          onToggleFilter={(v)=>setStatusFilter(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v])}
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1000px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[200px]" />{/* 공고명 */}
            <col className="w-[150px]" />{/* 현장(사업체) */}
            <col className="w-[150px]" />{/* 출처(위탁기관) */}
            <col className="w-[100px]" />{/* 직종 */}
            <col className="w-[110px]" />{/* 지역 */}
            <col className="w-[90px]" />{/* 모집 인원 */}
            <col className="w-[80px]" />{/* 신청 */}
            <col className="w-[90px]" />{/* 상태 */}
          </colgroup>
          <thead>
            <tr>{["공고명","현장(사업체)","출처(위탁기관)","직종","지역","모집 인원","신청","상태"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className={T.tdCenter}>불러오는 중…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className={T.tdCenter}>{posts.length===0?"등록한 공고가 없습니다. '신규 공고 등록'으로 등록해보세요.":"조건에 맞는 공고가 없습니다."}</td></tr>
            ) : pageItems.map((p) => (
              <tr key={p.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => setDetailId(p.id)}>
                <td className={`${T.td} truncate`}><span className="font-bold text-sky-600">{p.title}</span></td>
                <td className={`${T.td} truncate`}>{p.companyName}{p.taskName ? ` · ${p.taskName}` : ""}</td>
                <td className={`${T.td} truncate`}>
                  {p.agencyName
                    ? p.agencyName
                    : <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[13px] font-black text-emerald-600">Able-Link(시스템 관리자)</span>}
                </td>
                <td className={T.td}>{PROF_LABEL[p.profession] ?? p.profession}</td>
                <td className={`${T.td} truncate`}>{p.region ?? "-"}</td>
                <td className={T.td}>{p.headcount}명</td>
                <td className={T.td}>{p.applicationCount ?? 0}건</td>
                <td className={T.td}>
                  <span className={`${T.badge} ${p.status === "OPEN" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                    {p.status === "OPEN" ? "모집중" : "마감"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <Pagination className="pt-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      )}

      {/* 공고 상세 모달 — 신청자 + 마감 처리 */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5" onClick={() => setDetailId(null)}>
          <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <RecruitDetailBody key={detailId} id={detailId} onChanged={load} />
            <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
              <button onClick={() => setDetailId(null)} className={T.btnSecondary}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
