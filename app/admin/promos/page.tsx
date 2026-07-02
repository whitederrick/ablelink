"use client";

// app/admin/promos/page.tsx
// 시스템 관리자: 대시보드 소식 티커·광고 관리(생성/수정/활성토글/게시기간/삭제) + 티커 속도 조절.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import AdSlot from "@/components/AdSlot";

// 입력 필드 — 라벨(굵게) + 설명(회색) + 입력을 세로 정렬로 통일.
function Field({ label, desc, children, className = "" }: { label: string; desc?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline gap-1.5">
        <label className="whitespace-nowrap text-sm font-bold text-slate-700">{label}</label>
        {desc && <span className="truncate text-[11px] font-medium text-slate-400">{desc}</span>}
      </div>
      {children}
    </div>
  );
}

type Kind = "TICKER" | "AD";
type AdLayout = "TEXT" | "IMAGE" | "OVERLAY" | "TITLE";
type Promo = {
  id: string; kind: Kind; badge: string | null; title: string; body: string | null;
  imageUrl: string | null; layout: AdLayout; textColor: "LIGHT" | "DARK"; href: string | null; isActive: boolean;
  startAt: string | null; endAt: string | null; note: string | null; sortOrder: number;
};
// 대시보드 광고 카드 폭(~336px) 기준 글자수 제한 — 넘치면 잘려 어색해지므로 입력에서 제한.
const TITLE_MAX = 28;
const DESC_MAX = 60;
const LAYOUTS: { v: AdLayout; label: string; desc: string }[] = [
  { v: "TEXT", label: "텍스트형", desc: "이미지 없이 배지·제목·설명" },
  { v: "IMAGE", label: "이미지만", desc: "이미지 전체(텍스트 없음)" },
  { v: "OVERLAY", label: "이미지+제목·설명", desc: "이미지 배경 위 텍스트" },
  { v: "TITLE", label: "이미지+제목만", desc: "이미지 배경 위 제목만" },
];

const KIND_LABEL: Record<Kind, string> = { TICKER: "소식 티커", AD: "광고" };
const emptyDraft = (kind: Kind): Partial<Promo> => ({ kind, badge: "", title: "", body: "", imageUrl: "", layout: "OVERLAY", textColor: "LIGHT", href: "", isActive: true, startAt: null, endAt: null, note: "", sortOrder: 0 });

function toDateInput(iso: string | null): string { return iso ? iso.slice(0, 10) : ""; }
function fmtPeriod(s: string | null, e: string | null): string {
  if (!s && !e) return "상시";
  return `${s ? s.slice(0, 10) : "~"} ~ ${e ? e.slice(0, 10) : "~"}`;
}

