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
import type { Post } from "./types";
import RecruitPostDetailModal from "./RecruitPostDetailModal";
import RecruitApplicantsModal from "./RecruitApplicantsModal";

const PROF_LABEL: Record<string, string> = {
  JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사",
};
const PAGE_SIZE = 20;

export default function ManagerRecruitPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [detailPost, setDetailPost] = useState<Post | null>(null);   // 행 클릭 → 공고 상세 모달
  const [applicantsPost, setApplicantsPost] = useState<Post | null>(null); // 신청 건수 클릭 → 지원자 현황 모달

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/recruit-posts");
      const d = await r.json();
      if (d.success) setPosts(d.posts);
      else if (r.status === 401) router.replace("/manager/login");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const open = posts.filter(p => p.status === "OPEN").length;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts
      .filter(p => statusFilter.length === 0 || statusFilter.includes(p.status))
      .filter(p => !q || p.title.toLowerCase().includes(q) || (p.companyName ?? "").toLowerCase().includes(q) || (p.region ?? "").toLowerCase().includes(q));
  }, [posts, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  async function toggleStatus(p: Post) {
    const next = p.status === "OPEN" ? "CLOSED" : "OPEN";
    const r = await fetch(`/api/admin/recruit-posts/${p.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
    });
    if ((await r.json()).success) {
      setPosts(prev => prev.map(x => x.id === p.id ? { ...x, status: next } : x));
      setDetailPost(prev => prev && prev.id === p.id ? { ...prev, status: next } : prev);
      load();
    }
  }

  return (
    <div>
      <PageHeader
        title="직무지도 모집 공고 (Pro+)"
        sub="직무지도원을 모집할 공고를 등록하고 신청자를 관리합니다."
        actions={<Link href="/manager/recruit/new" className={`${T.btnPrimary} no-underline`}>+ 새 공고</Link>}
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
          placeholder="공고·현장·지역 검색"
          filters={[
            { value: "OPEN", label: "모집중", count: open },
            { value: "CLOSED", label: "마감", count: posts.length - open },
          ] as FilterChip[]}
          selected={statusFilter}
          onToggleFilter={(v)=>setStatusFilter(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v])}
        />
      </div>

      <p className="mb-2 text-xs font-semibold text-slate-400">공고 행을 클릭하면 등록 정보 상세가, ‘신청’ 건수를 클릭하면 지원자 현황이 모달로 열립니다.</p>
      <div className={T.tableWrap}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={T.th}>공고</th>
              <th className={T.th}>사업체</th>
              <th className={T.th}>과제(사업명)</th>
              <th className={T.th}>직종</th>
              <th className={T.th}>지역</th>
              <th className={T.th}>모집</th>
              <th className={T.th}>신청</th>
              <th className={T.th}>상태</th>
              <th className={T.th}>마감 처리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className={T.empty}>불러오는 중…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className={T.empty}>{posts.length===0?"등록한 공고가 없습니다. ‘새 공고’로 등록해보세요.":"조건에 맞는 공고가 없습니다."}</td></tr>
            ) : (
              pageItems.map((p) => (
                <tr key={p.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => setDetailPost(p)}>
                  <td className={T.td}>
                    <div className="max-w-[260px] truncate font-bold text-slate-900">{p.title}</div>
                  </td>
                  <td className={T.td}><div className="max-w-[160px] truncate">{p.companyName || "-"}</div></td>
                  <td className={T.td}><div className="max-w-[160px] truncate text-slate-500">{p.taskName || "-"}</div></td>
                  <td className={T.td}>{PROF_LABEL[p.profession] ?? p.profession}</td>
                  <td className={T.td}><div className="max-w-[120px] truncate">{p.region ?? "-"}</div></td>
                  <td className={T.td}>{p.headcount}명</td>
                  <td className={T.td}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setApplicantsPost(p); }}
                      className="font-black text-sky-600 hover:underline"
                    >{p.applicationCount ?? 0}건</button>
                  </td>
                  <td className={T.td}>
                    <span className={`${T.badge} ${p.status === "OPEN" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                      {p.status === "OPEN" ? "모집중" : "마감"}
                    </span>
                  </td>
                  <td className={T.td}>
                    <button onClick={(e) => { e.stopPropagation(); toggleStatus(p); }} className={T.btnSecondary}>{p.status === "OPEN" ? "마감" : "재개"}</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      </div>

      {detailPost && (
        <RecruitPostDetailModal
          post={detailPost}
          onClose={() => setDetailPost(null)}
          onToggleStatus={() => toggleStatus(detailPost)}
          onViewApplicants={() => { setApplicantsPost(detailPost); setDetailPost(null); }}
        />
      )}
      {applicantsPost && (
        <RecruitApplicantsModal
          postId={applicantsPost.id}
          postTitle={applicantsPost.title}
          onClose={() => setApplicantsPost(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
