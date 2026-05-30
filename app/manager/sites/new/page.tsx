// app/admin/sites/new/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { T } from "../../_styles";
import AddressMapPicker from "@/components/AddressMapPicker";

type MeResponse =
  | { success: true; session: { role: "ADMIN" | "GOV" | "AGENCY"; agencyName?: string | null } }
  | { success: false };

type AgencyOption = { id: string; name: string };
type ManagerItem = { id: string; name: string; email: string; phoneNumber: string | null; agencyName?: string | null };

type AddrItem = { addressName: string; x: string; y: string };

export default function AdminSiteNewPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = (me as any)?.success === true && (me as any).session?.role === "ADMIN";

  const [agencies, setAgencies] = useState<AgencyOption[]>([]);
  const [agencyId, setAgencyId] = useState<string>("");

  const [managers, setManagers] = useState<ManagerItem[]>([]);
  const [managerId, setManagerId] = useState<string>("");

  const [form, setForm] = useState({
    companyName: "",
    address: "",
    detailAddress: "",
    gpsLat: "",
    gpsLon: "",
  });
  const [allowanceRange, setAllowanceRange] = useState(100);

  const [addrQ, setAddrQ] = useState("");
  const [addrLoading, setAddrLoading] = useState(false);
  const [addrItems, setAddrItems] = useState<AddrItem[]>([]);
  const [mapPick, setMapPick] = useState<{ lat: number; lon: number; address: string } | null>(null);

  const [openMgr, setOpenMgr] = useState(false);
  const [mgrForm, setMgrForm] = useState({ name: "", email: "", phoneNumber: "" });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/manager/auth/me", { cache: "no-store" });
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

  const canLoadManagers = useMemo(() => {
    if (!me || (me as any)?.success !== true) return false;
    if (isAdmin) return !!agencyId;
    return true;
  }, [me, isAdmin, agencyId]);

  async function fetchManagers() {
    if (!canLoadManagers) return;
    const sp = new URLSearchParams();
    if (isAdmin) sp.set("agencyId", agencyId);
    const r = await fetch(`/api/admin/managers?${sp.toString()}`, { cache: "no-store" });
    const d = await r.json();
    if (d?.success) {
      const list = (d.items || []) as ManagerItem[];
      setManagers(list);
      if (!managerId && list.length > 0) setManagerId(list[0].id);
    } else {
      setManagers([]);
    }
  }

  useEffect(() => {
    fetchManagers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoadManagers, agencyId]);

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

  async function createManager() {
    if (!mgrForm.name.trim() || !mgrForm.email.trim() || !mgrForm.phoneNumber.trim()) {
      alert("담당자 성명/이메일/전화는 필수입니다.");
      return;
    }
    try {
      const payload: any = {
        name: mgrForm.name.trim(),
        email: mgrForm.email.trim(),
        phoneNumber: mgrForm.phoneNumber.trim(),
      };
      if (isAdmin) payload.agencyId = agencyId;
      const r = await fetch("/api/admin/managers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!d?.success) throw new Error(d?.message || "FAILED");
      setOpenMgr(false);
      setMgrForm({ name: "", email: "", phoneNumber: "" });
      await fetchManagers();
      if (d?.item?.id) setManagerId(String(d.item.id));
    } catch (e) {
      console.error(e);
      alert("담당자 등록 실패(이메일 중복 등)");
    }
  }

  async function saveSite() {
    if (saving) return;
    if (!form.companyName.trim()) return alert("사업체명은 필수입니다.");
    if (!form.address.trim()) return alert("주소는 필수입니다.");
    if (!form.gpsLat.trim() || !form.gpsLon.trim()) return alert("좌표(gpsLat/gpsLon)는 필수입니다.");
    if (!managerId) return alert("담당자를 선택하거나 신규 등록하십시오.");
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
        managerId,
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
      location.href = "/manager/sites";
    } catch (e) {
      console.error(e);
      alert("등록 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className={T.pageTitle}>Site 신규 등록</h1>
        <Link href="/manager/sites" className={T.btnSecondary}>← 목록으로</Link>
      </div>

      <div className="space-y-4">
        {isAdmin && (
          <div className={T.card}>
            <label className={T.label}>기관</label>
            <select
              value={agencyId}
              onChange={(e) => { setAgencyId(e.target.value); setManagerId(""); }}
              className={`w-full ${T.select}`}
            >
              {agencies.map((a) => (
                <option key={a.id} value={a.id}>{a.name} (#{a.id})</option>
              ))}
            </select>
          </div>
        )}

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

        <div className={T.card}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-black text-slate-900">담당자 *</p>
            <button onClick={() => setOpenMgr(true)} className={T.btnSecondary}>+ 신규 등록</button>
          </div>
          <select
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            className={`w-full ${T.select}`}
            disabled={!canLoadManagers}
          >
            <option value="">선택</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} / {m.email} / {m.phoneNumber ?? "-"} (#{m.id})
              </option>
            ))}
          </select>
        </div>

        <button onClick={saveSite} disabled={saving} className={`w-full py-4 text-base ${T.btnPrimary}`}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>

      {openMgr && (
        <div className={T.modalOverlay}>
          <div className={T.modalContent}>
            <h2 className="mb-5 text-base font-black text-slate-900">담당자 신규 등록</h2>
            <div className="space-y-3">
              <div>
                <label className={T.label}>성명 *</label>
                <input
                  value={mgrForm.name}
                  onChange={(e) => setMgrForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="성명"
                  className={`w-full ${T.input}`}
                />
              </div>
              <div>
                <label className={T.label}>이메일 *</label>
                <input
                  value={mgrForm.email}
                  onChange={(e) => setMgrForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="이메일"
                  className={`w-full ${T.input}`}
                />
              </div>
              <div>
                <label className={T.label}>전화번호 *</label>
                <input
                  value={mgrForm.phoneNumber}
                  onChange={(e) => setMgrForm((p) => ({ ...p, phoneNumber: e.target.value }))}
                  placeholder="전화번호"
                  className={`w-full ${T.input}`}
                />
              </div>
              <p className="text-xs font-semibold text-slate-400">저장 후 자동으로 선택됩니다.</p>
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setOpenMgr(false)} className={T.btnSecondary}>취소</button>
              <button onClick={createManager} className={T.btnPrimary}>저장</button>
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
          setForm((p) => ({ ...p, address: addr, gpsLat: String(lat), gpsLon: String(lon) }));
          setMapPick(null);
        }}
        onClose={() => setMapPick(null)}
      />
    </div>
  );
}
