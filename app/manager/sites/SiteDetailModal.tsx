"use client";

// 직무지도 현장(사업체) 상세 — 목록에서 행 클릭 시 뜨는 모달. (구 /manager/sites/[id] 페이지를 모달화)
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { T } from "../_styles";
import AddressMapPicker from "@/components/AddressMapPicker";

type SiteDetail = {
  id: string; companyName: string; address: string; detailAddress: string | null;
  gpsLat: string; gpsLon: string; allowanceRange: number; lateThresholdMin?: number | null; agencyName: string;
  amCapacity?: number; pmCapacity?: number; fullDayCapacity?: number;
  businessContactName: string | null; businessContactPhone: string | null; businessContactEmail: string | null;
  ownerManagerId: string | null; ownerManagerName: string | null;
  basePointConfirmed: boolean; basePointApprovalStatus: string; isActive: boolean;
};
type AddrItem = { addressName: string; x: string; y: string };

const RANGE_PRESETS = [50, 100, 150, 200, 300, 500];

// 이 모달 전용 카드 — 전역 T.card(p-5)보다 상하 여백을 줄임(px-5 py-4). 카드 간 간격은 별도로 넓힘.
const CARD = "rounded-2xl border border-slate-200 bg-white px-5 py-4";

export default function SiteDetailModal({ siteId, onClose, onSaved }: {
  siteId?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const isCreate = !siteId;
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [item, setItem] = useState<SiteDetail | null>(null);

  // 신규 등록 시 운영자(ADMIN)는 기관 선택 필요 (매니저는 본인 기관 자동)
  const [isAdmin, setIsAdmin] = useState(false);
  const [agencies, setAgencies] = useState<{ id: string; name: string }[]>([]);
  const [agencyId, setAgencyId] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [address, setAddress] = useState("");
  const [detailAddress, setDetailAddress] = useState("");
  const [gpsLat, setGpsLat] = useState("");
  const [gpsLon, setGpsLon] = useState("");
  const [allowanceRange, setAllowanceRange] = useState(100);
  const [lateThresholdMin, setLateThresholdMin] = useState<string>(""); // ""=위탁기관 기본값 상속
  const [agencyDefaultLate, setAgencyDefaultLate] = useState<number>(30); // 위탁기관 기본 지각 기준(표시용)
  const [amCapacity, setAmCapacity] = useState(0);
  const [pmCapacity, setPmCapacity] = useState(0);
  const [fullDayCapacity, setFullDayCapacity] = useState(0);

  const [businessContactName, setBusinessContactName] = useState("");
  const [businessContactPhone, setBusinessContactPhone] = useState("");
  const [businessContactEmail, setBusinessContactEmail] = useState("");

  const [ownerManagerId, setOwnerManagerId] = useState("");
  const [ownerManagers, setOwnerManagers] = useState<{ id: string; name: string }[]>([]);

  const [addrQ, setAddrQ] = useState("");
  const [addrLoading, setAddrLoading] = useState(false);
  const [addrItems, setAddrItems] = useState<AddrItem[]>([]);
  const [mapPick, setMapPick] = useState<{ lat: number; lon: number; address: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/site-owners", { cache: "no-store" })
      .then(async r => { try { return await r.json(); } catch { return null; } })
      .then(d => { if (d?.success) setOwnerManagers(d.managers || []); })
      .catch(() => {});
  }, []);

  // 신규 등록: 세션 확인 → 운영자면 기관 목록 로드
  useEffect(() => {
    if (!isCreate) return;
    (async () => {
      try {
        const me = await fetch("/api/manager/auth/me", { cache: "no-store" }).then(r => r.json()).catch(() => null);
        const admin = me?.success === true && me?.session?.role === "ADMIN";
        setIsAdmin(admin);
        if (admin) {
          const d = await fetch("/api/admin/sites/options", { cache: "no-store" }).then(r => r.json()).catch(() => null);
          const a = (d?.options?.agencies || []) as { id: string; name: string }[];
          setAgencies(a);
          if (a.length > 0) setAgencyId(String(a[0].id));
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate]);

  useEffect(() => {
    if (!siteId) { setLoading(false); return; }  // 신규 등록 모드는 조회 생략
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/sites/${siteId}`, { cache: "no-store" });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok || !data?.success) throw new Error();
        if (!alive) return;
        const it: SiteDetail = data.item;
        setItem(it);
        setCompanyName(it.companyName || "");
        setAddress(it.address || "");
        setDetailAddress(it.detailAddress || "");
        setGpsLat(String(it.gpsLat ?? ""));
        setGpsLon(String(it.gpsLon ?? ""));
        setAllowanceRange(it.allowanceRange ?? 100);
        setLateThresholdMin(it.lateThresholdMin != null ? String(it.lateThresholdMin) : "");
        setAmCapacity(it.amCapacity ?? 0);
        setPmCapacity(it.pmCapacity ?? 0);
        setFullDayCapacity(it.fullDayCapacity ?? 0);
        setBusinessContactName(it.businessContactName || "");
        setBusinessContactPhone(it.businessContactPhone || "");
        setBusinessContactEmail(it.businessContactEmail || "");
        setOwnerManagerId(it.ownerManagerId || "");
      } catch {
        if (alive) { alert("상세 조회에 실패했습니다."); onClose(); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // 위탁기관 기본 지각 기준(표시용) — 현장 미설정 시 적용되는 값
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/agency-profile", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (alive && d?.success && d.data?.lateThresholdMin != null) setAgencyDefaultLate(Number(d.data.lateThresholdMin)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  async function searchAddress() {
    if (!addrQ.trim()) return;
    setAddrLoading(true);
    try {
      const r = await fetch(`/api/geo/search-address?q=${encodeURIComponent(addrQ.trim())}`, { cache: "no-store" });
      const d = await r.json();
      const items: AddrItem[] =
        d?.items?.map((x: any) => ({ addressName: x.addressName ?? x.address_name, x: x.x, y: x.y })) ||
        d?.documents?.map((x: any) => ({ addressName: x.addressName ?? x.address_name, x: x.x, y: x.y })) || [];
      setAddrItems(items);
      if (items.length === 0) alert("주소 검색 결과가 없습니다.");
    } catch { alert("주소 검색 실패"); }
    finally { setAddrLoading(false); }
  }

  function pickAddress(it: AddrItem) {
    setMapPick({ lat: parseFloat(it.y), lon: parseFloat(it.x), address: it.addressName });
    setAddrItems([]);
  }

  async function onSave() {
    if (!companyName.trim()) return alert("현장(사업체)명을 입력하세요.");
    if (!address.trim() || !gpsLat.trim() || !gpsLon.trim()) return alert("주소 검색·지도로 위치를 지정하세요.");
    if (!businessContactName.trim()) return alert("사업체 담당자 성명을 입력하세요.");
    if (!businessContactPhone.trim()) return alert("사업체 담당자 연락처를 입력하세요.");
    if (isNaN(allowanceRange) || allowanceRange < 50 || allowanceRange > 1000) return alert("GPS 허용 범위는 50~1000m 사이로 설정하세요.");
    if (lateThresholdMin.trim() !== "") {
      const lt = Number(lateThresholdMin);
      if (!Number.isInteger(lt) || lt < 1 || lt > 180) return alert("지각 기준은 1~180분 사이로 설정하세요. (비우면 기관 기본값 사용)");
    }
    if (isCreate && isAdmin && !agencyId) return alert("기관을 선택하세요.");
    setSaving(true);
    try {
      const payload: any = {
        companyName: companyName.trim(), address: address.trim(),
        detailAddress: detailAddress.trim() || null,
        gpsLat: Number(gpsLat), gpsLon: Number(gpsLon), allowanceRange,
        lateThresholdMin: lateThresholdMin.trim() === "" ? null : Number(lateThresholdMin),
        amCapacity, pmCapacity, fullDayCapacity,
        businessContactName: businessContactName.trim(),
        businessContactPhone: businessContactPhone.trim(),
        businessContactEmail: businessContactEmail.trim() || null,
        ownerManagerId: ownerManagerId || "",
      };
      if (isCreate && isAdmin) payload.agencyId = agencyId;
      const res = await fetch(isCreate ? "/api/admin/sites" : `/api/admin/sites/${siteId}`, {
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

  async function onDelete() {
    if (!confirm("이 현장(사업체)을 비활성화하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      alert("비활성화 처리되었습니다.");
      onSaved();
    } catch { alert("처리에 실패했습니다."); }
  }

  async function onReactivate() {
    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      alert("활성화되었습니다.");
      onSaved();
    } catch { alert("처리에 실패했습니다."); }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
        <div className="w-full max-w-[62rem] max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
          {/* 헤더 */}
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-900">{isCreate ? "직무지도 현장(사업체) 신규 등록" : "직무지도 현장(사업체) 상세"}</h2>
              {item && (
                <p className="mt-0.5 text-[13px] font-semibold text-slate-400">
                  ID {item.id} · 기관 {item.agencyName} · <span className={`${T.badge} ${item.isActive ? "bg-sky-50 text-sky-600" : "bg-rose-50 text-rose-600"}`}>{item.isActive ? "활성" : "비활성"}</span>
                </p>
              )}
            </div>
            <button onClick={onClose} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
          </div>

          {!isCreate && (loading || !item) ? (
            <div className="flex h-60 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" /></div>
          ) : (
            <>
              {isCreate && isAdmin && (
                <div className={`${CARD} mb-5`}>
                  <label className={T.label}>기관 *</label>
                  <select value={agencyId} onChange={e => setAgencyId(e.target.value)} className={`w-full ${T.select}`}>
                    {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid gap-5 lg:grid-cols-2">
                {/* 기본 정보 */}
                <div className={CARD}>
                  <h3 className="mb-3 text-sm font-black text-slate-900">기본 정보</h3>
                  <div className="space-y-3">
                    <div>
                      <label className={T.label}>현장(사업체) *</label>
                      <input value={companyName} onChange={e => setCompanyName(e.target.value)} className={`w-full ${T.input}`} />
                    </div>
                    <div>
                      <label className={T.label}>주소 검색</label>
                      <div className="flex gap-2">
                        <input value={addrQ} onChange={e => setAddrQ(e.target.value)} onKeyDown={e => e.key === "Enter" && searchAddress()}
                          placeholder="예: 서울 중구 세종대로 110" className={`flex-1 ${T.input}`} />
                        <button onClick={searchAddress} disabled={addrLoading} className={T.btnSecondary}>{addrLoading ? "검색중..." : "주소검색"}</button>
                      </div>
                    </div>
                    {addrItems.length > 0 && (
                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        {addrItems.slice(0, 8).map((a, i) => (
                          <button key={i} onClick={() => pickAddress(a)} className="w-full border-b border-slate-50 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50">
                            <p className="font-semibold text-slate-700">{a.addressName}</p>
                          </button>
                        ))}
                      </div>
                    )}
                    <div>
                      <label className={T.label}>주소 *</label>
                      <input value={address} readOnly className={`w-full ${T.input} bg-slate-50`} placeholder="주소검색 후 지도에서 위치를 확정하세요" />
                    </div>
                    <div>
                      <label className={T.label}>상세주소</label>
                      <input value={detailAddress} onChange={e => setDetailAddress(e.target.value)} className={`w-full ${T.input}`} placeholder="동/호 등" />
                    </div>
                    <div>
                      <label className={T.label}>좌표(위도/경도)</label>
                      <div className="flex items-center gap-2">
                        <input value={gpsLat} readOnly className={`w-0 min-w-0 flex-1 ${T.input} bg-slate-50`} placeholder="위도" />
                        <input value={gpsLon} readOnly className={`w-0 min-w-0 flex-1 ${T.input} bg-slate-50`} placeholder="경도" />
                        {item && (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                            <span className="text-slate-400">기준점</span>
                            <span className={item.basePointConfirmed ? "font-bold text-emerald-600" : "font-bold text-amber-600"}>{item.basePointConfirmed ? "확정" : "미확정"}</span>
                          </span>
                        )}
                      </div>
                      <button onClick={() => { if (gpsLat && gpsLon) setMapPick({ lat: Number(gpsLat), lon: Number(gpsLon), address }); }}
                        className="mt-2 text-xs font-bold text-sky-600 hover:underline">지도에서 위치 다시 보기 · 조정</button>
                      <p className="mt-1 text-[11px] font-semibold text-rose-600">기준점의 최종 확정은 직무지도원이 해당 현장에서 실제 위치로 검증할 때 진행됩니다.</p>
                    </div>
                  </div>
                </div>

                {/* 사업체 담당자 + 업무 이관 담당자 */}
                <div className="space-y-5">
                  <div className={CARD}>
                    <h3 className="mb-1 text-sm font-black text-slate-900">사업체 담당자</h3>
                    <p className="mb-3 text-xs font-semibold text-slate-400">현장 측 담당자. 출근부 ‘사업체담당자’ 서명 요청에 자동 채워집니다.</p>
                    <div className="space-y-3">
                      <div><label className={T.label}>담당자 성명 *</label><input value={businessContactName} onChange={e => setBusinessContactName(e.target.value)} className={`w-full ${T.input}`} /></div>
                      <div><label className={T.label}>담당자 연락처 *</label><input value={businessContactPhone} onChange={e => setBusinessContactPhone(e.target.value)} className={`w-full ${T.input}`} placeholder="010-0000-0000" /></div>
                      <div><label className={T.label}>담당자 이메일 (선택)</label><input value={businessContactEmail} onChange={e => setBusinessContactEmail(e.target.value)} className={`w-full ${T.input}`} /></div>
                    </div>
                  </div>

                  <div className={CARD}>
                    <h3 className="mb-1 text-sm font-black text-slate-900">위탁기관 담당자 지정</h3>
                    <p className="mb-3 text-xs font-semibold text-slate-400">해당 직무지도 현장(사업체)를 담당하는 담당자를 지정합니다. 담당자 미지정인 경우 담당자 지정이 필요합니다.</p>
                    <select value={ownerManagerId} onChange={e => setOwnerManagerId(e.target.value)} className={`w-full ${T.select}`}>
                      <option value="">담당자 지정 필요</option>
                      {ownerManagers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* GPS 출퇴근 허용 범위 */}
              <div className={`${CARD} mt-5`}>
                <h3 className="mb-1 text-sm font-black text-slate-900">📍 GPS 출퇴근 허용 범위</h3>
                <p className="mb-3 text-xs font-semibold text-slate-400">직무지도원이 현장 반경 내에서만 출퇴근 처리할 수 있습니다. 범위를 벗어나면 위탁기관 승인이 필요합니다.</p>
                <div className="flex flex-wrap items-center gap-2">
                  {RANGE_PRESETS.map(v => (
                    <button key={v} type="button" onClick={() => setAllowanceRange(v)}
                      className={`rounded-xl border px-4 py-2 text-sm font-semibold transition active:scale-95 ${allowanceRange === v ? "border-slate-950 bg-slate-950 font-black text-white" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"}`}>{v}m</button>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-slate-500">직접 설정</span>
                    <input type="number" min={50} max={1000} value={allowanceRange} onChange={e => setAllowanceRange(Number(e.target.value) || 0)} className={`w-20 text-center ${T.input}`} />
                    <span className="text-sm font-semibold text-slate-500">m</span>
                  </div>
                  <span className="ml-auto text-sm font-bold text-slate-600">현재 설정 범위 : <span className="text-base font-black text-sky-600">반경 {allowanceRange}m</span></span>
                </div>
              </div>

              {/* 지각 인정 기준(현장별 — 비우면 기관 기본값) */}
              <div className={`${CARD} mt-5`}>
                <h3 className="mb-1 text-sm font-black text-slate-900">⏰ 지각 인정 기준</h3>
                <p className="mb-3 text-xs font-semibold text-slate-400">출근이 표준 시업시각보다 이 시간 이상 늦으면 <b>지각</b>으로 표시하고, (미컨펌 시) 급여 보류(보정대기)됩니다. <b>비우면 위탁기관 기본값</b>을 따릅니다.</p>
                <div className="flex flex-wrap items-center gap-2">
                  {[15, 30, 45, 60].map(v => (
                    <button key={v} type="button" onClick={() => setLateThresholdMin(String(v))}
                      className={`rounded-xl border px-4 py-2 text-sm font-semibold transition active:scale-95 ${lateThresholdMin === String(v) ? "border-slate-950 bg-slate-950 font-black text-white" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"}`}>{v}분</button>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-slate-500">직접 설정</span>
                    <input type="number" min={1} max={180} step={15} value={lateThresholdMin} onChange={e => setLateThresholdMin(e.target.value)} placeholder={`기관값 ${agencyDefaultLate}`} className={`w-24 text-center ${T.input}`} />
                    <span className="text-sm font-semibold text-slate-500">분</span>
                  </div>
                  <button type="button" onClick={() => setLateThresholdMin("")}
                    className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50">기관 기본값 사용</button>
                </div>
                <p className="mt-2 text-sm font-bold text-slate-600">
                  {lateThresholdMin.trim() === ""
                    ? <>현재 적용: <span className="text-sky-600">기관 기본값 {agencyDefaultLate}분</span></>
                    : <>현재 적용: <span className="text-sky-600">이 현장 {lateThresholdMin}분</span></>}
                </p>
              </div>

              {/* 근무형태별 필요 직무지도원 정원 */}
              <div className={`${CARD} mt-5`}>
                <h3 className="mb-1 text-sm font-black text-slate-900">👥 필요 직무지도원 정원</h3>
                <p className="mb-3 text-xs font-semibold text-slate-400">근무형태별로 이 현장에 필요한 직무지도원 수입니다. 배정 요청 화면의 충원 현황·필터에 사용됩니다. (0 = 해당 형태 불필요)</p>
                <div className="flex flex-wrap items-center gap-4">
                  {([["오전", amCapacity, setAmCapacity], ["오후", pmCapacity, setPmCapacity], ["전일", fullDayCapacity, setFullDayCapacity]] as const).map(([label, val, setter]) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-600">{label}</span>
                      <input type="number" min={0} max={99} value={val}
                        onChange={e => setter(Math.max(0, Math.min(99, Math.floor(Number(e.target.value)) || 0)))}
                        className={`w-20 text-center ${T.input}`} />
                      <span className="text-sm font-semibold text-slate-500">명</span>
                    </div>
                  ))}
                  <span className="ml-auto text-sm font-bold text-slate-600">총 정원 : <span className="text-base font-black text-sky-600">{amCapacity + pmCapacity + fullDayCapacity}명</span></span>
                </div>
              </div>

              {/* 액션 */}
              <div className="mt-5 flex items-center gap-2">
                {!isCreate && item && (item.isActive ? (
                  <button onClick={onDelete} className={T.btnDanger}>해당 직무지도 현장(사업체) 비활성화</button>
                ) : (
                  <button onClick={onReactivate} className="inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-black text-sky-600 transition active:scale-95">해당 직무지도 현장(사업체) 활성화</button>
                ))}
                <div className="ml-auto flex gap-2">
                  <button onClick={onClose} className={T.btnSecondary}>닫기</button>
                  <button onClick={onSave} disabled={saving} className={T.btnPrimary}>{saving ? (isCreate ? "등록 중..." : "저장 중...") : (isCreate ? "등록" : "변경사항 저장")}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <AddressMapPicker
        open={!!mapPick}
        initialLat={mapPick?.lat ?? 37.5665}
        initialLon={mapPick?.lon ?? 126.978}
        initialAddress={mapPick?.address ?? ""}
        onConfirm={(lat, lon, addr) => { setAddress(addr); setGpsLat(String(lat)); setGpsLon(String(lon)); setMapPick(null); }}
        onClose={() => setMapPick(null)}
      />
    </>
  );
}
