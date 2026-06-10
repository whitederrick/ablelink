"use client";
// app/admin/sites/[id]/page.tsx
// 현장(Site) 상세/수정 페이지 — 운영자 콘솔 공통 디자인 토큰(T)·PageHeader로 통일

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { T } from "../../_styles";
import PageHeader from "../../_components/PageHeader";

type SiteDetail = {
  id: string;
  companyName: string;
  address: string;
  detailAddress: string | null;
  gpsLat: string;
  gpsLon: string;
  allowanceRange: number;
  agencyId: string | null;
  agencyName: string;
  businessContactName: string | null;
  businessContactPhone: string | null;
  businessContactEmail: string | null;
  ownerManagerId: string | null;
  ownerManagerName: string | null;
  requiredProfession: string | null;
  basePointConfirmed: boolean;
  basePointApprovalStatus: string;
  basePointUpdatedAt: string | null;
  isActive: boolean;
};

const PROF_LABEL: Record<string, string> = {
  JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사",
};

type AssignmentItem = {
  id: string; status: string; workType: string;
  attendanceButtonExempt?: boolean;
  user: { id: string; workerName: string; phoneNumber: string | null } | null;
};
type WorkerOption = {
  id: string; workerName: string; phoneNumber: string | null; status: string;
};

// GPS 허용 범위 옵션
const RANGE_OPTIONS = [
  { value: 50,  label: "50m",  desc: "매우 엄격" },
  { value: 100, label: "100m", desc: "기본값 (권장)" },
  { value: 150, label: "150m", desc: "보통" },
  { value: 200, label: "200m", desc: "넓음" },
  { value: 300, label: "300m", desc: "매우 넓음" },
  { value: 500, label: "500m", desc: "건물 단지 단위" },
];

