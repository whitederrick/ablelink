"use client";
// 현장(Site) 상세 본문 — 목록의 모달 팝업과 /admin/sites/[id] 페이지가 공유.
// onClose 제공 시 모달 모드(닫기 버튼), 미제공 시 페이지 모드(router.back).
// 시스템 관리자 콘솔이므로 dual 엔드포인트 호출에 x-admin-context:1 (매니저 동시 로그인 시 admin으로 동작).

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { T } from "../_styles";

const AC = { "Content-Type": "application/json", "x-admin-context": "1" };
const ACG = { "x-admin-context": "1" };

type SiteDetailT = {
  id: string; companyName: string; address: string; detailAddress: string | null;
  gpsLat: string; gpsLon: string; allowanceRange: number;
  agencyId: string | null; agencyName: string;
  businessContactName: string | null; businessContactPhone: string | null; businessContactEmail: string | null;
  govContacts?: { name: string; email: string; phone?: string | null }[];
  additionalContacts?: { id?: string; name: string; phone: string | null; email: string | null }[];
  ownerManagerId: string | null; ownerManagerName: string | null;
  requiredProfession: string | null;
  basePointConfirmed: boolean; basePointApprovalStatus: string; basePointUpdatedAt: string | null;
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
type WorkerOption = { id: string; workerName: string; phoneNumber: string | null; status: string };

const RANGE_OPTIONS = [
  { value: 50,  label: "50m",  desc: "매우 엄격" },
  { value: 100, label: "100m", desc: "기본값 (권장)" },
  { value: 150, label: "150m", desc: "보통" },
  { value: 200, label: "200m", desc: "넓음" },
  { value: 300, label: "300m", desc: "매우 넓음" },
  { value: 500, label: "500m", desc: "건물 단지 단위" },
];

export default function SiteDetail({ id, onClose, onChanged }: { id: string; onClose?: () => void; onChanged?: () => void }) {
  const router = useRouter();
  const siteId = id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [item, setItem] = useState<SiteDetailT | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [address, setAddress] = useState("");
  const [detailAddress, setDetailAddress] = useState("");
  const [gpsLat, setGpsLat] = useState("");
  const [gpsLon, setGpsLon] = useState("");
  const [allowanceRange, setAllowanceRange] = useState(100);
  const [customRange, setCustomRange] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  const [businessContactName, setBusinessContactName] = useState("");
  const [businessContactPhone, setBusinessContactPhone] = useState("");
  const [businessContactEmail, setBusinessContactEmail] = useState("");
  const [govContacts, setGovContacts] = useState<{ name: string; email: string; phone: string }[]>([]);
  const [additionalContacts, setAdditionalContacts] = useState<{ name: string; phone: string; email: string }[]>([]);

  const [ownerManagerId, setOwnerManagerId] = useState("");
  const [ownerManagers, setOwnerManagers] = useState<{ id: string; name: string }[]>([]);

  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [workerOptions, setWorkerOptions] = useState<WorkerOption[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [assignWorkType, setAssignWorkType] = useState("FULL_DAY");
  const [assignServiceStep, setAssignServiceStep] = useState("FIELD_TRAINING");
  const [assignExempt, setAssignExempt] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [exemptSavingId, setExemptSavingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const fetchAssignments = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/assignments?siteId=${siteId}`, { headers: ACG, cache: "no-store" });
      const data = await res.json();
      // '현재 배정'은 실제 배정(ACTIVE/ASSIGNED/CONFIRMED)만 — 목록의 직무지도원 수 집계 기준과 동일.
      // 배정 요청 중(REQUESTED/ACCEPTED)·종료 이력(ENDED 등)은 제외(요청 단계는 배정 요청/확정 화면 소관).
      if (data.success) setAssignments((data.items || []).filter((a: any) => ["ASSIGNED","CONFIRMED","ACTIVE"].includes(a.status)));
    } catch { /* noop */ }
  }, [siteId]);

  async function fetchWorkerOptions(profession: string | null) {
    try {
      const sp = new URLSearchParams();
      if (profession) sp.set("profession", profession);
      const res = await fetch(`/api/admin/system/workers?${sp.toString()}`, { headers: ACG, cache: "no-store" });
      const data = await res.json();
      // 활성 + 현재 진행 중 배정이 없는(다른 현장에 안 묶인) 직무지도원만 후보로 노출
      if (data.success) setWorkerOptions(data.workers.filter((w: any) => w.status === "ACTIVE" && !w.siteName));
    } catch { /* noop */ }
  }

  async function assignWorker() {
    if (!selectedWorkerId) return alert("배정할 직무지도원을 선택하세요.");
    setAssigning(true);
    try {
      const res = await fetch("/api/admin/assignments", {
        method: "POST", headers: AC,
        body: JSON.stringify({ siteId, workerId: selectedWorkerId, workType: assignWorkType, serviceStep: assignServiceStep, attendanceButtonExempt: assignExempt }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "배정에 실패했습니다.");
      setSelectedWorkerId(""); setAssignExempt(false);
      await fetchAssignments();
      onChanged?.();
      alert("배정되었습니다.");
    } catch (e: any) { alert(e.message || "배정에 실패했습니다."); }
    finally { setAssigning(false); }
  }

  async function cancelAssignment(a: AssignmentItem) {
    if (!confirm(`${a.user?.workerName ?? "이 직무지도원"}의 배정을 취소(종료)하시겠습니까?`)) return;
    setCancelingId(a.id);
    try {
      const res = await fetch(`/api/admin/assignments/${a.id}`, { method: "DELETE", headers: AC });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "취소에 실패했습니다.");
      await fetchAssignments();
      onChanged?.();
    } catch (e: any) { alert(e.message || "취소에 실패했습니다."); }
    finally { setCancelingId(null); }
  }

  const [bulkExemptSaving, setBulkExemptSaving] = useState(false);
  async function bulkExempt(exempt: boolean) {
    const activeCnt = assignments.filter(a => a.status === "ACTIVE" || a.status === "CONFIRMED" || a.status === "ASSIGNED").length;
    if (activeCnt === 0) return alert("이 현장에 활성 배정이 없습니다.");
    if (!confirm(`이 현장의 활성 배정 ${activeCnt}명 전체에 출퇴근 면제를 ${exempt ? "적용" : "해제"}합니다. 계속할까요?`)) return;
    setBulkExemptSaving(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/attendance-exempt`, { method: "PATCH", headers: AC, body: JSON.stringify({ exempt }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "일괄 변경에 실패했습니다.");
      await fetchAssignments();
      alert(`${data.updated}명에게 면제를 ${exempt ? "적용" : "해제"}했습니다.`);
    } catch (e: any) { alert(e.message || "일괄 변경에 실패했습니다."); }
    finally { setBulkExemptSaving(false); }
  }

  async function toggleExempt(a: AssignmentItem) {
    const next = !a.attendanceButtonExempt;
    setExemptSavingId(a.id);
    try {
      const res = await fetch(`/api/admin/assignments/${a.id}`, { method: "PATCH", headers: AC, body: JSON.stringify({ workType: a.workType, attendanceButtonExempt: next }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "변경에 실패했습니다.");
      await fetchAssignments();
    } catch (e: any) { alert(e.message || "변경에 실패했습니다."); }
    finally { setExemptSavingId(null); }
  }

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, { headers: ACG, cache: "no-store" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      const it: SiteDetailT = data.item;
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
      setGovContacts(Array.isArray(it.govContacts)
        ? it.govContacts.map((c: any) => ({ name: c.name ?? "", email: c.email ?? "", phone: c.phone ?? "" }))
        : []);
      setAdditionalContacts(Array.isArray(it.additionalContacts)
        ? it.additionalContacts.map((c: any) => ({ name: c.name ?? "", phone: c.phone ?? "", email: c.email ?? "" }))
        : []);
      setOwnerManagerId(it.ownerManagerId || "");
      fetch(`/api/admin/site-owners?agencyId=${it.agencyId ?? ""}`, { headers: ACG, cache: "no-store" })
        .then(r => r.json())
        .then(d => { if (d?.success) setOwnerManagers(d.managers || []); })
        .catch(() => {});
      fetchAssignments();
      fetchWorkerOptions(it.requiredProfession);
    } catch {
      alert("상세 조회에 실패했습니다.");
      onClose?.();
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, fetchAssignments]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const finalRange = useCustom ? Number(customRange) : allowanceRange;

  async function onSave() {
    if (!companyName.trim()) return alert("사업체명을 입력하세요.");
    if (!address.trim()) return alert("주소를 입력하세요.");
    if (!gpsLat.trim() || !gpsLon.trim()) return alert("GPS 좌표를 입력하세요.");
    if (!businessContactName.trim()) return alert("사업체 담당자 성명을 입력하세요.");
    if (!businessContactPhone.trim()) return alert("사업체 담당자 연락처를 입력하세요.");
    if (isNaN(finalRange) || finalRange < 50 || finalRange > 1000) return alert("GPS 허용 범위는 50m ~ 1000m 사이로 설정해주세요.");
    if (additionalContacts.some(c => (c.phone.trim() || c.email.trim()) && !c.name.trim()))
      return alert("추가 사업체 담당자의 성명을 입력하세요. (성명 필수)");
    if (govContacts.some(c => (c.name.trim() || c.phone.trim()) && !c.email.trim()))
      return alert("장애인고용공단 담당자의 이메일(수신처)을 입력하세요. (이메일 필수)");

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, {
        method: "PATCH", headers: AC,
        body: JSON.stringify({
          companyName: companyName.trim(), address: address.trim(), detailAddress: detailAddress.trim() || null,
          gpsLat: Number(gpsLat), gpsLon: Number(gpsLon), allowanceRange: finalRange,
          businessContactName: businessContactName.trim(), businessContactPhone: businessContactPhone.trim(),
          businessContactEmail: businessContactEmail.trim() || null, ownerManagerId: ownerManagerId || null,
          govContacts: govContacts.map(c => ({ name: c.name.trim(), email: c.email.trim(), phone: c.phone.trim() })).filter(c => c.email),
          additionalContacts: additionalContacts
            .map(c => ({ name: c.name.trim(), phone: c.phone.trim(), email: c.email.trim() }))
            .filter(c => c.name),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      alert("저장되었습니다.");
      onChanged?.();
      fetchDetail();
    } catch (e: any) { alert(e.message || "저장에 실패했습니다."); }
    finally { setSaving(false); }
  }

  async function onDelete() {
    if (!confirm("비활성화하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, { method: "DELETE", headers: ACG });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      alert("비활성화 처리되었습니다.");
      onChanged?.();
      if (onClose) onClose(); else router.push("/admin/sites");
    } catch { alert("삭제에 실패했습니다."); }
  }

  if (loading || !item) {
    return (
      <div className="flex h-60 items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-black text-slate-900">{item.companyName}</h1>
          <p className="mt-0.5 text-sm font-semibold text-slate-400">
            ID: {item.id} · 기관: {item.agencyName} ·{" "}
            <span className={item.isActive ? "font-bold text-emerald-600" : "font-bold text-rose-600"}>{item.isActive ? "활성" : "비활성"}</span>
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button onClick={onDelete} className={T.btnDanger}>비활성화</button>
          {onClose
            ? <button onClick={onClose} className={T.btnSecondary}>닫기</button>
            : <button onClick={() => router.back()} className={T.btnSecondary}>← 목록</button>}
        </div>
      </div>

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
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-sm">
          <span className="text-slate-400">기준점 상태:</span>
          <span className={item.basePointConfirmed ? "font-bold text-emerald-600" : "font-bold text-amber-600"}>{item.basePointConfirmed ? "확정" : "미확정"}</span>
          <span className="ml-2 text-xs text-slate-400">({item.basePointApprovalStatus})</span>
        </div>
      </div>

      {/* GPS 허용 범위 */}
      <div className={T.card}>
        <h2 className="mb-1 text-sm font-black text-slate-900">📍 GPS 출퇴근 허용 범위</h2>
        <p className="mb-4 text-sm font-semibold leading-relaxed text-slate-400">
          직무지도원이 현장 반경 내에서 출퇴근 처리할 수 있는 허용 거리입니다.<br />범위를 벗어나면 위탁기관 승인이 필요합니다.
        </p>
        <div className="mb-3 grid grid-cols-4 gap-2">
          {RANGE_OPTIONS.map(opt => {
            const active = !useCustom && allowanceRange === opt.value;
            return (
              <button key={opt.value} onClick={() => { setAllowanceRange(opt.value); setUseCustom(false); }}
                className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 transition active:scale-95 ${active ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                <span className="text-[15px] font-black text-slate-900">{opt.label}</span>
                <span className="text-[11px] font-semibold text-slate-400">{opt.desc}</span>
              </button>
            );
          })}
          <button onClick={() => setUseCustom(true)}
            className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 transition active:scale-95 ${useCustom ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
            <span className="text-[15px] font-black text-slate-900">직접 입력</span>
            <span className="text-[11px] font-semibold text-slate-400">50~1000m</span>
          </button>
        </div>
        {useCustom && (
          <div className="mb-3 flex items-center gap-2">
            <input type="number" min={50} max={1000} value={customRange} onChange={e => setCustomRange(e.target.value)} placeholder="50 ~ 1000" className={`w-32 text-center ${T.input}`} />
            <span className="text-sm font-semibold text-slate-500">m</span>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3.5 py-2.5 text-sm">
          <span className="text-xs font-semibold text-slate-500">현재 설정</span>
          <strong className="text-sky-600">반경 {isNaN(finalRange) ? "-" : finalRange}m</strong>
          <span className="ml-1 text-xs text-slate-400">{finalRange <= 100 ? "(엄격)" : finalRange <= 200 ? "(보통)" : "(넓음)"}</span>
        </div>
      </div>

      {/* 사업체 담당자 (대표) */}
      <div className={T.card}>
        <h2 className="mb-1 text-sm font-black text-slate-900">사업체 담당자 (대표)</h2>
        <p className="mb-4 text-xs font-semibold text-slate-400">현장(사업체) 측 <b>대표</b> 담당자. 출근부 '사업체담당자' 서명 요청·워커앱 표시에 자동 채워집니다.</p>
        <div className="space-y-3">
          <Field label="담당자 성명 *" value={businessContactName} onChange={setBusinessContactName} />
          <Field label="담당자 연락처 *" value={businessContactPhone} onChange={setBusinessContactPhone} />
          <Field label="담당자 이메일 (선택)" value={businessContactEmail} onChange={setBusinessContactEmail} />
        </div>
      </div>

      {/* 추가 사업체 담당자 */}
      <div className={T.card}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-900">추가 사업체 담당자</h2>
          <button onClick={() => setAdditionalContacts(p => [...p, { name: "", phone: "", email: "" }])} className={`${T.btnSecondary} py-1.5`}>+ 추가</button>
        </div>
        <p className="mb-3 text-xs font-semibold text-slate-400">대표 외 추가 연락 담당자를 여러 명 등록할 수 있습니다. (서명·워커앱 표시는 대표 담당자 기준)</p>
        {additionalContacts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-[13px] font-semibold text-slate-400">추가 담당자가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {additionalContacts.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={c.name} onChange={e => setAdditionalContacts(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                  placeholder="성명 *" className={`w-[100px] shrink-0 ${T.input}`} />
                <input value={c.phone} onChange={e => setAdditionalContacts(p => p.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))}
                  placeholder="연락처(선택)" className={`w-[136px] shrink-0 ${T.input}`} />
                <input value={c.email} onChange={e => setAdditionalContacts(p => p.map((x, j) => j === i ? { ...x, email: e.target.value } : x))}
                  placeholder="이메일(선택)" className={`min-w-0 flex-1 ${T.input}`} />
                <button onClick={() => setAdditionalContacts(p => p.filter((_, j) => j !== i))} className={`${T.btnDanger} shrink-0`}>삭제</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 현장별 공단 담당자 */}
      <div className={T.card}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-900">장애인고용공단 담당자 (현장별)</h2>
          <button onClick={() => setGovContacts(p => [...p, { name: "", email: "", phone: "" }])} className={`${T.btnSecondary} py-1.5`}>+ 추가</button>
        </div>
        <p className="mb-3 text-xs font-semibold text-slate-400">일지를 이 현장으로 묶어 발송할 때 자동 수신처가 됩니다. 비우면 위탁기관 기본 공단 담당자가 사용됩니다.</p>
        {govContacts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-[13px] font-semibold text-slate-400">현장 전용 공단 담당자가 없습니다. (기관 기본값 사용)</p>
        ) : (
          <div className="space-y-2">
            {govContacts.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={c.name} onChange={e => setGovContacts(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                  placeholder="담당자명(선택)" className={`w-[100px] shrink-0 ${T.input}`} />
                <input value={c.phone} onChange={e => setGovContacts(p => p.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))}
                  placeholder="연락처(선택)" className={`w-[136px] shrink-0 ${T.input}`} />
                <input value={c.email} onChange={e => setGovContacts(p => p.map((x, j) => j === i ? { ...x, email: e.target.value } : x))}
                  placeholder="이메일 (수신처) *" className={`min-w-0 flex-1 ${T.input}`} />
                <button onClick={() => setGovContacts(p => p.filter((_, j) => j !== i))} className={`${T.btnDanger} shrink-0`}>삭제</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 담당 관리자 */}
      <div className={T.card}>
        <h2 className="mb-1 text-sm font-black text-slate-900">담당 관리자</h2>
        <p className="mb-3 text-xs font-semibold text-slate-400">이 현장을 맡는 위탁기관 관리자. '미지정(공용)'으로 두거나 다른 관리자에게 이관할 수 있습니다.</p>
        <select value={ownerManagerId} onChange={e => setOwnerManagerId(e.target.value)} className={`w-full ${T.select ?? T.input}`}>
          <option value="">미지정 (공용)</option>
          {ownerManagers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      {/* 직무지도원 배정 */}
      <div className={T.card}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-black text-slate-900">
          직무지도원 배정
          {item.requiredProfession && (
            <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-black text-sky-700">{PROF_LABEL[item.requiredProfession] ?? item.requiredProfession}</span>
          )}
        </h2>
        <p className="mb-4 text-sm font-semibold text-slate-400">이 현장에 직무지도원을 배정합니다. {item.requiredProfession ? "현장 직종 자격 보유자만 표시됩니다." : ""}</p>

        {assignments.length > 0 ? (
          <div className="mb-3 space-y-1.5">
            {assignments.map(a => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <span className="font-bold text-slate-900">{a.user?.workerName ?? "(이름없음)"}</span>
                <span className="text-slate-400">{a.user?.phoneNumber ?? ""}</span>
                {a.attendanceButtonExempt && <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] font-black text-sky-700">출퇴근 관리 면제</span>}
                <span className={`ml-auto text-xs font-bold ${a.status === "ACTIVE" ? "text-emerald-600" : "text-slate-400"}`}>{a.status} · {a.workType}</span>
                <button onClick={() => toggleExempt(a)} disabled={exemptSavingId === a.id}
                  className={`rounded-lg border px-2 py-1 text-[11px] font-black transition disabled:opacity-50 ${a.attendanceButtonExempt ? "border-sky-200 bg-white text-sky-700" : "border-slate-200 bg-white text-slate-500"}`}>
                  {exemptSavingId === a.id ? "처리중…" : a.attendanceButtonExempt ? "출퇴근 관리 면제 해제" : "출퇴근 관리 면제"}
                </button>
                {["REQUESTED","ACCEPTED","ASSIGNED","CONFIRMED","ACTIVE"].includes(a.status) && (
                  <button onClick={() => cancelAssignment(a)} disabled={cancelingId === a.id}
                    className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-black text-rose-600 transition hover:bg-rose-50 disabled:opacity-50">
                    {cancelingId === a.id ? "처리중…" : "배정 취소"}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-3 text-sm font-semibold text-slate-400">아직 배정된 직무지도원이 없습니다.</p>
        )}

        {assignments.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2">
            <span className="text-xs font-bold text-sky-800">현장 전체 출퇴근 관리 면제</span>
            <span className="text-[11px] font-semibold text-sky-500">활성 배정 직무지도원 전체에 일괄 적용/해제</span>
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => bulkExempt(true)} disabled={bulkExemptSaving} className="rounded-lg border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-black text-sky-700 transition disabled:opacity-50">{bulkExemptSaving ? "처리중…" : "전체 면제"}</button>
              <button onClick={() => bulkExempt(false)} disabled={bulkExemptSaving} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black text-slate-500 transition disabled:opacity-50">전체 해제</button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select value={selectedWorkerId} onChange={e => setSelectedWorkerId(e.target.value)} className={`min-w-[200px] flex-1 ${T.select}`}>
            <option value="">직무지도원 선택…</option>
            {workerOptions.map(w => <option key={w.id} value={w.id}>{w.workerName} / {w.phoneNumber ?? "-"}</option>)}
          </select>
          <select value={assignServiceStep} onChange={e => setAssignServiceStep(e.target.value)} className={T.select}>
            <option value="FIELD_TRAINING">지원고용 현장훈련</option>
            <option value="ADAPTATION">취업 후 적응지도</option>
          </select>
          <select value={assignWorkType} onChange={e => setAssignWorkType(e.target.value)} className={T.select}>
            <option value="FULL_DAY">종일(FULL_DAY)</option>
            <option value="AM">오전(AM)</option>
            <option value="PM">오후(PM)</option>
          </select>
          <button onClick={assignWorker} disabled={assigning || !selectedWorkerId} className={T.btnPrimary}>{assigning ? "배정 중…" : "배정"}</button>
        </div>
        <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <input type="checkbox" checked={assignExempt} onChange={e => setAssignExempt(e.target.checked)} className="mt-0.5 h-4 w-4 accent-slate-950" />
          <span className="text-xs font-bold leading-relaxed text-rose-600">
            신규 배정 직무지도원의 출퇴근 관리 면제 허용 여부를 선택할 수 있습니다. (시프티 병행 - 근무형태 기준 출근부 자동 생성)
            <br />
            기존에 배정된 직무지도원의 경우, 상단의 전체 면제 또는 개별 면제 버튼을 통해 적용해야 합니다.
          </span>
        </label>
        {workerOptions.length === 0 && (
          <p className="mt-2 text-xs font-semibold text-amber-500">배정 가능한 {item.requiredProfession ? (PROF_LABEL[item.requiredProfession] ?? "") + " 자격 " : ""}직무지도원이 없습니다.</p>
        )}
      </div>

      <button onClick={onSave} disabled={saving} className={`${T.btnPrimary} w-full py-3.5`}>{saving ? "저장 중..." : "변경사항 저장"}</button>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={T.label}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} className={`w-full ${T.input}`} />
    </div>
  );
}