export default function AdminPromosPage() {
  const [items, setItems] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; draft: Partial<Promo> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [speed, setSpeed] = useState("32");
  const [speedSaving, setSpeedSaving] = useState(false);
  const [imgMode, setImgMode] = useState<"file" | "url">("file");
  const [uploading, setUploading] = useState(false);

  // 모달 열릴 때 이미지 입력 방식 초기화(기존 URL 있으면 URL, 없으면 파일)
  useEffect(() => { if (modal) setImgMode(modal.draft.imageUrl ? "url" : "file"); }, [modal?.mode, modal?.draft.id]);

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const d = await fetch("/api/admin/system/promos/upload", { method: "POST", body: fd }).then(r => r.json());
      if (d.success) { setModal(m => m ? { ...m, draft: { ...m.draft, imageUrl: d.url } } : m); showToast("이미지 업로드 완료"); }
      else showToast(d.message ?? "업로드 실패");
    } catch { showToast("업로드 오류"); } finally { setUploading(false); }
  }

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  function load() {
    setLoading(true);
    fetch("/api/admin/system/promos").then(r => r.json()).then(d => { if (d.success) setItems(d.data); }).finally(() => setLoading(false));
    fetch("/api/admin/system/config").then(r => r.json()).then(d => {
      if (d.success) { const c = d.items.find((x: any) => x.key === "DASHBOARD_TICKER_DURATION_SEC"); if (c) setSpeed(String(c.value)); }
    }).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => items.filter(i => i.kind === "AD"), [items]);

  async function saveSpeed() {
    setSpeedSaving(true);
    try {
      const d = await fetch("/api/admin/system/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "DASHBOARD_TICKER_DURATION_SEC", value: speed }) }).then(r => r.json());
      showToast(d.success ? "티커 속도 저장됨" : (d.message || "저장 실패"));
    } finally { setSpeedSaving(false); }
  }

  async function toggleActive(p: Promo) {
    const d = await fetch(`/api/admin/system/promos/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !p.isActive }) }).then(r => r.json());
    if (d.success) load(); else showToast(d.message || "실패");
  }

  async function submit() {
    if (!modal) return;
    const dr = modal.draft;
    if (!dr.title?.trim()) { showToast("제목(문구)을 입력하세요."); return; }
    setSaving(true);
    // 게시기간: 날짜 입력(YYYY-MM-DD) → KST 경계 ISO
    const startAt = dr.startAt ? `${dr.startAt.slice(0, 10)}T00:00:00+09:00` : null;
    const endAt = dr.endAt ? `${dr.endAt.slice(0, 10)}T23:59:59+09:00` : null;
    const payload = { ...dr, startAt, endAt };
    try {
      const url = modal.mode === "create" ? "/api/admin/system/promos" : `/api/admin/system/promos/${dr.id}`;
      const method = modal.mode === "create" ? "POST" : "PATCH";
      const d = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(r => r.json());
      if (d.success) { setModal(null); load(); showToast("저장되었습니다."); } else showToast(d.message || "저장 실패");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!modal?.draft.id) return;
    if (!confirm("이 항목을 삭제할까요?")) return;
    const d = await fetch(`/api/admin/system/promos/${modal.draft.id}`, { method: "DELETE" }).then(r => r.json());
    if (d.success) { setModal(null); load(); showToast("삭제되었습니다."); } else showToast(d.message || "삭제 실패");
  }

  const setField = (k: keyof Promo, v: any) => setModal(m => m ? { ...m, draft: { ...m.draft, [k]: v } } : m);

  return (
    <div className="space-y-5">
      <PageHeader title="대시보드 광고" sub="위탁기관 대시보드 하단 광고를 관리합니다. (상단 소식 티커는 '시스템 공지'에서 '티커 노출'로 관리)" />

      {/* 티커 속도 */}
      <div className={`${T.card} flex flex-wrap items-center gap-3`}>
        <span className="text-sm font-black text-slate-700">티커 속도(초/바퀴)</span>
        <input type="number" min={8} max={120} value={speed} onChange={e => setSpeed(e.target.value)} className={`w-24 ${T.input}`} />
        <span className="text-xs font-semibold text-slate-400">작을수록 빠름 (권장 24~40)</span>
        <button onClick={saveSpeed} disabled={speedSaving} className={T.btnSecondary}>{speedSaving ? "저장 중..." : "속도 저장"}</button>
      </div>

      {/* 생성 */}
      <div className="flex items-center justify-end">
        <button onClick={() => setModal({ mode: "create", draft: emptyDraft("AD") })} className={T.btnPrimary}>+ 광고 추가</button>
      </div>

      {/* 목록 */}
      <div className={T.tableWrap}>
        <table className="w-full">
          <thead><tr>{["배지", "제목", "게시 기간", "순서", "상태"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className={T.tdCenter}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className={T.tdCenter}>등록된 광고가 없습니다.</td></tr>
            ) : filtered.map(p => (
              <tr key={p.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => setModal({ mode: "edit", draft: { ...p, startAt: toDateInput(p.startAt), endAt: toDateInput(p.endAt) } })}>
                <td className={T.td}>{p.badge || <span className="text-slate-300">-</span>}</td>
                <td className={T.td}><div className="max-w-[360px] truncate font-semibold text-slate-800">{p.title}</div></td>
                <td className={`${T.td} whitespace-nowrap text-slate-500`}>{fmtPeriod(p.startAt, p.endAt)}</td>
                <td className={T.td}>{p.sortOrder}</td>
                <td className={T.td}>
                  <button onClick={e => { e.stopPropagation(); toggleActive(p); }}
                    className={`${T.badge} ${p.isActive ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                    {p.isActive ? "게시중" : "숨김"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 생성/수정 모달 */}
      {modal && (
        <div className={T.modalOverlay} onClick={() => setModal(null)}>
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-black text-slate-900">{modal.mode === "create" ? "새 광고 등록" : "광고 수정"}</h2>
            <p className="mb-4 text-[13px] font-semibold text-slate-400">위탁기관 대시보드 하단 우측에 노출되는 광고입니다. 아래 미리보기가 실제 노출 모습입니다.</p>

            <div className="space-y-3.5">
              {/* 순서 · 배지 · 제목 · 게시 시작 · 종료 · 활성 (한 줄) */}
              <div className="flex items-start gap-3">
                <Field label="순서" className="w-[56px] shrink-0">
                  <input type="number" value={modal.draft.sortOrder ?? 0} onChange={e => setField("sortOrder", Number(e.target.value))} className={`w-full ${T.input}`} />
                </Field>
                <Field label="배지" className="w-[92px] shrink-0">
                  <input value={modal.draft.badge ?? ""} onChange={e => setField("badge", e.target.value)} placeholder="광고" className={`w-full ${T.input}`} />
                </Field>
                <Field label="제목" desc={`필수 · ${(modal.draft.title ?? "").length}/${TITLE_MAX}`} className="min-w-0 flex-1">
                  <input value={modal.draft.title ?? ""} maxLength={TITLE_MAX} onChange={e => setField("title", e.target.value)} placeholder="예: 신규 직무교육 세미나 안내" className={`w-full ${T.input}`} />
                </Field>
                <Field label="게시 시작" className="w-[132px] shrink-0">
                  <input type="date" value={(modal.draft.startAt ?? "").slice(0, 10)} onChange={e => setField("startAt", e.target.value)} className={`w-full ${T.input}`} />
                </Field>
                <Field label="게시 종료" className="w-[132px] shrink-0">
                  <input type="date" value={(modal.draft.endAt ?? "").slice(0, 10)} onChange={e => setField("endAt", e.target.value)} className={`w-full ${T.input}`} />
                </Field>
                <div className="shrink-0 self-start pt-[26px]">
                  <label className="flex h-10 items-center gap-1.5 whitespace-nowrap text-sm font-bold text-slate-700">
                    <input type="checkbox" checked={!!modal.draft.isActive} onChange={e => setField("isActive", e.target.checked)} className="h-4 w-4" />
                    게시
                  </label>
                </div>
              </div>

              {/* 설명 */}
              <Field label="설명" desc={`제목 아래 부가 설명 · ${(modal.draft.body ?? "").length}/${DESC_MAX}`}>
                <input value={modal.draft.body ?? ""} maxLength={DESC_MAX} onChange={e => setField("body", e.target.value)} placeholder="예: 8월 15일 온라인 개최 · 무료 참가" className={`w-full ${T.input}`} />
              </Field>

              {/* 카드 레이아웃 */}
              <div>
                <div className="mb-1.5 flex items-baseline gap-1.5">
                  <label className="whitespace-nowrap text-sm font-bold text-slate-700">카드 레이아웃</label>
                  <span className="text-[11px] font-medium text-slate-400">이미지가 없으면 자동으로 텍스트형으로 표시됩니다.</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {LAYOUTS.map(l => (
                    <button key={l.v} type="button" onClick={() => setField("layout", l.v)}
                      className={`rounded-xl border px-2 py-2 text-left transition ${modal.draft.layout === l.v ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                      <span className="block text-[13px] font-bold">{l.label}</span>
                      <span className={`mt-0.5 block text-[10px] leading-tight ${modal.draft.layout === l.v ? "text-white/70" : "text-slate-400"}`}>{l.desc}</span>
                    </button>
                  ))}
                </div>
                {/* 글자색 — 오버레이/제목만(이미지 위 텍스트)일 때 */}
                {(modal.draft.layout === "OVERLAY" || modal.draft.layout === "TITLE") && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[12px] font-bold text-slate-600">글자색</span>
                    {([["LIGHT", "밝게(흰 글자)"], ["DARK", "어둡게(검정 글자)"]] as const).map(([v, lbl]) => (
                      <button key={v} type="button" onClick={() => setField("textColor", v)}
                        className={`rounded-full border px-3 py-1 text-[12px] font-bold transition ${modal.draft.textColor === v ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
                        {lbl}
                      </button>
                    ))}
                    <span className="text-[11px] text-slate-400">이미지 밝기에 맞춰 선택</span>
                  </div>
                )}
              </div>

              {/* 운영 메모 */}
              <Field label="운영 메모(내부용)" desc="광고주·계약 등 내부 기록. 대시보드에는 표시되지 않습니다.">
                <input value={modal.draft.note ?? ""} onChange={e => setField("note", e.target.value)} placeholder="예: ○○기업 · 8월 계약" className={`w-full ${T.input}`} />
              </Field>

              {/* 링크 · 이미지(파일/URL) 한 줄 */}
              <div className="grid grid-cols-2 gap-3 items-start">
                <Field label="링크(클릭 시 이동)" desc="내부 /... 또는 https:// (새 탭).">
                  <input value={modal.draft.href ?? ""} onChange={e => setField("href", e.target.value)} placeholder="/manager/... 또는 https://" className={`w-full ${T.input}`} />
                </Field>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-1.5">
                      <label className="whitespace-nowrap text-sm font-bold text-slate-700">이미지</label>
                      <span className="truncate text-[11px] font-medium text-slate-400">비우면 텍스트만 · JPG·PNG·WEBP·GIF 5MB↓</span>
                    </div>
                    <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-200">
                      {(["file", "url"] as const).map(m => (
                        <button key={m} type="button" onClick={() => setImgMode(m)}
                          className={`px-2 py-0.5 text-[11px] font-bold transition ${imgMode === m ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                          {m === "file" ? "파일" : "URL"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {imgMode === "file" ? (
                    <div className="flex items-center gap-2">
                      <label className={`${T.btnSecondary} cursor-pointer whitespace-nowrap`}>
                        {uploading ? "업로드 중..." : "이미지 파일 선택"}
                        <input type="file" accept="image/*" className="hidden" disabled={uploading}
                          onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }} />
                      </label>
                      {modal.draft.imageUrl && <span className="truncate text-[11px] text-emerald-600">✓ 업로드됨</span>}
                    </div>
                  ) : (
                    <input value={modal.draft.imageUrl ?? ""} onChange={e => setField("imageUrl", e.target.value)} placeholder="https://.../banner.png" className={`w-full ${T.input}`} />
                  )}
                </div>
              </div>

              {/* 미리보기 — 실제 대시보드 슬롯과 동일 너비·높이 */}
              <div className="border-t border-slate-100 pt-4">
                <p className="mb-1.5 text-xs font-bold text-slate-500">실제 노출 미리보기 (대시보드 실제 크기)</p>
                <div className="inline-block rounded-2xl bg-slate-100 p-3">
                  <div className="h-[110px] w-[340px]">
                    <AdSlot contents={[{ badge: modal.draft.badge?.trim() || undefined, title: modal.draft.title?.trim() || "(제목을 입력하세요)", description: modal.draft.body?.trim() || undefined, imageUrl: modal.draft.imageUrl?.trim() || undefined, layout: modal.draft.layout as any, textColor: modal.draft.textColor as any, href: modal.draft.href?.trim() || undefined }]} />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
              {modal.mode === "edit"
                ? <button onClick={remove} className="text-sm font-bold text-rose-500 hover:text-rose-700">삭제</button>
                : <span />}
              <div className="flex gap-2">
                <button onClick={() => setModal(null)} className={T.btnSecondary}>취소</button>
                <button onClick={submit} disabled={saving} className={T.btnPrimary}>{saving ? "저장 중..." : modal.mode === "create" ? "등록" : "저장"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg">{toast}</div>}
    </div>
  );
}