export default function AdminSiteDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const siteId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [item, setItem] = useState<SiteDetail | null>(null);

  // 기본 정보
  const [companyName, setCompanyName] = useState("");
  const [address, setAddress] = useState("");
  const [detailAddress, setDetailAddress] = useState("");
  const [gpsLat, setGpsLat] = useState("");
  const [gpsLon, setGpsLon] = useState("");
  const [allowanceRange, setAllowanceRange] = useState(100);
  const [customRange, setCustomRange] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  // 사업체 담당자 정보(현장 연락 담당자)
  const [businessContactName, setBusinessContactName] = useState("");
  const [businessContactPhone, setBusinessContactPhone] = useState("");
  const [businessContactEmail, setBusinessContactEmail] = useState("");

  // 담당 관리자(Manager 로그인) — 지정/이관/해제
  const [ownerManagerId, setOwnerManagerId] = useState("");
  const [ownerManagers, setOwnerManagers] = useState<{ id: string; name: string }[]>([]);

  // 직무지도원 배정
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [workerOptions, setWorkerOptions] = useState<WorkerOption[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [assignWorkType, setAssignWorkType] = useState("FULL_DAY");
  const [assignServiceStep, setAssignServiceStep] = useState("FIELD_TRAINING");
  const [assignExempt, setAssignExempt] = useState(false); // 출퇴근 버튼 면제(시프티 병행) — 운영자 전용
  const [assigning, setAssigning] = useState(false);
  const [exemptSavingId, setExemptSavingId] = useState<string | null>(null);

  async function fetchAssignments() {
    try {
      const res = await fetch(`/api/admin/assignments?siteId=${siteId}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) setAssignments(data.items);
    } catch { /* noop */ }
  }

  async function fetchWorkerOptions(profession: string | null) {
    try {
      const sp = new URLSearchParams();
      if (profession) sp.set("profession", profession);
      const res = await fetch(`/api/admin/system/workers?${sp.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) setWorkerOptions(data.workers.filter((w: any) => w.status === "ACTIVE"));
    } catch { /* noop */ }
  }

  async function assignWorker() {
    if (!selectedWorkerId) return alert("배정할 직무지도원을 선택하세요.");
    setAssigning(true);
    try {
      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, workerId: selectedWorkerId, workType: assignWorkType, serviceStep: assignServiceStep, attendanceButtonExempt: assignExempt }),
      });
      const data = await res.json();
      if (!data.success) {
        const msg = data.message === "VALIDATION:alreadyAssigned" ? "이미 배정된 직무지도원입니다."
          : data.message === "VALIDATION:userInactive" ? "비활성 직무지도원입니다."
          : data.message || "배정에 실패했습니다.";
        throw new Error(msg);
      }
      setSelectedWorkerId("");
      setAssignExempt(false);
      await fetchAssignments();
      alert("배정되었습니다.");
    } catch (e: any) {
      alert(e.message || "배정에 실패했습니다.");
    } finally {
      setAssigning(false);
    }
  }

  // 현장(site) 단위 일괄 면제 적용/해제 — 다수 직무지도원 동시 반영
  const [bulkExemptSaving, setBulkExemptSaving] = useState(false);
  async function bulkExempt(exempt: boolean) {
    const activeCnt = assignments.filter(a => a.status === "ACTIVE" || a.status === "CONFIRMED" || a.status === "ASSIGNED").length;
    if (activeCnt === 0) return alert("이 현장에 활성 배정이 없습니다.");
    if (!confirm(`이 현장의 활성 배정 ${activeCnt}명 전체에 출퇴근 면제를 ${exempt ? "적용" : "해제"}합니다. 계속할까요?`)) return;
    setBulkExemptSaving(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/attendance-exempt`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exempt }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "일괄 변경에 실패했습니다.");
      await fetchAssignments();
      alert(`${data.updated}명에게 면제를 ${exempt ? "적용" : "해제"}했습니다.`);
    } catch (e: any) {
      alert(e.message || "일괄 변경에 실패했습니다.");
    } finally {
      setBulkExemptSaving(false);
    }
  }

  // 출퇴근 버튼 면제 토글(운영자 전용). PATCH는 workType이 필수라 현재 값을 함께 전송.
  async function toggleExempt(a: AssignmentItem) {
    const next = !a.attendanceButtonExempt;
    setExemptSavingId(a.id);
    try {
      const res = await fetch(`/api/admin/assignments/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workType: a.workType, attendanceButtonExempt: next }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "변경에 실패했습니다.");
      await fetchAssignments();
    } catch (e: any) {
      alert(e.message || "변경에 실패했습니다.");
    } finally {
      setExemptSavingId(null);
    }
  }

  async function fetchDetail() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      const it: SiteDetail = data.item;
      setItem(it);
      setCompanyName(it.companyName || "");
      setAddress(it.address || "");
      setDetailAddress(it.detailAddress || "");
      setGpsLat(String(it.gpsLat ?? ""));
      setGpsLon(String(it.gpsLon ?? ""));
      const range = it.allowanceRange ?? 100;
      setAllowanceRange(range);
      const isPreset = RANGE_OPTIONS.some(o => o.value === range);
      setUseCustom(!isPreset);
      if (!isPreset) setCustomRange(String(range));
      setBusinessContactName(it.businessContactName || "");
      setBusinessContactPhone(it.businessContactPhone || "");
      setBusinessContactEmail(it.businessContactEmail || "");
      setOwnerManagerId(it.ownerManagerId || "");
      fetch(`/api/admin/site-owners?agencyId=${it.agencyId ?? ""}`, { cache: "no-store" })
        .then(r => r.json())
        .then(d => { if (d?.success) setOwnerManagers(d.managers || []); })
        .catch(() => {});
      fetchAssignments();
      fetchWorkerOptions(it.requiredProfession);
    } catch {
      alert("상세 조회에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchDetail(); }, [siteId]);

  const finalRange = useCustom ? Number(customRange) : allowanceRange;

  async function onSave() {
    if (!companyName.trim()) return alert("사업체명을 입력하세요.");
    if (!address.trim()) return alert("주소를 입력하세요.");
    if (!gpsLat.trim() || !gpsLon.trim()) return alert("GPS 좌표를 입력하세요.");
    if (!businessContactName.trim()) return alert("사업체 담당자 성명을 입력하세요.");
    if (!businessContactPhone.trim()) return alert("사업체 담당자 연락처를 입력하세요.");
    if (isNaN(finalRange) || finalRange < 50 || finalRange > 1000) {
      return alert("GPS 허용 범위는 50m ~ 1000m 사이로 설정해주세요.");
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          address: address.trim(),
          detailAddress: detailAddress.trim() || null,
          gpsLat: Number(gpsLat),
          gpsLon: Number(gpsLon),
          allowanceRange: finalRange,
          businessContactName: businessContactName.trim(),
          businessContactPhone: businessContactPhone.trim(),
          businessContactEmail: businessContactEmail.trim() || null,
          ownerManagerId: ownerManagerId || null,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      alert("저장되었습니다.");
      fetchDetail();
    } catch (e: any) {
      alert(e.message || "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!confirm("비활성화하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      alert("비활성화 처리되었습니다.");
      router.push("/admin/sites");
    } catch {
      alert("삭제에 실패했습니다.");
    }
  }

  if (loading || !item) {
    return (
      <div className="flex h-60 items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      {/* 헤더 — 공통 PageHeader */}
      <PageHeader
        title="현장(Site) 상세"
        sub={
          <>
            ID: {item.id} · 기관: {item.agencyName} ·{" "}
            <span className={item.isActive ? "font-bold text-emerald-600" : "font-bold text-rose-600"}>
              {item.isActive ? "활성" : "비활성"}
            </span>
          </>
        }
        actions={
          <>
            <button onClick={() => router.back()} className={T.btnSecondary}>← 목록</button>
            <button onClick={onDelete} className={T.btnDanger}>비활성화</button>
          </>
        }
      />

      {/* 기본 정보 */}
      <div className={T.card}>
        <h2 className="mb-4 text-sm font-black text-slate-900">기본 정보</h2>
        <div className="space-y-3">
          <Field label="사업체명 *" value={companyName} onChange={setCompanyName} />
          <Field label="주소 *" value={address} onChange={setAddress} />
          <Field label="상세주소" value={detailAddress} onChange={setDetailAddress} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="GPS 위도 *" value={gpsLat} onChange={setGpsLat} />
            <Field label="GPS 경도 *" value={gpsLon} onChange={setGpsLon} />
          </div>
        </div>

        {/* 기준점 상태 */}
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-sm">
          <span className="text-slate-400">기준점 상태:</span>
          <span className={item.basePointConfirmed ? "font-bold text-emerald-600" : "font-bold text-amber-600"}>
            {item.basePointConfirmed ? "확정" : "미확정"}
          </span>
          <span className="ml-2 text-xs text-slate-400">({item.basePointApprovalStatus})</span>
        </div>
      </div>

      {/* GPS 허용 범위 설정 */}
      <div className={T.card}>
        <h2 className="mb-1 text-sm font-black text-slate-900">📍 GPS 출퇴근 허용 범위</h2>
        <p className="mb-4 text-sm font-semibold leading-relaxed text-slate-400">
          직무지도원이 현장 반경 내에서 출퇴근 처리할 수 있는 허용 거리입니다.<br />
          범위를 벗어나면 에이전시 승인이 필요합니다.
        </p>

        {/* 프리셋 옵션 */}
        <div className="mb-3 grid grid-cols-4 gap-2">
          {RANGE_OPTIONS.map(opt => {
            const active = !useCustom && allowanceRange === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => { setAllowanceRange(opt.value); setUseCustom(false); }}
                className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 transition active:scale-95 ${
                  active ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <span className="text-[15px] font-black text-slate-900">{opt.label}</span>
                <span className="text-[11px] font-semibold text-slate-400">{opt.desc}</span>
              </button>
            );
          })}
          <button
            onClick={() => setUseCustom(true)}
            className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 transition active:scale-95 ${
              useCustom ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
            <span className="text-[15px] font-black text-slate-900">직접 입력</span>
            <span className="text-[11px] font-semibold text-slate-400">50~1000m</span>
          </button>
        </div>

        {/* 직접 입력 */}
        {useCustom && (
          <div className="mb-3 flex items-center gap-2">
            <input
              type="number" min={50} max={1000}
              value={customRange}
              onChange={e => setCustomRange(e.target.value)}
              placeholder="50 ~ 1000"
              className={`w-32 text-center ${T.input}`}
            />
            <span className="text-sm font-semibold text-slate-500">m</span>
          </div>
        )}

        {/* 현재 설정 미리보기 */}
        <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3.5 py-2.5 text-sm">
          <span className="text-xs font-semibold text-slate-500">현재 설정</span>
          <strong className="text-sky-600">반경 {isNaN(finalRange) ? "-" : finalRange}m</strong>
          <span className="ml-1 text-xs text-slate-400">
            {finalRange <= 100 ? "(엄격)" : finalRange <= 200 ? "(보통)" : "(넓음)"}
          </span>
        </div>
      </div>

      {/* 사업체 담당자 정보 */}
      <div className={T.card}>
        <h2 className="mb-1 text-sm font-black text-slate-900">사업체 담당자 정보</h2>
        <p className="mb-4 text-xs font-semibold text-slate-400">현장(사업체) 측 담당자. 출근부 ‘사업체담당자’ 서명 요청에 자동 채워집니다.</p>
        <div className="space-y-3">
          <Field label="담당자 성명 *" value={businessContactName} onChange={setBusinessContactName} />
          <Field label="담당자 연락처 *" value={businessContactPhone} onChange={setBusinessContactPhone} />
          <Field label="담당자 이메일 (선택)" value={businessContactEmail} onChange={setBusinessContactEmail} />
        </div>
      </div>

      {/* 담당 관리자(에이전시 측 관리자) — 지정/이관 */}
      <div className={T.card}>
        <h2 className="mb-1 text-sm font-black text-slate-900">담당 관리자</h2>
        <p className="mb-3 text-xs font-semibold text-slate-400">이 현장을 맡는 에이전시 관리자. ‘미지정(공용)’으로 두거나 다른 관리자에게 이관할 수 있습니다.</p>
        <select
          value={ownerManagerId}
          onChange={(e) => setOwnerManagerId(e.target.value)}
          className={`w-full ${T.select ?? T.input}`}
        >
          <option value="">미지정 (공용)</option>
          {ownerManagers.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* 직무지도원 배정 */}
      <div className={T.card}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-black text-slate-900">
          직무지도원 배정
          {item.requiredProfession && (
            <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-black text-sky-700">
              {PROF_LABEL[item.requiredProfession] ?? item.requiredProfession}
            </span>
          )}
        </h2>
        <p className="mb-4 text-sm font-semibold text-slate-400">
          이 현장에 직무지도원을 배정합니다. {item.requiredProfession ? "현장 직종 자격 보유자만 표시됩니다." : ""}
        </p>

        {/* 현재 배정 목록 */}
        {assignments.length > 0 ? (
          <div className="mb-3 space-y-1.5">
            {assignments.map(a => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <span className="font-bold text-slate-900">{a.user?.workerName ?? "(이름없음)"}</span>
                <span className="text-slate-400">{a.user?.phoneNumber ?? ""}</span>
                {a.attendanceButtonExempt && (
                  <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] font-black text-sky-700">출퇴근 면제</span>
                )}
                <span className={`ml-auto text-xs font-bold ${a.status === "ACTIVE" ? "text-emerald-600" : "text-slate-400"}`}>
                  {a.status} · {a.workType}
                </span>
                <button
                  onClick={() => toggleExempt(a)}
                  disabled={exemptSavingId === a.id}
                  title="출퇴근 버튼 면제(시프티 병행) 전환 — 운영자 전용"
                  className={`rounded-lg border px-2 py-1 text-[11px] font-black transition disabled:opacity-50 ${
                    a.attendanceButtonExempt
                      ? "border-sky-200 bg-white text-sky-700"
                      : "border-slate-200 bg-white text-slate-500"
                  }`}
                >
                  {exemptSavingId === a.id ? "처리중…" : a.attendanceButtonExempt ? "면제 해제" : "면제 적용"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-3 text-sm font-semibold text-slate-400">아직 배정된 직무지도원이 없습니다.</p>
        )}

        {/* 현장 전체 출퇴근 면제 — 다수 직무지도원 동시 반영(운영자 편의) */}
        {assignments.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2">
            <span className="text-xs font-bold text-sky-800">현장 전체 출퇴근 면제</span>
            <span className="text-[11px] font-semibold text-sky-500">활성 배정 직무지도원 전체에 일괄 적용/해제</span>
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => bulkExempt(true)} disabled={bulkExemptSaving}
                className="rounded-lg border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-black text-sky-700 transition disabled:opacity-50">
                {bulkExemptSaving ? "처리중…" : "전체 면제 적용"}
              </button>
              <button onClick={() => bulkExempt(false)} disabled={bulkExemptSaving}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black text-slate-500 transition disabled:opacity-50">
                전체 해제
              </button>
            </div>
          </div>
        )}

        {/* 신규 배정 */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedWorkerId}
            onChange={e => setSelectedWorkerId(e.target.value)}
            className={`min-w-[200px] flex-1 ${T.select}`}
          >
            <option value="">직무지도원 선택…</option>
            {workerOptions.map(w => (
              <option key={w.id} value={w.id}>{w.workerName} / {w.phoneNumber ?? "-"}</option>
            ))}
          </select>
          <select
            value={assignServiceStep}
            onChange={e => setAssignServiceStep(e.target.value)}
            className={T.select}
          >
            <option value="FIELD_TRAINING">지원고용 현장훈련</option>
            <option value="ADAPTATION">취업 후 적응지도</option>
          </select>
          <select
            value={assignWorkType}
            onChange={e => setAssignWorkType(e.target.value)}
            className={T.select}
          >
            <option value="FULL_DAY">종일(FULL_DAY)</option>
            <option value="AM">오전(AM)</option>
            <option value="PM">오후(PM)</option>
          </select>
          <button onClick={assignWorker} disabled={assigning || !selectedWorkerId} className={T.btnPrimary}>
            {assigning ? "배정 중…" : "배정"}
          </button>
        </div>
        {/* 출퇴근 버튼 면제(시프티 병행) — 운영자만 부여 */}
        <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <input type="checkbox" checked={assignExempt}
            onChange={e => setAssignExempt(e.target.checked)}
            className="h-4 w-4 accent-slate-950" />
          <span className="text-xs font-bold text-slate-600">
            출퇴근 버튼 면제 (시프티 병행 — 근무형태 기준 출근부 자동 생성)
          </span>
        </label>
        {workerOptions.length === 0 && (
          <p className="mt-2 text-xs font-semibold text-amber-500">
            배정 가능한 {item.requiredProfession ? (PROF_LABEL[item.requiredProfession] ?? "") + " 자격 " : ""}직무지도원이 없습니다.
          </p>
        )}
      </div>

      {/* 저장 버튼 */}
      <button onClick={onSave} disabled={saving} className={`${T.btnPrimary} w-full py-3.5`}>
        {saving ? "저장 중..." : "변경사항 저장"}
      </button>
    </div>
  );
}

function Field({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className={T.label}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} className={`w-full ${T.input}`} />
    </div>
  );
}
