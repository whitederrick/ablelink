// app/admin/sites/new/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { T } from "../../_styles";
import PageHeader from "../../_components/PageHeader";
import AddressMapPicker from "@/components/AddressMapPicker";

type MeResponse =
  | { success: true; session: { role: "ADMIN" | "GOV" | "AGENCY"; agencyName?: string | null } }
  | { success: false };

type AgencyOption = { id: string; name: string };

type AddrItem = { addressName: string; x: string; y: string };

export default function AdminSiteNewPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = (me as any)?.success === true && (me as any).session?.role === "ADMIN";

  const [agencies, setAgencies] = useState<AgencyOption[]>([]);
  const [agencyId, setAgencyId] = useState<string>("");

  const [form, setForm] = useState({
    companyName: "",
    address: "",
    detailAddress: "",
    gpsLat: "",
    gpsLon: "",
    businessContactName: "",
    businessContactPhone: "",
  });
  const [allowanceRange, setAllowanceRange] = useState(100);
  const [requiredProfession, setRequiredProfession] = useState<string>("JOB_COACH");

  const [addrQ, setAddrQ] = useState("");
  const [addrLoading, setAddrLoading] = useState(false);
  const [addrItems, setAddrItems] = useState<AddrItem[]>([]);
  const [mapPick, setMapPick] = useState<{ lat: number; lon: number; address: string } | null>(null);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/admin/auth/me", { cache: "no-store" });
      const d = await r.json();
      setMe(d);
    })();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const r = await fetch("/api/admin/sites/options", { cache: "no-store" });
      const d = await r.json();
      if (d?.success) {
        const a = (d.options?.agencies || []) as AgencyOption[];
        setAgencies(a);
        if (!agencyId && a.length > 0) setAgencyId(a[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function searchAddress() {
    if (!addrQ.trim()) return;
    setAddrLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set("q", addrQ.trim());
      const r = await fetch(`/api/geo/search-address?${sp.toString()}`, { cache: "no-store" });
      const d = await r.json();
      const items: AddrItem[] =
        d?.items?.map((x: any) => ({ addressName: x.addressName ?? x.address_name, x: x.x, y: x.y })) ||
        d?.documents?.map((x: any) => ({ addressName: x.addressName ?? x.address_name, x: x.x, y: x.y })) ||
        [];
      setAddrItems(items);
      if (items.length === 0) alert("주소 검색 결과가 없습니다.");
    } catch (e) {
      console.error(e);
      alert("주소 검색 실패");
    } finally {
      setAddrLoading(false);
    }
  }

  function pickAddress(it: AddrItem) {
    // 주소 선택 → 지도에서 핀으로 위치 확인 후 확정
    setMapPick({ lat: parseFloat(it.y), lon: parseFloat(it.x), address: it.addressName });
    setAddrItems([]);
  }

  async function saveSite() {
    if (saving) return;
    if (!form.companyName.trim()) return alert("사업체명은 필수입니다.");
    if (!form.address.trim()) return alert("주소는 필수입니다.");
    if (!form.gpsLat.trim() || !form.gpsLon.trim()) return alert("좌표(gpsLat/gpsLon)는 필수입니다.");
    if (!form.businessContactName.trim()) return alert("사업체 담당자 성명은 필수입니다.");
    if (!form.businessContactPhone.trim()) return alert("사업체 담당자 연락처는 필수입니다.");
    if (isAdmin && !agencyId) return alert("기관을 선택하십시오(ADMIN).");

    setSaving(true);
    try {
      const payload: any = {
        companyName: form.companyName.trim(),
        address: form.address.trim(),
        detailAddress: form.detailAddress.trim() ? form.detailAddress.trim() : null,
        gpsLat: form.gpsLat.trim(),
        gpsLon: form.gpsLon.trim(),
        allowanceRange,
        businessContactName: form.businessContactName.trim(),
        businessContactPhone: form.businessContactPhone.trim(),
        requiredProfession,
      };
      if (isAdmin) payload.agencyId = agencyId;
      const r = await fetch("/api/admin/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!d?.success) throw new Error(d?.message || "FAILED");
      alert("등록 완료");
      location.href = "/admin/sites";
    } catch (e) {
      console.error(e);
      alert("등록 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="현장(Site) 신규 등록"
        actions={<Link href="/admin/sites" className={T.btnSecondary}>← 목록으로</Link>}
      />

      <div className="space-y-4">
        {isAdmin && (
          <div className={T.card}>
            <label className={T.label}>기관</label>
            <select
              value={agencyId}
              onChange={(e) => { setAgencyId(e.target.value); }}
              className={`w-full ${T.select}`}
            >
              {agencies.map((a) => (
                <option key={a.id} value={a.id}>{a.name} (#{a.id})</option>
              ))}
            </select>
          </div>
        )}

        <div className={T.card}>
          <label className={T.label}>직종(카테고리) *</label>
          <select
            value={requiredProfession}
            onChange={(e) => setRequiredProfession(e.target.value)}
            className={`w-full ${T.select}`}
          >
            {/* 매칭은 현재 직무지도원 직종만 운영(요양보호사·활동지원사 비노출) */}
            <option value="JOB_COACH">직무지도원</option>
          </select>
          <p className="mt-1 text-xs font-semibold text-slate-400">현장에 필요한 직종 구분입니다. 직무지도원 배정 시 같은 직종으로 필터됩니다.</p>
        </div>

        <div className={T.card}>
          <p className="mb-4 text-sm font-black text-slate-900">기본 정보</p>
          <div className="space-y-3">
            <div>
              <label className={T.label}>사업체명 *</label>
              <input
                value={form.companyName}
                onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))}
                className={`w-full ${T.input}`}
                placeholder="사업체명"
              />
            </div>

            <div>
              <label className={T.label}>주소 검색 *</label>
              <div className="flex gap-2">
                <input
                  value={addrQ}
                  onChange={(e) => setAddrQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchAddress()}
                  className={`flex-1 ${T.input}`}
                  placeholder="주소 검색어 입력 (예: 서울 중구 세종대로 110)"
                />
                <button onClick={searchAddress} disabled={addrLoading} className={T.btnSecondary}>
                  {addrLoading ? "검색중..." : "주소검색"}
                </button>
              </div>
            </div>

            {addrItems.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                {addrItems.slice(0, 8).map((it, idx) => (
                  <button
                    key={idx}
                    onClick={() => pickAddress(it)}
                    className="w-full border-b border-slate-50 last:border-b-0 px-4 py-3 text-left text-sm transition hover:bg-slate-50"
                  >
                    <p className="font-semibold text-slate-700">{it.addressName}</p>
                    <p className="text-xs text-slate-400 mt-0.5">lat={it.y} / lon={it.x}</p>
                  </button>
                ))}
              </div>
            )}

            <div>
              <label className={T.label}>선택된 주소 *</label>
              <input value={form.address} readOnly className={`w-full ${T.input} bg-slate-50`} />
            </div>

            <div>
              <label className={T.label}>상세주소</label>
              <input
                value={form.detailAddress}
                onChange={(e) => setForm((p) => ({ ...p, detailAddress: e.target.value }))}
                className={`w-full ${T.input}`}
                placeholder="상세주소(동/호 등)"
              />
            </div>

            <div>
              <label className={T.label}>좌표 *</label>
              <div className="flex gap-2">
                <input value={form.gpsLat} readOnly className={`flex-1 ${T.input} bg-slate-50`} placeholder="gpsLat (주소 검색 후 자동입력)" />
                <input value={form.gpsLon} readOnly className={`flex-1 ${T.input} bg-slate-50`} placeholder="gpsLon (주소 검색 후 자동입력)" />
              </div>
            </div>
          </div>
        </div>

        <div className={T.card}>
          <p className="mb-1 text-sm font-black text-slate-900">GPS 출퇴근 허용 범위 *</p>
          <p className="mb-3 text-xs font-semibold text-slate-400">범위를 벗어나면 에이전시 승인이 필요합니다.</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {[50, 100, 150, 200, 300, 500].map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setAllowanceRange(v)}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition active:scale-95 ${
                  allowanceRange === v
                    ? "border-slate-950 bg-slate-950 font-black text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {v}m
              </button>
            ))}
          </div>
          <p className="text-xs font-semibold text-slate-400">
            현재 설정: <span className="font-black text-sky-600">반경 {allowanceRange}m</span>
          </p>
        </div>

        {/* 사업체 담당자(현장 회사의 연락 담당자) — 출근부 '사업체담당자' 서명요청에 자동 채움 */}
        <div className={T.card}>
          <p className="mb-1 text-sm font-black text-slate-900">사업체 담당자 *</p>
          <p className="mb-3 text-xs font-semibold text-slate-400">
            현장(사업체) 측 담당자입니다. 출근부 ‘사업체담당자’ 서명 요청 시 이 정보가 자동으로 채워집니다.
          </p>
          <div className="space-y-3">
            <div>
              <label className={T.label}>담당자 성명 *</label>
              <input
                value={form.businessContactName}
                onChange={(e) => setForm((p) => ({ ...p, businessContactName: e.target.value }))}
                className={`w-full ${T.input}`}
                placeholder="예: 홍길동 과장"
              />
            </div>
            <div>
              <label className={T.label}>담당자 연락처 *</label>
              <input
                value={form.businessContactPhone}
                onChange={(e) => setForm((p) => ({ ...p, businessContactPhone: e.target.value }))}
                className={`w-full ${T.input}`}
                placeholder="010-0000-0000"
              />
            </div>
          </div>
        </div>

        <button onClick={saveSite} disabled={saving} className={`w-full py-4 text-base ${T.btnPrimary}`}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>

      <AddressMapPicker
        open={!!mapPick}
        initialLat={mapPick?.lat ?? 37.5665}
        initialLon={mapPick?.lon ?? 126.978}
        initialAddress={mapPick?.address ?? ""}
        onConfirm={(lat, lon, addr) => {
          setForm((p) => ({ ...p, address: addr, gpsLat: String(lat), gpsLon: String(lon) }));
          setMapPick(null);
        }}
        onClose={() => setMapPick(null)}
      />
    </div>
  );
}
