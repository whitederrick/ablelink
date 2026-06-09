"use client";

import { Fragment, useEffect, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";

type Status = "PENDING" | "RESPONDED" | "EXPIRED" | "CANCELLED";
interface Survey {
  id: string; agencyName: string; workerName: string;
  recipientName: string | null; recipientPhone: string; siteName: string | null;
  status: Status; auto: boolean;
  scores: Record<string, number> | null; overallScore: number | null; comment: string | null;
  sharedWithAgency: boolean; sentAt: string | null; respondedAt: string | null; createdAt: string;
}

const STATUS_CLS: Record<Status, { label: string; cls: string }> = {
  PENDING:   { label: "응답 대기", cls: "bg-amber-50 text-amber-600" },
  RESPONDED: { label: "응답 완료", cls: "bg-emerald-50 text-emerald-600" },
  EXPIRED:   { label: "만료",      cls: "bg-slate-100 text-slate-500" },
  CANCELLED: { label: "취소",      cls: "bg-slate-100 text-slate-500" },
};
const SCORE_LABELS: Record<string, string> = {
  professionalism: "전문성", diligence: "성실성", communication: "의사소통", support: "지원 적절성",
};

export default function AdminSurveysPage() {
  const [items, setItems] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  function load() { fetch("/api/admin/system/surveys").then(r => r.json()).then(d => { if (d.success) setItems(d.items); }).catch(() => {}).finally(() => setLoading(false)); }
  useEffect(() => { load(); }, []);

  async function toggleShare(s: Survey) {
    await fetch("/api/admin/system/surveys", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, sharedWithAgency: !s.sharedWithAgency }) });
    load();
  }

  const responded = items.filter(i => i.status === "RESPONDED");
  const avgOverall = responded.length ? (responded.reduce((a, b) => a + (b.overallScore || 0), 0) / responded.length).toFixed(1) : "-";

  return (
    <div className="space-y-5">
      <PageHeader title="만족도 조사 결과" sub="모든 에이전시의 직무지도원 만족도 조사 결과를 조회하고, 에이전시에 전달할 수 있습니다." />

      <div className="grid grid-cols-3 gap-3">
        <div className={T.summaryCard}><p className={`${T.summaryNum} text-slate-900`}>{items.length}</p><p className={T.summaryLabel}>전체 조사</p></div>
        <div className={T.summaryCard}><p className={`${T.summaryNum} text-emerald-600`}>{responded.length}</p><p className={T.summaryLabel}>응답 완료</p></div>
        <div className={T.summaryCard}><p className={`${T.summaryNum} text-amber-500`}>{avgOverall}</p><p className={T.summaryLabel}>평균 종합 만족도 (/5)</p></div>
      </div>

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead><tr>{["에이전시", "직무지도원", "사업체/담당자", "상태", "종합", "전달", "응답일"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className={T.tdCenter}>로딩 중...</td></tr>
            : items.length === 0 ? <tr><td colSpan={7} className={T.tdCenter}>조사 결과가 없습니다.</td></tr>
            : items.map(s => {
              const st = STATUS_CLS[s.status];
              const open = openId === s.id;
              return (
                <Fragment key={s.id}>
                  <tr className={`${T.trBase} cursor-pointer`} onClick={() => setOpenId(open ? null : s.id)}>
                    <td className={`${T.td} font-semibold text-slate-700`}>{s.agencyName}</td>
                    <td className={`${T.td} font-black text-slate-900`}>{s.workerName}</td>
                    <td className={T.td}><div className="text-slate-700">{s.siteName || "-"}</div><div className="text-xs text-slate-400">{s.recipientName || ""} {s.recipientPhone}</div></td>
                    <td className={T.td}><span className={`${T.badge} ${st.cls}`}>{st.label}</span>{s.auto && <span className="ml-1 text-[10px] text-slate-400">자동</span>}</td>
                    <td className={`${T.td} font-black ${s.overallScore ? "text-slate-800" : "text-slate-300"}`}>{s.overallScore ? `${s.overallScore}/5` : "-"}</td>
                    <td className={T.td}>{s.status === "RESPONDED" && (
                      <button onClick={(e) => { e.stopPropagation(); toggleShare(s); }} className={`rounded-lg px-2.5 py-1 text-xs font-bold ${s.sharedWithAgency ? "bg-emerald-50 text-emerald-600" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{s.sharedWithAgency ? "전달됨 ✓" : "전달하기"}</button>
                    )}</td>
                    <td className={`${T.td} text-xs text-slate-400`}>{s.respondedAt ? s.respondedAt.slice(0, 10) : "-"}</td>
                  </tr>
                  {open && s.status === "RESPONDED" && (
                    <tr><td colSpan={7} className="bg-slate-50 px-5 py-4">
                      <div className="flex flex-wrap gap-4">
                        {s.scores && Object.entries(s.scores).map(([k, v]) => (
                          <div key={k} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center"><p className="text-[11px] font-semibold text-slate-400">{SCORE_LABELS[k] || k}</p><p className="text-lg font-black text-slate-800">{v}<span className="text-xs text-slate-400">/5</span></p></div>
                        ))}
                      </div>
                      {s.comment && <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3"><p className="text-[11px] font-semibold text-slate-400">의견</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{s.comment}</p></div>}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
