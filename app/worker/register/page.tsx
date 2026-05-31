"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  MapPin,
  Navigation,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import AddressMapPicker from "@/components/AddressMapPicker";

interface Trainee {
  id: string;
  name: string;
  gender: "남" | "여";
  birthDate: string;
  phoneNumber: string;
  guardianPhoneNumber: string;
}

interface GpsCoords { lat: number; lon: number; }

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

function SiteRegisterPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const isEdit = params.get("mode") === "edit";

  const [companyName, setCompanyName] = useState("");
  const [address, setAddress] = useState("");
  const [gps, setGps] = useState<GpsCoords | null>(null);
  const [mapPick, setMapPick] = useState<{ lat: number; lon: number; address: string } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  const [agencyName, setAgencyName] = useState("");
  const [managerName, setManagerName] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPhone, setManagerPhone] = useState("");

  const [noPreTraining, setNoPreTraining] = useState(false);
  const [noFieldTraining, setNoFieldTraining] = useState(false);
  const [preStart, setPreStart] = useState("");
  const [preEnd, setPreEnd] = useState("");
  const [fieldStart, setFieldStart] = useState("");
  const [fieldEnd, setFieldEnd] = useState("");

  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [traineeForm, setTraineeForm] = useState<Omit<Trainee, "id">>({
    name: "", gender: "남", birthDate: "", phoneNumber: "", guardianPhoneNumber: "",
  });

  const [addrQuery, setAddrQuery] = useState("");
  const [addrResults, setAddrResults] = useState<any[]>([]);
  const [addrLoading, setAddrLoading] = useState(false);
  const [showAddrSearch, setShowAddrSearch] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 현재 위치 중심으로 지도를 열어 핀으로 사이트 위치를 확정한다 (현장에 있을 때 편리)
  const openMapAtCurrent = useCallback(async () => {
    setGpsLoading(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 10000,
        });
      });
      setMapPick({ lat: pos.coords.latitude, lon: pos.coords.longitude, address });
    } catch {
      alert("위치를 가져올 수 없습니다. 브라우저 위치 권한을 허용해주세요.");
    } finally {
      setGpsLoading(false);
    }
  }, [address]);

  async function searchAddress() {
    if (!addrQuery.trim()) return;
    setAddrLoading(true);
    try {
      const res = await fetch(`/api/geo/search-address?q=${encodeURIComponent(addrQuery)}`);
      const data = await res.json();
      setAddrResults(data.documents || []);
    } catch {
      alert("주소 검색에 실패했습니다.");
    } finally {
      setAddrLoading(false);
    }
  }

  function selectAddress(item: any) {
    // 주소 선택 → 지도에서 핀으로 위치 확인 후 확정
    setMapPick({
      lat: parseFloat(item.y),
      lon: parseFloat(item.x),
      address: item.addressName || item.address_name || "",
    });
    setShowAddrSearch(false);
    setAddrResults([]);
    setAddrQuery("");
  }

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!companyName.trim()) { setError("사업체명을 입력해주세요."); return; }
    if (!address.trim()) { setError("주소를 입력해주세요."); return; }
    if (!gps) { setError("주소를 검색하거나 '현재 위치로 지도 열기'로 위치를 지도에서 확정해주세요."); return; }
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
        trainees: trainees.map(t => ({
          name: t.name, gender: t.gender, birthDate: t.birthDate,
          phoneNumber: t.phoneNumber.replace(/-/g, ""),
          guardianPhoneNumber: t.guardianPhoneNumber.replace(/-/g, "") || null,
        })),
      };
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

  const inputCls = "h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100 disabled:text-slate-400";
  const labelCls = "mb-2 block text-xs font-black uppercase tracking-wide text-slate-500";

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-md pb-10">

        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-4">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-base font-black text-slate-900">
            {isEdit ? "현장 수정" : "현장 등록"}
          </h1>
        </header>

        {isEdit && (
          <div className="mx-4 mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold leading-relaxed text-amber-700">
            수정 모드에서는 주소/사업체명 변경이 불가합니다. 변경이 필요하면 관리자 승인 절차로 요청해 주세요.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 px-4 pt-3">

          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className={labelCls}>1. 직무지도 현장 정보</p>

            <div className="mb-4">
              <label className="mb-2 block text-xs font-black text-slate-700">주소 *</label>
              {!isEdit ? (
                <>
                  <div className="flex gap-2">
                    <div className="flex min-h-12 flex-1 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-500">
                      {address || "주소를 검색해주세요"}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddrSearch(true)}
                      className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 transition active:scale-95"
                    >
                      <Search className="h-3.5 w-3.5" aria-hidden="true" />
                      검색
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex min-h-12 items-center rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm font-semibold text-slate-500">
                  {address}
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-xs font-black text-slate-700">근무 사업체명 *</label>
              <input
                className={inputCls}
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="예: 서울시청"
                disabled={isEdit}
                required
              />
            </div>

            {/* 위치: 지도 핀으로 확정된 사이트 위치를 명확히 표시 (저장되는 값) */}
            {gps ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-black text-emerald-700">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> 위치 확정됨
                </div>
                <p className="mt-1 text-[11px] font-semibold leading-relaxed text-slate-500">
                  지도에서 선택한 이 위치가 저장됩니다 · {gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}
                </p>
                {!isEdit && (
                  <button
                    type="button"
                    onClick={() => setMapPick({ lat: gps.lat, lon: gps.lon, address })}
                    className="mt-2 text-xs font-black text-emerald-700 underline underline-offset-2 active:scale-95"
                  >
                    지도에서 위치 다시 선택
                  </button>
                )}
              </div>
            ) : !isEdit ? (
              <button
                type="button"
                onClick={openMapAtCurrent}
                disabled={gpsLoading}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-3 text-sm font-black text-slate-700 transition active:scale-[0.97] disabled:opacity-60"
              >
                <Navigation className="h-4 w-4" aria-hidden="true" />
                {gpsLoading ? "위치 확인 중..." : "현재 위치로 지도 열기"}
              </button>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className={labelCls}>2. 담당자 정보</p>
            <div className="space-y-3">
              <div>
                <label className="mb-2 block text-xs font-black text-slate-700">주관 기관명</label>
                <input className={inputCls} value={agencyName} onChange={e => setAgencyName(e.target.value)} placeholder="예: 다음미래" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-black text-slate-700">담당자명 *</label>
                <input className={inputCls} value={managerName} onChange={e => setManagerName(e.target.value)} placeholder="홍길동" required />
              </div>
              <div>
                <label className="mb-2 block text-xs font-black text-slate-700">담당자 이메일 *</label>
                <input className={inputCls} type="email" value={managerEmail} onChange={e => setManagerEmail(e.target.value)} placeholder="example@email.com" required />
              </div>
              <div>
                <label className="mb-2 block text-xs font-black text-slate-700">담당자 전화번호</label>
                <input className={inputCls} type="tel" value={managerPhone} onChange={e => setManagerPhone(e.target.value)} placeholder="01012345678" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className={labelCls}>3. 훈련 기간 설정</p>

            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-black text-slate-700">사전 훈련기간</span>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" className="sr-only" checked={noPreTraining} onChange={e => setNoPreTraining(e.target.checked)} />
                  <div className={`relative h-5 w-9 rounded-full transition-colors ${noPreTraining ? "bg-sky-500" : "bg-slate-300"}`}>
                    <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${noPreTraining ? "translate-x-4" : "translate-x-0.5"}`} />
                  </div>
                  <span className="text-xs font-semibold text-slate-500">없음</span>
                </label>
              </div>
              {!noPreTraining && (
                <div className="flex items-center gap-2">
                  <input className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" type="date" value={preStart} onChange={e => setPreStart(e.target.value)} />
                  <span className="text-xs font-semibold text-slate-400">~</span>
                  <input className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" type="date" value={preEnd} onChange={e => setPreEnd(e.target.value)} />
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-black text-slate-700">현장 훈련기간</span>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" className="sr-only" checked={noFieldTraining} onChange={e => setNoFieldTraining(e.target.checked)} />
                  <div className={`relative h-5 w-9 rounded-full transition-colors ${noFieldTraining ? "bg-sky-500" : "bg-slate-300"}`}>
                    <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${noFieldTraining ? "translate-x-4" : "translate-x-0.5"}`} />
                  </div>
                  <span className="text-xs font-semibold text-slate-500">없음</span>
                </label>
              </div>
              {!noFieldTraining && (
                <div className="flex items-center gap-2">
                  <input className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" type="date" value={fieldStart} onChange={e => setFieldStart(e.target.value)} />
                  <span className="text-xs font-semibold text-slate-400">~</span>
                  <input className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" type="date" value={fieldEnd} onChange={e => setFieldEnd(e.target.value)} />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className={labelCls}>4. 근무 형태</p>
            <p className="text-xs font-semibold leading-relaxed text-slate-500">
              근무 형태(오전/오후/전일)와 출퇴근 지도 여부는 에이전시 관리자가 설정합니다.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className={labelCls}>5. 훈련생 관리</p>

            <div className="mb-4 space-y-2.5">
              <div className="flex gap-2">
                <input
                  className="h-12 flex-[2] rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
                  placeholder="성명 *"
                  value={traineeForm.name}
                  onChange={e => setTraineeForm(f => ({ ...f, name: e.target.value }))}
                />
                <div className="flex gap-1">
                  {(["남", "여"] as const).map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setTraineeForm(f => ({ ...f, gender: g }))}
                      className={`h-12 w-12 rounded-xl border text-sm font-black transition active:scale-95 ${
                        traineeForm.gender === g
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-500"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <input
                className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
                placeholder="생년월일 (YYYY.MM.DD) *"
                value={formatBirth(traineeForm.birthDate)}
                onChange={e => setTraineeForm(f => ({ ...f, birthDate: e.target.value.replace(/\D/g, "") }))}
                inputMode="numeric"
              />
              <input
                className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
                placeholder="전화번호 *"
                value={traineeForm.phoneNumber}
                onChange={e => setTraineeForm(f => ({ ...f, phoneNumber: e.target.value }))}
                type="tel"
              />
              <input
                className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
                placeholder="보호자 전화 (선택)"
                value={traineeForm.guardianPhoneNumber}
                onChange={e => setTraineeForm(f => ({ ...f, guardianPhoneNumber: e.target.value }))}
                type="tel"
              />
              <button
                type="button"
                onClick={addTrainee}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-700 text-sm font-black text-white transition active:scale-[0.97]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                훈련생 추가
              </button>
            </div>

            <div className="space-y-2">
              {trainees.map(t => (
                <div key={t.id} className="flex items-start justify-between rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div>
                    <p className="text-sm font-black text-slate-900">{t.name} ({t.gender})</p>
                    <p className="mt-0.5 text-xs font-semibold text-slate-400">
                      {t.birthDate.slice(0, 4)}.{t.birthDate.slice(4, 6)}.{t.birthDate.slice(6)} | {t.phoneNumber}
                    </p>
                    {t.guardianPhoneNumber && (
                      <p className="mt-0.5 text-xs font-semibold text-slate-400">보호자: {t.guardianPhoneNumber}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeTrainee(t.id)}
                    className="ml-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-rose-400 transition hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
              {trainees.length === 0 && (
                <p className="py-4 text-center text-xs font-semibold text-slate-400">추가된 훈련생이 없습니다.</p>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-center text-sm font-semibold text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-slate-950 text-base font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-70"
          >
            {loading ? "저장 중..." : isEdit ? "수정 완료" : "등록 완료"}
          </button>

        </form>
      </div>

      {showAddrSearch && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-slate-950/50"
          onClick={() => setShowAddrSearch(false)}
        >
          <div
            className="mt-auto flex max-h-[80dvh] w-full flex-col rounded-t-3xl bg-white"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="text-base font-black text-slate-900">주소 검색</span>
              <button
                onClick={() => setShowAddrSearch(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex gap-2 px-4 py-3">
              <input
                className="h-11 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                placeholder="도로명, 건물명, 지번 검색"
                value={addrQuery}
                onChange={e => setAddrQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && searchAddress()}
                autoFocus
              />
              <button
                onClick={searchAddress}
                disabled={addrLoading}
                className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 text-sm font-black text-white transition active:scale-95 disabled:opacity-60"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                {addrLoading ? "..." : "검색"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {addrResults.length === 0 ? (
                <p className="py-8 text-center text-sm font-semibold text-slate-400">검색 결과가 없습니다.</p>
              ) : (
                addrResults.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => selectAddress(item)}
                    className="flex w-full flex-col border-b border-slate-50 px-5 py-3.5 text-left transition hover:bg-slate-50 active:bg-slate-100"
                  >
                    <span className="text-sm font-semibold text-slate-800">
                      {item.addressName || item.address_name}
                    </span>
                    {item.roadAddress?.addressName && (
                      <span className="mt-0.5 text-xs font-semibold text-sky-600">{item.roadAddress.addressName}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <AddressMapPicker
        open={!!mapPick}
        initialLat={mapPick?.lat ?? 37.5665}
        initialLon={mapPick?.lon ?? 126.978}
        initialAddress={mapPick?.address ?? ""}
        onConfirm={(lat, lon, addr) => {
          setAddress(addr);
          setGps({ lat, lon });
          setMapPick(null);
        }}
        onClose={() => setMapPick(null)}
      />
    </div>
  );
}

export default function SiteRegisterPage() {
  return (
    <Suspense>
      <SiteRegisterPageInner />
    </Suspense>
  );
}
