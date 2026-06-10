"use client";

// 직무지도 매칭 — 수요측(에이전시 매니저) 내 공고 목록
import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import { StatCardRow } from "../_components/StatCard";

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/recruit-posts");
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

  async function toggleStatus(p: Post) {
    const next = p.status === "OPEN" ? "CLOSED" : "OPEN";
    const r = await fetch(`/api/admin/recruit-posts/${p.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
    });
    if ((await r.json()).success) load();
  }

  return (
    <div>
      <PageHeader
        title="직무지도 공고"
        sub="직무지도원을 모집할 공고를 등록하고 신청자를 관리합니다."
        actions={<Link href="/admin/recruit/new" className={`${T.btnPrimary} no-underline`}>+ 새 공고</Link>}
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
          placeholder="공고·현장·에이전시·지역 검색"
          filters={[
            { value: "OPEN", label: "모집중", count: open },
            { value: "CLOSED", label: "마감", count: posts.length - open },
          ] as FilterChip[]}
          selected={statusFilter}
          onToggleFilter={(v)=>setStatusFilter(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v])}
        />
      </div>

      <div className={T.tableWrap}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={T.th}>공고</th>
              <th className={T.th}>출처(에이전시)</th>
              <th className={T.th}>직종</th>
              <th className={T.th}>지역</th>
              <th className={T.th}>모집</th>
              <th className={T.th}>신청</th>
              <th className={T.th}>상태</th>
              <th className={T.th}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className={T.empty}>불러오는 중…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className={T.empty}>{posts.length===0?"등록한 공고가 없습니다. ‘새 공고’로 등록해보세요.":"조건에 맞는 공고가 없습니다."}</td></tr>
            ) : (
              pageItems.map((p) => (
                <tr key={p.id} className={T.trBase}>
                  <td className={T.td}>
                    <Link href={`/admin/recruit/${p.id}`} className="font-semibold text-sky-600 hover:underline">{p.title}</Link>
                    <span className="ml-1.5 text-[13px] text-slate-500">{p.companyName}{p.taskName ? ` · ${p.taskName}` : ""}</span>
                  </td>
                  <td className={T.td}>
                    {p.agencyName
                      ? p.agencyName
                      : <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[13px] font-black text-emerald-600">Able-Link(운영자)</span>}
                  </td>
                  <td className={T.td}>{PROF_LABEL[p.profession] ?? p.profession}</td>
                  <td className={T.td}>{p.region ?? "-"}</td>
                  <td className={T.td}>{p.headcount}명</td>
                  <td className={T.td}>
                    <Link href={`/admin/recruit/${p.id}`} className="font-semibold text-sky-600 hover:underline">{p.applicationCount ?? 0}건</Link>
                  </td>
                  <td className={T.td}>
                    <span className={`${T.badge} ${p.status === "OPEN" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                      {p.status === "OPEN" ? "모집중" : "마감"}
                    </span>
                  </td>
                  <td className={T.td}>
                    <button onClick={() => toggleStatus(p)} className={T.btnSecondary}>{p.status === "OPEN" ? "마감" : "재개"}</button>
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
