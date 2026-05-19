"use client";
// app/admin/sites/[id]/page.tsx
// Site 상세/수정 페이지

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

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
  basePointConfirmed: boolean;
  basePointApprovalStatus: string;
  basePointUpdatedAt: string | null;
  isActive: boolean;
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
    } catch (e) {
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
      <div style={s.center}>
        <div style={s.spinner} />
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* 헤더 */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Site 상세</h1>
          <p style={s.subtitle}>
            ID: {item.id} · 기관: {item.agencyName} ·
            <span style={{ color: item.isActive ? "#2e7d32" : "#e53935", fontWeight: 600 }}>
              {item.isActive ? " 활성" : " 비활성"}
            </span>
          </p>
        </div>
        <div style={s.headerBtns}>
          <button style={s.backBtn} onClick={() => router.back()}>← 목록</button>
          <button style={s.deleteBtn} onClick={onDelete}>비활성화</button>
        </div>
      </div>

      <div style={s.content}>
        {/* 기본 정보 */}
        <div style={s.section}>
          <h2 style={s.sectionTitle}>기본 정보</h2>
          <div style={s.fieldGrid}>
            <Field label="사업체명 *" value={companyName} onChange={setCompanyName} />
            <Field label="주소 *" value={address} onChange={setAddress} />
            <Field label="상세주소" value={detailAddress} onChange={setDetailAddress} />
            <div style={s.row}>
              <Field label="GPS 위도 *" value={gpsLat} onChange={setGpsLat} />
              <Field label="GPS 경도 *" value={gpsLon} onChange={setGpsLon} />
            </div>
          </div>

          {/* 기준점 상태 */}
          <div style={s.infoBox}>
            <span style={s.infoLabel}>기준점 상태:</span>
            <span style={{ color: item.basePointConfirmed ? "#2e7d32" : "#f57c00", fontWeight: 600 }}>
              {item.basePointConfirmed ? "확정" : "미확정"}
            </span>
            <span style={{ color: "#aaa", marginLeft: 12, fontSize: 12 }}>
              ({item.basePointApprovalStatus})
            </span>
          </div>
        </div>

        {/* GPS 허용 범위 설정 */}
        <div style={s.section}>
          <h2 style={s.sectionTitle}>📍 GPS 출퇴근 허용 범위</h2>
          <p style={s.sectionDesc}>
            직무지도원이 현장 반경 내에서 출퇴근 처리할 수 있는 허용 거리입니다.<br />
            범위를 벗어나면 에이전시 승인이 필요합니다.
          </p>

          {/* 프리셋 옵션 */}
          <div style={s.rangeGrid}>
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                style={{
                  ...s.rangeBtn,
                  ...((!useCustom && allowanceRange === opt.value) ? s.rangeBtnActive : {}),
                }}
                onClick={() => { setAllowanceRange(opt.value); setUseCustom(false); }}
              >
                <span style={s.rangeBtnValue}>{opt.label}</span>
                <span style={s.rangeBtnDesc}>{opt.desc}</span>
              </button>
            ))}
            <button
              style={{
                ...s.rangeBtn,
                ...(useCustom ? s.rangeBtnActive : {}),
              }}
              onClick={() => setUseCustom(true)}
            >
              <span style={s.rangeBtnValue}>직접 입력</span>
              <span style={s.rangeBtnDesc}>50~1000m</span>
            </button>
          </div>

          {/* 직접 입력 */}
          {useCustom && (
            <div style={s.customRangeRow}>
              <input
                style={s.customRangeInput}
                type="number"
                min={50}
                max={1000}
                value={customRange}
                onChange={e => setCustomRange(e.target.value)}
                placeholder="50 ~ 1000"
              />
              <span style={s.customRangeUnit}>m</span>
            </div>
          )}

          {/* 현재 설정 미리보기 */}
          <div style={s.rangePreview}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>현재 설정</span>
            <strong style={{ color: "#2563eb" }}>
              반경 {isNaN(finalRange) ? "-" : finalRange}m
            </strong>
            <span style={{ color: "#888", fontSize: 12, marginLeft: 8 }}>
              {finalRange <= 100 ? "(엄격)" : finalRange <= 200 ? "(보통)" : "(넓음)"}
            </span>
          </div>
        </div>

        {/* 담당자 정보 */}
        <div style={s.section}>
          <h2 style={s.sectionTitle}>담당자 정보</h2>
          <div style={s.fieldGrid}>
            <Field label="성명 *" value={managerName} onChange={setManagerName} />
            <Field label="이메일 *" value={managerEmail} onChange={setManagerEmail} />
            <Field label="전화번호 *" value={managerPhone} onChange={setManagerPhone} />
          </div>
        </div>

        {/* 저장 버튼 */}
        <button
          style={{ ...s.saveBtn, opacity: saving ? 0.7 : 1 }}
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "저장 중..." : "변경사항 저장"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 6, letterSpacing: "0.2px" }}>
        {label}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: "100%", height: 40, border: "1px solid #e5e7eb", borderRadius: 8, padding: "0 12px", fontSize: 14, color: "#111827", outline: "none", boxSizing: "border-box", background: "#fff", fontFamily: "inherit" }}
      />
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 800 },
  center: { display: "flex", justifyContent: "center", padding: "60px 0" },
  spinner: { width: 28, height: 28, border: "2.5px solid #e5e7eb", borderTop: "2.5px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" },

  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  title: { fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 4px", letterSpacing: "-0.3px" },
  subtitle: { fontSize: 13, color: "#9ca3af", margin: 0 },
  headerBtns: { display: "flex", gap: 8 },
  backBtn: { padding: "8px 16px", border: "1px solid #e5e7eb", borderRadius: 8, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: "#374151" },
  deleteBtn: { padding: "8px 16px", border: "1px solid #fecaca", borderRadius: 8, backgroundColor: "#fff", color: "#dc2626", cursor: "pointer", fontSize: 13, fontWeight: 500 },

  content: { display: "flex", flexDirection: "column", gap: 14 },
  section: { backgroundColor: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #f0f0f0" },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: "#111827", margin: "0 0 4px" },
  sectionDesc: { fontSize: 13, color: "#9ca3af", margin: "0 0 16px", lineHeight: 1.6 },
  fieldGrid: { display: "flex", flexDirection: "column" },
  row: { display: "flex", gap: 12 },
  infoBox: { display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "10px 14px", backgroundColor: "#f9fafb", borderRadius: 8, fontSize: 13, border: "1px solid #f0f0f0" },
  infoLabel: { color: "#9ca3af" },

  rangeGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 },
  rangeBtn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 8px", border: "1px solid #e5e7eb", borderRadius: 10, cursor: "pointer", backgroundColor: "#fff", transition: "all 0.15s" },
  rangeBtnActive: { border: "1.5px solid #2563eb", backgroundColor: "#eff6ff" },
  rangeBtnValue: { fontSize: 15, fontWeight: 700, color: "#111827" },
  rangeBtnDesc: { fontSize: 11, color: "#9ca3af" },
  customRangeRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },
  customRangeInput: { width: 120, height: 42, border: "1.5px solid #2563eb", borderRadius: 8, padding: "0 12px", fontSize: 16, fontWeight: 700, color: "#2563eb", outline: "none", textAlign: "center" as const },
  customRangeUnit: { fontSize: 15, color: "#6b7280", fontWeight: 600 },
  rangePreview: { display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", backgroundColor: "#eff6ff", borderRadius: 8, fontSize: 14, border: "1px solid #bfdbfe" },
  rangePreviewIcon: { fontSize: 16 },

  saveBtn: { width: "100%", padding: "14px", backgroundColor: "#2563eb", color: "#fff", fontSize: 14, fontWeight: 700, border: "none", borderRadius: 10, cursor: "pointer", marginTop: 4 },
};
