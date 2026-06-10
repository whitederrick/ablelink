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
  id: string; profession: string; certNumber: string | null; certDocUrl: string | null; certifiedAt: string | null;
  experienceYears: number;
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
  const [detail, setDetail] = useState<Item | null>(null);

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
    if ((await r.json()).success) { setDetail(null); load(); }
    else alert("처리에 실패했습니다.");
  }
  const isImageDoc = (url: string) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);

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
                    {it.worker.name} <span className="text-[13px] text-slate-500">({it.worker.phoneNumber})</span>
                  </td>
                  <td className={T.td}>{PROF_LABEL[it.profession] ?? it.profession}</td>
                  <td className={T.td}>{it.certNumber || <span className="text-slate-400">미입력</span>}</td>
                  <td className={T.td}>{it.experienceYears}년</td>
                  <td className={T.td}>{it.createdAt.slice(0, 10)}</td>
                  <td className={T.td}>
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setDetail(it)} className={T.btnSecondary}>상세·증빙</button>
                      {it.verifyStatus === "PENDING" ? (
                        <>
                          <button onClick={() => decide(it.id, "reject")} className={T.btnSecondary}>반려</button>
                          <button onClick={() => decide(it.id, "approve")} className={T.btnPrimary}>승인</button>
                        </>
                      ) : (
                        <StatusBadge status={it.verifyStatus} map={PVERIFY_BADGE} />
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      </div>

      {/* 상세·증빙 검토 모달 */}
      {detail && (
        <div className={T.modalOverlay} onClick={() => setDetail(null)}>
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white p-7 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-900">{detail.worker.name} · {PROF_LABEL[detail.profession] ?? detail.profession}</h2>
                <p className="text-[13px] font-medium text-slate-500">{detail.worker.phoneNumber}{detail.worker.residenceAddress ? ` · ${detail.worker.residenceAddress}` : ""}</p>
              </div>
              <StatusBadge status={detail.verifyStatus} map={{ ...PVERIFY_BADGE, PENDING: { label: "검증 대기", tone: "amber" } }} />
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-[15px]">
                <div><span className="text-[13px] text-slate-400">직종</span><p className="font-semibold text-slate-800">{PROF_LABEL[detail.profession] ?? detail.profession}</p></div>
                <div><span className="text-[13px] text-slate-400">경력</span><p className="font-semibold text-slate-800">{detail.experienceYears}년</p></div>
                <div><span className="text-[13px] text-slate-400">자격번호</span><p className="font-semibold text-slate-800">{detail.certNumber || "미입력"}</p></div>
                <div><span className="text-[13px] text-slate-400">자격 취득일</span><p className="font-semibold text-slate-800">{detail.certifiedAt ? detail.certifiedAt.slice(0, 10) : "미입력"}</p></div>
                <div className="col-span-2"><span className="text-[13px] text-slate-400">신청일</span><p className="font-semibold text-slate-800">{detail.createdAt.slice(0, 10)}{detail.verifiedAt ? ` · 처리일 ${detail.verifiedAt.slice(0, 10)}` : ""}</p></div>
              </div>

              {detail.worker.bio && (
                <div>
                  <p className="mb-1 text-[13px] font-black text-slate-400">소개</p>
                  <p className="whitespace-pre-line text-[15px] font-medium text-slate-700">{detail.worker.bio}</p>
                </div>
              )}

              {/* 자격 증빙 */}
              <div>
                <p className="mb-1.5 text-[13px] font-black text-slate-400">자격 증빙 파일</p>
                {detail.certDocUrl ? (
                  isImageDoc(detail.certDocUrl) ? (
                    <a href={detail.certDocUrl} target="_blank" rel="noopener noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={detail.certDocUrl} alt="자격 증빙" className="max-h-[420px] w-full rounded-xl border border-slate-200 object-contain bg-slate-50" />
                      <span className="mt-1 inline-block text-[13px] font-semibold text-sky-600">새 창에서 원본 보기 ↗</span>
                    </a>
                  ) : (
                    <a href={detail.certDocUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 text-[15px] font-bold text-sky-700">
                      증빙 파일 열기 (PDF 등) ↗
                    </a>
                  )
                ) : (
                  <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-[14px] font-semibold text-amber-700">
                    ⚠ 제출된 증빙 파일이 없습니다. 자격번호·경력만으로 검증하거나, 신청자에게 증빙 제출을 요청하세요.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button onClick={() => setDetail(null)} className={T.btnSecondary}>닫기</button>
              {detail.verifyStatus !== "REJECTED" && <button onClick={() => decide(detail.id, "reject")} className={T.btnDanger}>반려</button>}
              {detail.verifyStatus !== "VERIFIED" && <button onClick={() => decide(detail.id, "approve")} className={T.btnPrimary}>승인</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
