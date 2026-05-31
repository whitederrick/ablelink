"use client";

// 시스템 운영자 — 직종 자격 증빙 검증 (승인/반려)
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "../_styles";

const PROF_LABEL: Record<string, string> = { JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사" };
const TABS = [
  { value: "PENDING", label: "검증 대기" },
  { value: "VERIFIED", label: "승인" },
  { value: "REJECTED", label: "반려" },
];

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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ status });
      if (q.trim()) sp.set("q", q.trim());
      const r = await fetch(`/api/admin/profession-verifications?${sp}`);
      const d = await r.json();
      if (d.success) { setItems(d.items); setCounts(d.counts); }
      else if (r.status === 401) router.replace("/admin/login");
    } finally { setLoading(false); }
  }, [status, q, router]);

  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(id: string, action: "approve" | "reject") {
    const r = await fetch(`/api/admin/profession-verifications/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    });
    if ((await r.json()).success) load();
    else alert("처리에 실패했습니다.");
  }

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className={T.pageTitle}>직종 자격 검증</h1>
        <p className={T.pageSub}>마켓플레이스 인력의 직무지도원·요양보호사·활동지원사 자격 증빙을 검증합니다.</p>
      </div>

      {/* 상태 탭 */}
      <div className="mb-4 flex items-center gap-2">
        {TABS.map((t) => (
          <button key={t.value} onClick={() => setStatus(t.value)}
            className={`rounded-xl px-3.5 py-2 text-sm font-black transition ${status === t.value ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-500"}`}>
            {t.label} <span className={status === t.value ? "text-white/70" : "text-slate-400"}>{counts[t.value] ?? 0}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="이름·전화 검색" className={T.input} />
          <button onClick={load} className={T.btnSecondary}>검색</button>
        </div>
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
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className={T.empty}>해당 상태의 자격 신청이 없습니다.</td></tr>
            ) : (
              items.map((it) => (
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
                      <span className={`${T.badge} ${it.verifyStatus === "VERIFIED" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>
                        {it.verifyStatus === "VERIFIED" ? "승인됨" : "반려됨"}
                      </span>
                    )}
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
