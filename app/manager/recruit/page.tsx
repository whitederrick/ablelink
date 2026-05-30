"use client";

// 직무지도 매칭 — 수요측(에이전시 매니저) 내 공고 목록
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { T } from "../_styles";

const PROF_LABEL: Record<string, string> = {
  JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사",
};

interface Post {
  id: string; title: string; companyName: string; profession: string;
  taskName: string | null; region: string | null; headcount: number;
  status: string; applicationCount?: number; createdAt: string;
}

export default function ManagerRecruitPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

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

  async function toggleStatus(p: Post) {
    const next = p.status === "OPEN" ? "CLOSED" : "OPEN";
    const r = await fetch(`/api/admin/recruit-posts/${p.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
    });
    if ((await r.json()).success) load();
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className={T.pageTitle}>직무지도 모집 공고</h1>
          <p className={T.pageSub}>직무지도원을 모집할 공고를 등록하고 신청자를 관리합니다.</p>
        </div>
        <Link href="/manager/recruit/new" className={T.btnPrimary}>+ 새 공고</Link>
      </div>

      <div className={T.tableWrap}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={T.th}>공고</th>
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
              <tr><td colSpan={7} className={T.empty}>불러오는 중…</td></tr>
            ) : posts.length === 0 ? (
              <tr><td colSpan={7} className={T.empty}>등록한 공고가 없습니다. ‘새 공고’로 등록해보세요.</td></tr>
            ) : (
              posts.map((p) => (
                <tr key={p.id} className={T.trBase}>
                  <td className={T.td}>
                    <Link href={`/manager/recruit/${p.id}`} className="font-bold text-slate-900 hover:text-sky-600">{p.title}</Link>
                    <div className="text-xs text-slate-400">{p.companyName}{p.taskName ? ` · ${p.taskName}` : ""}</div>
                  </td>
                  <td className={T.td}>{PROF_LABEL[p.profession] ?? p.profession}</td>
                  <td className={T.td}>{p.region ?? "-"}</td>
                  <td className={T.td}>{p.headcount}명</td>
                  <td className={T.td}>
                    <Link href={`/manager/recruit/${p.id}`} className="font-black text-sky-600 hover:underline">{p.applicationCount ?? 0}건</Link>
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
      </div>
    </div>
  );
}
