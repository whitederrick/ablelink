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
  agencyName: string;
  managerName: string | null;
  managerEmail: string | null;
  managerPhone: string | null;
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

  // 담당자 정보
  const [managerName, setManagerName] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPhone, setManagerPhone] = useState("");

  // 직무지도원 배정
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [workerOptions, setWorkerOptions] = useState<WorkerOption[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [assignWorkType, setAssignWorkType] = useState("FULL_DAY");
  const [assigning, setAssigning] = useState(false);

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
        body: JSON.stringify({ siteId, workerId: selectedWorkerId, workType: assignWorkType }),
      });
      const data = await res.json();
      if (!data.success) {
        const msg = data.message === "VALIDATION:alreadyAssigned" ? "이미 배정된 직무지도원입니다."
          : data.message === "VALIDATION:userInactive" ? "비활성 직무지도원입니다."
          : data.message || "배정에 실패했습니다.";
        throw new Error(msg);
      }
      setSelectedWorkerId("");
      await fetchAssignments();
      alert("배정되었습니다.");
    } catch (e: any) {
      alert(e.message || "배정에 실패했습니다.");
    } finally {
      setAssigning(false);
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
      setManagerName(it.managerName || "");
      setManagerEmail(it.managerEmail || "");
      setManagerPhone(it.managerPhone || "");
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
    if (!managerName.trim()) return alert("담당자 성명을 입력하세요.");
    if (!managerEmail.trim()) return alert("담당자 이메일을 입력하세요.");
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
          managerName: managerName.trim(),
          managerEmail: managerEmail.trim(),
          managerPhone: managerPhone.trim(),
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

      {/* 담당자 정보 */}
      <div className={T.card}>
        <h2 className="mb-4 text-sm font-black text-slate-900">담당자 정보</h2>
        <div className="space-y-3">
          <Field label="성명 *" value={managerName} onChange={setManagerName} />
          <Field label="이메일 *" value={managerEmail} onChange={setManagerEmail} />
          <Field label="전화번호 *" value={managerPhone} onChange={setManagerPhone} />
        </div>
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
              <div key={a.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <span className="font-bold text-slate-900">{a.user?.workerName ?? "(이름없음)"}</span>
                <span className="text-slate-400">{a.user?.phoneNumber ?? ""}</span>
                <span className={`ml-auto text-xs font-bold ${a.status === "ACTIVE" ? "text-emerald-600" : "text-slate-400"}`}>
                  {a.status} · {a.workType}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-3 text-sm font-semibold text-slate-400">아직 배정된 직무지도원이 없습니다.</p>
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
