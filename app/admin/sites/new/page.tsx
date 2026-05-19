// app/admin/sites/new/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

  // 주소 검색
  const [addrQ, setAddrQ] = useState("");
  const [addrLoading, setAddrLoading] = useState(false);
  const [addrItems, setAddrItems] = useState<AddrItem[]>([]);

  // 담당자 신규 등록 모달
  const [openMgr, setOpenMgr] = useState(false);
  const [mgrForm, setMgrForm] = useState({ name: "", email: "", phoneNumber: "" });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/admin/auth/me", { cache: "no-store" });
      const d = await r.json();
      setMe(d);
    })();
  }, []);

  // ADMIN이면 기관 옵션 필요 (기존 /api/admin/sites/options 사용)
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
    return true; // AGENCY는 자기 기관 스코프로 조회됨
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

      // 기존 geo 검색 API를 사용(프로젝트에 이미 존재)
      const r = await fetch(`/api/geo/search-address?${sp.toString()}`, { cache: "no-store" });
      const d = await r.json();

      // 응답 구조가 프로젝트마다 다를 수 있어 방어적으로 처리
      const items: AddrItem[] =
        d?.items?.map((x: any) => ({ addressName: x.addressName ?? x.address_name, x: x.x, y: x.y })) ||
        d?.documents?.map((x: any) => ({ addressName: x.address_name, x: x.x, y: x.y })) ||
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
    setForm((p) => ({
      ...p,
      address: it.addressName,
      gpsLat: String(it.y), // 위도
      gpsLon: String(it.x), // 경도
    }));
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

      // 방금 만든 담당자 자동 선택
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

      // ADMIN이면 agencyId 전달 (AGENCY는 토큰 스코프로 처리 가능하지만, sites API가 agencyId/name 입력을 허용하는 경우 대비)
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
    <div style={{ padding: 16, maxWidth: 980 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 18, fontWeight: 800 }}>Site 신규 등록</h1>
        <Link href="/admin/sites" style={{ fontSize: 13, color: "#111827" }}>
          ← 목록으로
        </Link>
      </div>

      {isAdmin ? (
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ width: 90, fontSize: 13, color: "#555" }}>기관</div>
          <select
            value={agencyId}
            onChange={(e) => {
              setAgencyId(e.target.value);
              setManagerId("");
            }}
            style={sel}
          >
            {agencies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} (#{a.id})
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <div style={row}>
          <div style={lbl}>사업체명*</div>
          <input
            value={form.companyName}
            onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))}
            style={inp}
            placeholder="사업체명"
          />
        </div>

        <div style={row}>
          <div style={lbl}>주소*</div>
          <div style={{ flex: 1, display: "flex", gap: 8 }}>
            <input
              value={addrQ}
              onChange={(e) => setAddrQ(e.target.value)}
              style={inp}
              placeholder="주소 검색어 입력 (예: 서울 중구 세종대로 110)"
            />
            <button onClick={searchAddress} style={btn} disabled={addrLoading}>
              {addrLoading ? "검색중..." : "주소검색"}
            </button>
          </div>
        </div>

        {addrItems.length > 0 ? (
          <div style={{ border: "1px solid #e5e5e5", borderRadius: 10, overflow: "hidden" }}>
            {addrItems.slice(0, 8).map((it, idx) => (
              <div
                key={idx}
                onClick={() => pickAddress(it)}
                style={{
                  padding: 10,
                  borderBottom: "1px solid #f0f0f0",
                  cursor: "pointer",
                  fontSize: 13,
                  background: "#fff",
                }}
              >
                {it.addressName}
                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  lat={it.y} / lon={it.x}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div style={row}>
          <div style={lbl}>선택된 주소*</div>
          <input value={form.address} readOnly style={{ ...inp, background: "#f9fafb" }} />
        </div>

        <div style={row}>
          <div style={lbl}>상세주소</div>
          <input
            value={form.detailAddress}
            onChange={(e) => setForm((p) => ({ ...p, detailAddress: e.target.value }))}
            style={inp}
            placeholder="상세주소(동/호 등)"
          />
        </div>

        <div style={row}>
          <div style={lbl}>좌표*</div>
          <div style={{ flex: 1, display: "flex", gap: 8 }}>
            <input value={form.gpsLat} readOnly style={{ ...inp, background: "#f9fafb" }} placeholder="gpsLat (주소 검색 후 자동입력)" />
            <input value={form.gpsLon} readOnly style={{ ...inp, background: "#f9fafb" }} placeholder="gpsLon (주소 검색 후 자동입력)" />
          </div>
        </div>

        <div style={row}>
          <div style={lbl}>GPS 허용 범위*</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {[50, 100, 150, 200, 300, 500].map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAllowanceRange(v)}
                  style={{
                    padding: "8px 14px",
                    border: `1.5px solid ${allowanceRange === v ? "#5865F2" : "#eee"}`,
                    borderRadius: 8,
                    backgroundColor: allowanceRange === v ? "#f0f2ff" : "#fff",
                    color: allowanceRange === v ? "#5865F2" : "#555",
                    fontWeight: allowanceRange === v ? 700 : 400,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {v}m
                </button>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
              현재 설정: <strong style={{ color: "#5865F2" }}>반경 {allowanceRange}m</strong>
              {" "}— 이 범위를 벗어나면 에이전시 승인이 필요합니다.
            </p>
          </div>
        </div>

        <div style={row}>
          <div style={lbl}>담당자*</div>
          <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              style={sel}
              disabled={!canLoadManagers}
            >
              <option value="">선택</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} / {m.email} / {m.phoneNumber ?? "-"} (#{m.id})
                </option>
              ))}
            </select>
            <button onClick={() => setOpenMgr(true)} style={btn}>
              담당자 신규 등록
            </button>
          </div>
        </div>

        <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={saveSite} style={btnPrimary} disabled={saving}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {openMgr ? (
        <div style={modalBack}>
          <div style={modalCard}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>담당자 신규 등록</div>

            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              <input
                value={mgrForm.name}
                onChange={(e) => setMgrForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="성명*"
                style={inp}
              />
              <input
                value={mgrForm.email}
                onChange={(e) => setMgrForm((p) => ({ ...p, email: e.target.value }))}
                placeholder="이메일*"
                style={inp}
              />
              <input
                value={mgrForm.phoneNumber}
                onChange={(e) => setMgrForm((p) => ({ ...p, phoneNumber: e.target.value }))}
                placeholder="전화번호*"
                style={inp}
              />
              <div style={{ fontSize: 12, color: "#666" }}>
                저장 후 자동으로 선택됩니다.
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setOpenMgr(false)}
                style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: 8, background: "#fff" }}
              >
                취소
              </button>
              <button onClick={createManager} style={btnPrimary}>
                저장
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const row: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center" };
const lbl: React.CSSProperties = { width: 90, fontSize: 13, color: "#555" };

const inp: React.CSSProperties = {
  flex: 1,
  padding: 10,
  border: "1px solid #d1d5db",
  borderRadius: 10,
  fontSize: 13,
  background: "#fff",
};

const sel: React.CSSProperties = {
  flex: 1,
  padding: 10,
  border: "1px solid #d1d5db",
  borderRadius: 10,
  fontSize: 13,
  background: "#fff",
};

const btn: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  background: "#fff",
  fontSize: 13,
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  border: "1px solid #111827",
  borderRadius: 10,
  background: "#111827",
  color: "#fff",
  fontSize: 13,
};

const modalBack: React.CSSProperties = {
  position: "fixed",
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modalCard: React.CSSProperties = {
  width: "min(520px, 100%)",
  background: "#fff",
  borderRadius: 12,
  padding: 16,
  border: "1px solid #e5e5e5",
};
