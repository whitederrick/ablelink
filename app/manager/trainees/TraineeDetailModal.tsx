"use client";

// 훈련생 상세 — 목록에서 행 클릭 시 뜨는 모달(상세/수정) + 신규 등록 겸용.
// 구성·사이즈는 현장(사업체) 관리 / 직무지도원 관리 기준 패턴을 따른다(행 클릭 → 상세 모달, 등록=동일 모달 등록모드).
import { useState } from "react";
import { X } from "lucide-react";
import { T } from "../_styles";

export type Trainee = {
  id: string; siteId: string; siteName: string; name: string; gender: string;
  birthDate: string | null; phoneNumber: string | null; guardianPhoneNumber: string | null;
  disabilityType: string; severity: string; status: string; note: string | null; createdAt: string;
};
type Site = { id: string; companyName: string };

const STATUS_META: Record<string, { label: string; cls: string }> = {
  TRAINING:  { label: "훈련중",   cls: "bg-sky-50 text-sky-600" },
  EMPLOYED:  { label: "취업",     cls: "bg-emerald-50 text-emerald-600" },
  DROPOUT:   { label: "중도포기", cls: "bg-rose-50 text-rose-600" },
  GRADUATED: { label: "수료",     cls: "bg-slate-100 text-slate-500" },
};
const STATUS_OPTIONS = Object.entries(STATUS_META).map(([v, m]) => [v, m.label] as const);

// 이 모달 전용 카드 — 전역 T.card(p-5)보다 상하 여백을 줄임(px-5 py-4).
const CARD = "rounded-2xl border border-slate-200 bg-white px-5 py-4";

export default function TraineeDetailModal({ trainee, sites, onClose, onSaved }: {
  trainee?: Trainee | null; sites: Site[]; onClose: () => void; onSaved: () => void;
}) {
  const isCreate = !trainee;
  const [saving, setSaving] = useState(false);

  const [siteId, setSiteId]                       = useState(trainee?.siteId ?? "");
  const [name, setName]                           = useState(trainee?.name ?? "");
  const [gender, setGender]                       = useState(trainee?.gender ?? "M");
  const [birthDate, setBirthDate]                 = useState(trainee?.birthDate ?? "");
  const [phoneNumber, setPhoneNumber]             = useState(trainee?.phoneNumber ?? "");
  const [guardianPhoneNumber, setGuardianPhone]   = useState(trainee?.guardianPhoneNumber ?? "");
  const [disabilityType, setDisabilityType]       = useState(trainee?.disabilityType ?? "지적장애");
  const [severity, setSeverity]                   = useState(trainee?.severity ?? "경증");
  const [status, setStatus]                       = useState(trainee?.status ?? "TRAINING");
  const [note, setNote]                           = useState(trainee?.note ?? "");

  async function onSave() {
    if (!name.trim()) return alert("이름을 입력하세요.");
    if (!siteId) return alert("현장(사업체)을 선택하세요.");
    setSaving(true);
    try {
      const payload: any = {
        siteId, name: name.trim(), gender,
        birthDate: birthDate || null,
        phoneNumber: phoneNumber || null,
        guardianPhoneNumber: guardianPhoneNumber || null,
        disabilityType, severity, note: note || null,
      };
      if (!isCreate) payload.status = status;
      const res = await fetch(isCreate ? "/api/admin/trainees" : `/api/admin/trainees/${trainee!.id}`, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      alert(isCreate ? "등록되었습니다." : "저장되었습니다.");
      onSaved();
    } catch (e: any) { alert(e.message || (isCreate ? "등록에 실패했습니다." : "저장에 실패했습니다.")); }
    finally { setSaving(false); }
  }

  const meta = trainee ? STATUS_META[trainee.status] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div className="w-full max-w-[48rem] max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">{isCreate ? "훈련생 신규 등록" : "훈련생 상세"}</h2>
            {trainee && (
              <p className="mt-0.5 text-[13px] font-semibold text-slate-400">
                ID {trainee.id} · 현장 {trainee.siteName}
                {meta && <> · <span className={`${T.badge} ${meta.cls}`}>{meta.label}</span></>}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* 기본 정보 */}
          <div className={CARD}>
            <h3 className="mb-3 text-sm font-black text-slate-900">기본 정보</h3>
            <div className="space-y-3">
              <div>
                <label className={T.label}>현장(사업체) *</label>
                <select value={siteId} onChange={e => setSiteId(e.target.value)} className={`w-full ${T.select}`}>
                  <option value="">현장 선택</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.companyName}</option>)}
                </select>
              </div>
              <div>
                <label className={T.label}>이름 *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="성명" className={`w-full ${T.input}`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={T.label}>성별</label>
                  <select value={gender} onChange={e => setGender(e.target.value)} className={`w-full ${T.select}`}>
                    <option value="M">남</option><option value="F">여</option>
                  </select>
                </div>
                <div>
                  <label className={T.label}>생년월일</label>
                  <input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} className={`w-full ${T.input}`} />
                </div>
              </div>
            </div>
          </div>

          {/* 연락처 */}
          <div className={CARD}>
            <h3 className="mb-3 text-sm font-black text-slate-900">연락처</h3>
            <div className="space-y-3">
              <div>
                <label className={T.label}>연락처</label>
                <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="010-0000-0000" className={`w-full ${T.input}`} />
              </div>
              <div>
                <label className={T.label}>보호자 연락처</label>
                <input value={guardianPhoneNumber} onChange={e => setGuardianPhone(e.target.value)} placeholder="010-0000-0000" className={`w-full ${T.input}`} />
              </div>
            </div>
          </div>

          {/* 장애 정보 */}
          <div className={CARD}>
            <h3 className="mb-3 text-sm font-black text-slate-900">장애 정보</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={T.label}>장애 유형</label>
                <input value={disabilityType} onChange={e => setDisabilityType(e.target.value)} placeholder="지적장애" className={`w-full ${T.input}`} />
              </div>
              <div>
                <label className={T.label}>장애 정도</label>
                <select value={severity} onChange={e => setSeverity(e.target.value)} className={`w-full ${T.select}`}>
                  <option>경증</option><option>중증</option>
                </select>
              </div>
            </div>
          </div>

          {/* 상태 + 비고 */}
          <div className={CARD}>
            <h3 className="mb-3 text-sm font-black text-slate-900">훈련 상태 · 비고</h3>
            <div className="space-y-3">
              {!isCreate && (
                <div>
                  <label className={T.label}>상태</label>
                  <select value={status} onChange={e => setStatus(e.target.value)} className={`w-full ${T.select}`}>
                    {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <p className="mt-1 text-[11px] font-semibold text-slate-400">‘훈련중’ 외 상태로 변경하면 종료일이 기록됩니다.</p>
                </div>
              )}
              <div>
                <label className={T.label}>비고</label>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="특이사항 메모" className={`w-full ${T.input}`} />
              </div>
            </div>
          </div>
        </div>

        {/* 액션 */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className={T.btnSecondary}>닫기</button>
          <button onClick={onSave} disabled={saving} className={T.btnPrimary}>
            {saving ? (isCreate ? "등록 중..." : "저장 중...") : (isCreate ? "등록" : "변경사항 저장")}
          </button>
        </div>
      </div>
    </div>
  );
}
