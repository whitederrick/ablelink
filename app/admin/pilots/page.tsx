"use client";

// app/admin/pilots/page.tsx
// 파일럿 목록 + 생성 — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §8
//
// ★파일럿 = 실운영 전 소수 직무지도원 사용성 테스트. 회차 상태·초대·초기화는 이 단계에 없다.
// ★운영자 콘솔은 데스크톱 전제다(모바일 요약 화면은 별도 백로그).

import Link from "next/link";
import { useEffect, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";

type PilotRow = { id: string; name: string; note: string | null; createdAt: string; resourceCount: number };

export default function AdminPilotsPage() {
  const [rows, setRows] = useState<PilotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch("/api/admin/pilots", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.message || "목록을 불러오지 못했습니다.");
      setRows(d.pilots ?? []);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function create() {
    if (name.trim().length < 2 || agencyName.trim().length < 2) return;
    setSaving(true);
    try {
      const r = await fetch("/api/admin/pilots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), agencyName: agencyName.trim(), note: note.trim() }),
      });
      const d = await r.json();
      if (!r.ok || !d?.success) { alert(d?.message || "생성에 실패했습니다."); return; }
      setOpen(false); setName(""); setAgencyName(""); setNote("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="파일럿 설정"
        sub="실제 운영 전, 소수 직무지도원이 서비스를 직접 써 보게 하는 사용성 테스트입니다. 전용 기관·사업체·훈련생·계정을 새로 만들어 쓰고 종료 후 전부 삭제합니다."
      />

      <div className={T.card}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-black text-slate-900">파일럿 목록</h2>
          <button onClick={() => setOpen((v) => !v)} className={T.btnPrimary}>
            {open ? "취소" : "파일럿 만들기"}
          </button>
        </div>

        {open && (
          <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className={T.label}>파일럿 이름 <span className="text-rose-500">*</span></label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 2026-08 직무지도원 체험"
                  className={`w-full ${T.input}`} />
              </div>
              <div>
                <label className={T.label}>전용 기관명 <span className="text-rose-500">*</span></label>
                <input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="예: 파일럿 체험기관"
                  className={`w-full ${T.input}`} />
              </div>
            </div>
            <div className="mt-3">
              <label className={T.label}>메모 (선택)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="운영 메모"
                className={`w-full ${T.input}`} />
            </div>
            <p className="mt-3 text-xs font-semibold leading-relaxed text-slate-500">
              전용 기관이 <b>STANDARD</b> 등급으로 새로 만들어집니다. 급여는 PRO 전용 기능이라 열리지 않고,
              문서·PDF·서명만 사용할 수 있습니다. 위탁기관 담당자 계정·근로계약·급여기준은 만들지 않습니다.
              <br />
              <b className="text-slate-700">비밀번호 등 비밀정보는 메모에 적지 마세요.</b>
            </p>
            <div className="mt-4 flex justify-end">
              <button onClick={create} disabled={saving || name.trim().length < 2 || agencyName.trim().length < 2}
                className={T.btnPrimary}>
                {saving ? "만드는 중…" : "만들기"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm font-semibold text-slate-400">불러오는 중…</p>
        ) : loadError ? (
          <div className="py-8 text-center">
            <p className="text-sm font-semibold text-rose-600">{loadError}</p>
            <button onClick={() => void load()} className={`mt-3 ${T.btnSecondary}`}>다시 시도</button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm font-semibold text-slate-400">아직 만든 파일럿이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-black text-slate-500">
                  <th className="w-[280px] py-2.5 pr-3">파일럿</th>
                  <th className="w-[220px] py-2.5 pr-3">메모</th>
                  <th className="w-[110px] py-2.5 pr-3">등록 자원</th>
                  <th className="w-[130px] py-2.5 pr-3">생성일</th>
                  <th className="w-[100px] py-2.5">작업</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="truncate py-3 pr-3 font-black text-slate-900">{p.name}</td>
                    <td className="truncate py-3 pr-3 font-semibold text-slate-500">{p.note || "—"}</td>
                    <td className="py-3 pr-3 font-semibold text-slate-700">{p.resourceCount}건</td>
                    <td className="py-3 pr-3 font-semibold text-slate-500">
                      {new Date(p.createdAt).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="py-3">
                      <Link href={`/admin/pilots/${p.id}`} className={T.btnSecondary}>설정</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
