"use client";
// app/worker/site/register/page.tsx
// 직무지도 현장 등록/수정 페이지

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ─── 타입 ──────────────────────────────────────────────
interface Trainee {
  id: string;
  name: string;
  gender: "남" | "여";
  birthDate: string;   // YYYYMMDD
  phoneNumber: string;
  guardianPhoneNumber: string;
}

interface GpsCoords { lat: number; lon: number; }

// ─── 유틸 ──────────────────────────────────────────────
function calcDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function uid() { return Math.random().toString(36).slice(2); }

function formatBirth(val: string) {
  const d = val.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`;
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
}

// ─── 컴포넌트 ───────────────────────────────────────────
export default function SiteRegisterPage() {
  const router = useRouter();
  const params = useSearchParams();
  const isEdit = params.get("mode") === "edit";
  const siteId = params.get("siteId");

  // 기본 정보
  const [companyName, setCompanyName] = useState("");
  const [address, setAddress] = useState("");
  const [gps, setGps] = useState<GpsCoords | null>(null);
  const [currentGps, setCurrentGps] = useState<GpsCoords | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [showGpsMap, setShowGpsMap] = useState(false);

  // 담당자 정보
  const [agencyName, setAgencyName] = useState("");
  const [managerName, setManagerName] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPhone, setManagerPhone] = useState("");

  // 훈련 기간
  const [noPreTraining, setNoPreTraining] = useState(false);
  const [noFieldTraining, setNoFieldTraining] = useState(false);
  const [preStart, setPreStart] = useState("");
  const [preEnd, setPreEnd] = useState("");
  const [fieldStart, setFieldStart] = useState("");
  const [fieldEnd, setFieldEnd] = useState("");

  // 근무 형태
  const [workType, setWorkType] = useState("전일(8H)");
  const [isExtraTime, setIsExtraTime] = useState(false);

  // 훈련생
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [traineeForm, setTraineeForm] = useState<Omit<Trainee, "id">>({
    name: "", gender: "남", birthDate: "", phoneNumber: "", guardianPhoneNumber: "",
  });

  // 주소 검색
  const [addrQuery, setAddrQuery] = useState("");
  const [addrResults, setAddrResults] = useState<any[]>([]);
  const [addrLoading, setAddrLoading] = useState(false);
  const [showAddrSearch, setShowAddrSearch] = useState(false);

  // 제출
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 현재 위치 GPS 획득
  const getMyGps = useCallback(async () => {
    setGpsLoading(true);
    try {
      const pos = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 10000,
        });
      });
      const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setCurrentGps(coords);
      setShowGpsMap(true);
    } catch {
      alert("위치를 가져올 수 없습니다. 브라우저 위치 권한을 허용해주세요.");
    } finally {
      setGpsLoading(false);
    }
  }, []);

  // 주소 검색
  async function searchAddress() {
    if (!addrQuery.trim()) return;
    setAddrLoading(true);
    try {
      const res = await fetch(`/api/geo/search-address?q=${encodeURIComponent(addrQuery)}`);
      const data = await res.json();
      setAddrResults(data.results || []);
    } catch {
      alert("주소 검색에 실패했습니다.");
    } finally {
      setAddrLoading(false);
    }
  }

  function selectAddress(item: any) {
    setAddress(item.addressName || item.address_name || "");
    setGps({ lat: parseFloat(item.y), lon: parseFloat(item.x) });
    setShowAddrSearch(false);
    setAddrResults([]);
    setAddrQuery("");
  }

  // 훈련생 추가
  function addTrainee() {
    if (!traineeForm.name.trim()) { alert("훈련생 이름을 입력해주세요."); return; }
    if (!traineeForm.birthDate.replace(/\D/g, "")) { alert("생년월일을 입력해주세요."); return; }
    if (!traineeForm.phoneNumber.trim()) { alert("전화번호를 입력해주세요."); return; }
    setTrainees(prev => [...prev, { ...traineeForm, id: uid(), birthDate: traineeForm.birthDate.replace(/\D/g, "") }]);
    setTraineeForm({ name: "", gender: "남", birthDate: "", phoneNumber: "", guardianPhoneNumber: "" });
  }

  function removeTrainee(id: string) {
    setTrainees(prev => prev.filter(t => t.id !== id));
  }

  // 제출
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!companyName.trim()) { setError("사업체명을 입력해주세요."); return; }
    if (!address.trim()) { setError("주소를 입력해주세요."); return; }
    if (!gps) { setError("위치(GPS)를 확인해주세요. 주소 검색 후 '현재 위치 확인' 버튼을 눌러주세요."); return; }
    if (!managerName.trim()) { setError("담당자 이름을 입력해주세요."); return; }
    if (!managerEmail.trim()) { setError("담당자 이메일을 입력해주세요."); return; }
    if (trainees.length === 0) { setError("훈련생을 최소 1명 이상 추가해주세요."); return; }

    setLoading(true);
    try {
      const payload = {
        companyName, address,
        gpsLat: gps.lat, gpsLon: gps.lon,
        agencyName, managerName, managerEmail, managerPhone,
        noPreTraining, noFieldTraining,
        preTrainingStart: noPreTraining ? null : preStart || null,
        preTrainingEnd: noPreTraining ? null : preEnd || null,
        fieldTrainingStart: noFieldTraining ? null : fieldStart || null,
        fieldTrainingEnd: noFieldTraining ? null : fieldEnd || null,
        workType, isExtraTime,
        trainees: trainees.map(t => ({
          name: t.name,
          gender: t.gender,
          birthDate: t.birthDate,
          phoneNumber: t.phoneNumber.replace(/-/g, ""),
          guardianPhoneNumber: t.guardianPhoneNumber.replace(/-/g, "") || null,
        })),
      };

      // userId는 API에서 세션으로 가져오거나, worker API 경유
      const res = await fetch("/api/worker/site/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!data.success) { setError(data.message || "등록에 실패했습니다."); return; }

      router.replace("/worker/home");
    } catch {
      setError("서버와 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }

  const dist = gps && currentGps ? calcDistance(gps.lat, gps.lon, currentGps.lat, currentGps.lon) : null;

  return (
    <div style={s.page}>
      <div style={s.container}>
        {/* 헤더 */}
        <div style={s.header}>
          <button onClick={() => router.back()} style={s.backBtn}>←</button>
          <h1 style={s.title}>{isEdit ? "직무지도 Site 수정" : "현장 등록"}</h1>
        </div>

        {isEdit && (
          <div style={s.editNotice}>
            수정 모드에서는 주소/사업체명 변경이 불가합니다. 변경이 필요하면 관리자 승인 절차로 요청해 주세요.
          </div>
        )}

        <form onSubmit={handleSubmit}>

          {/* ① 현장 기본 정보 */}
          <div style={s.section}>
            <p style={s.sectionTitle}>1. 직무지도 Site 현장 등록</p>

            <div style={s.field}>
              <label style={s.label}>주소 *</label>
              {!isEdit ? (
                <>
                  <div style={s.row}>
                    <div style={{ ...s.inputBox, flex: 1, color: address ? "#333" : "#aaa" }}>
                      {address || "주소를 검색해주세요"}
                    </div>
                    <button type="button" style={s.smBtn} onClick={() => setShowAddrSearch(true)}>
                      검색
                    </button>
                  </div>
                  {gps && (
                    <p style={s.gpsInfo}>
                      GPS: {gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}
                    </p>
                  )}
                </>
              ) : (
                <div style={s.inputBox}>{address}</div>
              )}
            </div>

            <div style={s.field}>
              <label style={s.label}>근무 사업체명 *</label>
              <input
                style={s.input}
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="예: 서울시청"
                disabled={isEdit}
                required
              />
            </div>

            {/* GPS 현재 위치 확인 */}
            <button type="button" style={s.gpsBtn} onClick={getMyGps} disabled={gpsLoading}>
              🗺️ {gpsLoading ? "위치 확인 중..." : "현재 위치 확인"}
            </button>

            {showGpsMap && currentGps && gps && (
              <div style={s.gpsCard}>
                <div style={s.gpsRow}>
                  <span style={{ color: "#e53935" }}>📍 지정 위치:</span>
                  <span>{gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}</span>
                </div>
                <div style={s.gpsRow}>
                  <span style={{ color: "#2e7d32" }}>📍 현재 위치:</span>
                  <span>{currentGps.lat.toFixed(6)}, {currentGps.lon.toFixed(6)}</span>
                </div>
                <div style={s.gpsRow}>
                  <span>오차 범위:</span>
                  <span style={{ fontWeight: 700, color: dist! > 100 ? "#e53935" : "#2e7d32" }}>
                    {dist}m
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "#888", margin: "8px 0 0" }}>
                  지정 위치 대비 100m 이내이면 자동 확정되고, 100m를 초과하면 관리자 승인이 필요합니다.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button type="button" style={{ ...s.smBtn, flex: 1 }} onClick={() => setShowGpsMap(false)}>취소</button>
                  <button type="button" style={{ ...s.smBtn, flex: 1, backgroundColor: "#111827", color: "#fff" }}
                    onClick={() => { if (!gps) setGps(currentGps); setShowGpsMap(false); }}>
                    확인
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ② 담당자 정보 */}
          <div style={s.section}>
            <p style={s.sectionTitle}>2. 담당자 정보</p>
            <div style={s.field}>
              <label style={s.label}>주관 기관명</label>
              <input style={s.input} value={agencyName} onChange={e => setAgencyName(e.target.value)} placeholder="예: 다음미래" />
            </div>
            <div style={s.field}>
              <label style={s.label}>담당자명 *</label>
              <input style={s.input} value={managerName} onChange={e => setManagerName(e.target.value)} placeholder="홍길동" required />
            </div>
            <div style={s.field}>
              <label style={s.label}>담당자 이메일 *</label>
              <input style={s.input} type="email" value={managerEmail} onChange={e => setManagerEmail(e.target.value)} placeholder="example@email.com" required />
            </div>
            <div style={s.field}>
              <label style={s.label}>담당자 전화번호</label>
              <input style={s.input} type="tel" value={managerPhone} onChange={e => setManagerPhone(e.target.value)} placeholder="01012345678" />
            </div>
          </div>

          {/* ③ 훈련 기간 */}
          <div style={s.section}>
            <p style={s.sectionTitle}>3. 훈련 기간 설정</p>

            <div style={s.toggleRow}>
              <span style={s.label}>사전 훈련기간</span>
              <label style={s.toggle}>
                <input type="checkbox" checked={noPreTraining} onChange={e => setNoPreTraining(e.target.checked)} style={{ display: "none" }} />
                <span style={{ ...s.toggleTrack, backgroundColor: noPreTraining ? "#2563eb" : "#ccc" }}>
                  <span style={{ ...s.toggleThumb, transform: noPreTraining ? "translateX(18px)" : "none" }} />
                </span>
                <span style={{ fontSize: 13, color: "#888" }}>없음</span>
              </label>
            </div>
            {!noPreTraining && (
              <div style={s.dateRow}>
                <input style={s.dateInput} type="date" value={preStart} onChange={e => setPreStart(e.target.value)} />
                <span style={s.dateSep}>~</span>
                <input style={s.dateInput} type="date" value={preEnd} onChange={e => setPreEnd(e.target.value)} />
              </div>
            )}

            <div style={{ ...s.toggleRow, marginTop: 12 }}>
              <span style={s.label}>현장 훈련기간</span>
              <label style={s.toggle}>
                <input type="checkbox" checked={noFieldTraining} onChange={e => setNoFieldTraining(e.target.checked)} style={{ display: "none" }} />
                <span style={{ ...s.toggleTrack, backgroundColor: noFieldTraining ? "#2563eb" : "#ccc" }}>
                  <span style={{ ...s.toggleThumb, transform: noFieldTraining ? "translateX(18px)" : "none" }} />
                </span>
                <span style={{ fontSize: 13, color: "#888" }}>없음</span>
              </label>
            </div>
            {!noFieldTraining && (
              <div style={s.dateRow}>
                <input style={s.dateInput} type="date" value={fieldStart} onChange={e => setFieldStart(e.target.value)} />
                <span style={s.dateSep}>~</span>
                <input style={s.dateInput} type="date" value={fieldEnd} onChange={e => setFieldEnd(e.target.value)} />
              </div>
            )}
          </div>

          {/* ④ 근무 형태 */}
          <div style={s.section}>
            <p style={s.sectionTitle}>4. 근무 형태</p>
            <div style={s.workTypeRow}>
              {["오전(4H)", "오후(4H)", "전일(8H)"].map(type => (
                <button
                  key={type} type="button"
                  style={{ ...s.workTypeBtn, ...(workType === type ? s.workTypeActive : {}) }}
                  onClick={() => setWorkType(type)}
                >
                  {type}
                </button>
              ))}
            </div>
            <label style={s.checkRow}>
              <input type="checkbox" checked={isExtraTime} onChange={e => setIsExtraTime(e.target.checked)} />
              <span style={{ fontSize: 14, color: "#444", marginLeft: 8 }}>
                출퇴근 / 휴게 시간 직무지도 인정 여부 (+1.5H)
              </span>
            </label>
          </div>

          {/* ⑤ 훈련생 관리 */}
          <div style={s.section}>
            <p style={s.sectionTitle}>5. 훈련생 관리</p>

            <div style={s.traineeForm}>
              <div style={s.traineeRow}>
                <input
                  style={{ ...s.input, flex: 2 }}
                  placeholder="성명 *"
                  value={traineeForm.name}
                  onChange={e => setTraineeForm(f => ({ ...f, name: e.target.value }))}
                />
                <div style={s.genderBtns}>
                  {(["남", "여"] as const).map(g => (
                    <button key={g} type="button"
                      style={{ ...s.genderBtn, ...(traineeForm.gender === g ? s.genderActive : {}) }}
                      onClick={() => setTraineeForm(f => ({ ...f, gender: g }))}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <input
                style={s.input}
                placeholder="생년월일 (YYYY.MM.DD) *"
                value={formatBirth(traineeForm.birthDate)}
                onChange={e => setTraineeForm(f => ({ ...f, birthDate: e.target.value.replace(/\D/g, "") }))}
                inputMode="numeric"
              />
              <input
                style={s.input}
                placeholder="전화번호 *"
                value={traineeForm.phoneNumber}
                onChange={e => setTraineeForm(f => ({ ...f, phoneNumber: e.target.value }))}
                type="tel"
              />
              <input
                style={s.input}
                placeholder="보호자 전화 (선택)"
                value={traineeForm.guardianPhoneNumber}
                onChange={e => setTraineeForm(f => ({ ...f, guardianPhoneNumber: e.target.value }))}
                type="tel"
              />
              <button type="button" style={s.addTraineeBtn} onClick={addTrainee}>
                + 훈련생 추가
              </button>
            </div>

            {trainees.map(t => (
              <div key={t.id} style={s.traineeItem}>
                <div>
                  <span style={{ fontWeight: 600 }}>{t.name}({t.gender})</span>
                  <span style={{ color: "#888", fontSize: 12, marginLeft: 8 }}>
                    {t.birthDate.slice(0, 4)}.{t.birthDate.slice(4, 6)}.{t.birthDate.slice(6)} | {t.phoneNumber}
                  </span>
                  {t.guardianPhoneNumber && (
                    <p style={{ fontSize: 12, color: "#aaa", margin: "2px 0 0" }}>보호자: {t.guardianPhoneNumber}</p>
                  )}
                </div>
                <button type="button" style={s.removeBtn} onClick={() => removeTrainee(t.id)}>🗑️</button>
              </div>
            ))}
          </div>

          {error && <p style={s.error}>{error}</p>}

          <button
            type="submit"
            style={{ ...s.submitBtn, opacity: loading ? 0.7 : 1 }}
            disabled={loading}
          >
            {loading ? "저장 중..." : isEdit ? "수정 완료" : "등록 완료"}
          </button>
        </form>
      </div>

      {/* 주소 검색 모달 */}
      {showAddrSearch && (
        <div style={s.modalOverlay}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>주소 검색</span>
              <button style={s.closeBtn} onClick={() => setShowAddrSearch(false)}>✕</button>
            </div>
            <div style={s.searchRow}>
              <input
                style={{ ...s.input, flex: 1 }}
                placeholder="도로명, 건물명, 지번 검색"
                value={addrQuery}
                onChange={e => setAddrQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && searchAddress()}
                autoFocus
              />
              <button style={s.smBtn} onClick={searchAddress} disabled={addrLoading}>
                {addrLoading ? "..." : "검색"}
              </button>
            </div>
            <div style={s.resultList}>
              {addrResults.length === 0 && (
                <p style={{ color: "#aaa", textAlign: "center", padding: 20, fontSize: 14 }}>
                  검색 결과가 없습니다.
                </p>
              )}
              {addrResults.map((item, i) => (
                <button key={i} style={s.resultItem} onClick={() => selectAddress(item)}>
                  <span style={{ fontSize: 14, color: "#333" }}>{item.addressName || item.address_name}</span>
                  {item.roadAddress?.addressName && (
                    <span style={{ fontSize: 12, color: "#111827", marginTop: 2, display: "block" }}>
                      {item.roadAddress.addressName}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 스타일 ──────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", backgroundColor: "#f9fafb" },
  container: { maxWidth: 480, margin: "0 auto", padding: "16px 16px 60px" },
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 },
  backBtn: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#374151", padding: "4px 8px", fontWeight: 700 },
  title: { fontSize: 20, fontWeight: 700, color: "#111827", margin: 0 },
  editNotice: { backgroundColor: "#fefce8", color: "#92400e", fontSize: 13, padding: "10px 14px", borderRadius: 10, marginBottom: 16, lineHeight: 1.5, border: "1px solid #fde68a" },

  section: { backgroundColor: "#fff", borderRadius: 14, padding: "18px 16px", marginBottom: 10, border: "1px solid #f3f4f6" },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: "#374151", margin: "0 0 14px", textTransform: "uppercase" as const, letterSpacing: "0.5px", fontSize2: 12 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 8 },
  input: { width: "100%", height: 46, border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 15, color: "#111827", backgroundColor: "#fafafa", outline: "none", padding: "0 12px", boxSizing: "border-box" as const, fontFamily: "inherit" },
  inputBox: { padding: "12px", backgroundColor: "#f9fafb", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, color: "#374151", minHeight: 46, display: "flex", alignItems: "center" },
  row: { display: "flex", gap: 8, alignItems: "center" },
  smBtn: { padding: "10px 14px", backgroundColor: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" as const },
  gpsInfo: { fontSize: 11, color: "#9ca3af", margin: "6px 0 0" },
  gpsBtn: { width: "100%", padding: "12px", backgroundColor: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
  gpsCard: { backgroundColor: "#f9fafb", borderRadius: 10, padding: 14, marginTop: 10, border: "1px solid #e5e7eb" },
  gpsRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#374151", marginBottom: 6 },

  toggleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  toggle: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer" },
  toggleTrack: { width: 36, height: 20, borderRadius: 10, position: "relative" as const, transition: "background 0.2s", display: "inline-block", flexShrink: 0 },
  toggleThumb: { position: "absolute" as const, top: 2, left: 2, width: 16, height: 16, backgroundColor: "#fff", borderRadius: "50%", transition: "transform 0.2s" },
  dateRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 8 },
  dateInput: { flex: 1, height: 42, border: "1px solid #e5e7eb", borderRadius: 8, padding: "0 10px", fontSize: 14, color: "#111827", outline: "none", background: "#fafafa" },
  dateSep: { color: "#9ca3af", fontWeight: 500 },

  workTypeRow: { display: "flex", gap: 8, marginBottom: 12 },
  workTypeBtn: { flex: 1, padding: "11px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, cursor: "pointer", backgroundColor: "#fafafa", color: "#6b7280", fontWeight: 600 },
  workTypeActive: { backgroundColor: "#111827", color: "#fff", border: "1px solid #111827" },
  checkRow: { display: "flex", alignItems: "center", cursor: "pointer" },

  traineeForm: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 },
  traineeRow: { display: "flex", gap: 8, alignItems: "flex-end" },
  genderBtns: { display: "flex", gap: 4, flexShrink: 0 },
  genderBtn: { width: 42, height: 42, border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", backgroundColor: "#fafafa", color: "#6b7280" },
  genderActive: { backgroundColor: "#111827", color: "#fff", border: "1px solid #111827" },
  addTraineeBtn: { width: "100%", padding: "13px", backgroundColor: "#374151", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  traineeItem: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "12px 14px", backgroundColor: "#f9fafb", borderRadius: 10, marginBottom: 8, border: "1px solid #f3f4f6" },
  removeBtn: { background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#dc2626", padding: 4 },

  error: { color: "#dc2626", fontSize: 13, backgroundColor: "#fef2f2", padding: "12px 16px", borderRadius: 10, margin: "12px 0", textAlign: "center" as const, border: "1px solid #fecaca" },
  submitBtn: { width: "100%", padding: "16px", backgroundColor: "#111827", color: "#fff", fontSize: 16, fontWeight: 700, border: "none", borderRadius: 12, cursor: "pointer", marginTop: 8 },

  // 모달
  modalOverlay: { position: "fixed" as const, inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", flexDirection: "column" as const },
  modal: { backgroundColor: "#fff", borderRadius: "20px 20px 0 0", marginTop: "auto", maxHeight: "80dvh", display: "flex", flexDirection: "column" as const },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #f3f4f6" },
  modalTitle: { fontSize: 16, fontWeight: 700, color: "#111827" },
  closeBtn: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" },
  searchRow: { display: "flex", gap: 8, padding: "12px 16px" },
  resultList: { overflowY: "auto" as const, flex: 1 },
  resultItem: { width: "100%", textAlign: "left" as const, padding: "14px 20px", border: "none", borderBottom: "1px solid #f9fafb", backgroundColor: "transparent", cursor: "pointer" },
};
