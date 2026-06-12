"use client";

// 직무지도 매칭 — 수요측 공고 등록 (에이전시 매니저)
import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "../../_styles";
import PageHeader from "../../_components/PageHeader";
import AddressMapPicker from "@/components/AddressMapPicker";

type AddrItem = { addressName: string; x: string; y: string };

// 매칭은 현재 직무지도원 직종만 운영(요양보호사·활동지원사 비노출). 서버도 JOB_COACH 강제.
const PROFESSIONS = [
  { value: "JOB_COACH", label: "직무지도원" },
];

export default function ManagerRecruitNewPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "", companyName: "", profession: "JOB_COACH", taskName: "",
    address: "", detailAddress: "", lat: "", lon: "", region: "",
    serviceStart: "", serviceEnd: "",
    workHours: "", workDays: "", payInfo: "", headcount: "1", description: "",
    contactName: "", contactPhone: "",
  });
  const [addrQ, setAddrQ] = useState("");
  const [addrItems, setAddrItems] = useState<AddrItem[]>([]);
  const [mapPick, setMapPick] = useState<{ lat: number; lon: number; address: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  async function searchAddr() {
    if (!addrQ.trim()) return;
    const r = await fetch(`/api/geo/search-address?q=${encodeURIComponent(addrQ)}`);
    const d = await r.json();
    const items: AddrItem[] = (d?.documents ?? []).map((x: any) => ({ addressName: x.addressName ?? x.address_name, x: x.x, y: x.y }));
    setAddrItems(items);
    if (items.length === 0) alert("주소 검색 결과가 없습니다.");
  }

  async function submit() {
    if (!form.title.trim() || !form.companyName.trim() || !form.address.trim()) {
      alert("제목·사업체명·주소는 필수입니다."); return;
    }
    if (!form.serviceStart || !form.serviceEnd) {
      alert("직무지도 기간(시작일·종료일)을 입력해주세요."); return;
    }
    if (form.serviceStart > form.serviceEnd) {
      alert("종료일은 시작일 이후여야 합니다."); return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/admin/recruit-posts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.success) router.push("/manager/recruit");
      else alert(d.message || "등록에 실패했습니다.");
    } finally { setSaving(false); }
  }

  return (
    <div>
      <PageHeader
        title="새 직무지도 공고"
        sub="직무지도원이 검색·신청할 모집 공고를 등록합니다."
      />

      <div className="max-w-5xl">
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {/* 좌측: 기본 정보 + 위치 */}
          <div className="space-y-5">
        <div className={T.card}>
          <p className="mb-4 text-sm font-black text-slate-900">기본 정보</p>
          <div className="space-y-3">
            <div>
              <label className={T.label}>공고 제목 *</label>
              <input value={form.title} onChange={(e) => set("title", e.target.value)} className={`w-full ${T.input}`} placeholder="예) ○○물류센터 직무지도원 모집" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={T.label}>사업체명 *</label>
                <input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} className={`w-full ${T.input}`} />
              </div>
              <div>
                <label className={T.label}>직종</label>
                <select value={form.profession} onChange={(e) => set("profession", e.target.value)} className={`w-full ${T.select}`}>
                  {PROFESSIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={T.label}>직무지도 과제(사업명)</label>
              <input value={form.taskName} onChange={(e) => set("taskName", e.target.value)} className={`w-full ${T.input}`} placeholder="예) 2026 중증장애인 지원고용" />
            </div>
          </div>
        </div>

        <div className={T.card}>
          <p className="mb-4 text-sm font-black text-slate-900">위치</p>
          <div className="flex gap-2">
            <input value={addrQ} onChange={(e) => setAddrQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchAddr()} className={`flex-1 ${T.input}`} placeholder="도로명·건물명·지번 검색" />
            <button onClick={searchAddr} className={T.btnPrimary}>검색</button>
          </div>
          {addrItems.length > 0 && (
            <div className="mt-2 rounded-xl border border-slate-200 bg-white overflow-hidden">
              {addrItems.slice(0, 8).map((it, i) => (
                <button key={i} onClick={() => { setMapPick({ lat: parseFloat(it.y), lon: parseFloat(it.x), address: it.addressName }); setAddrItems([]); }}
                  className="block w-full border-b border-slate-50 px-4 py-3 text-left text-sm hover:bg-slate-50 last:border-b-0">
                  <p className="font-semibold text-slate-700">{it.addressName}</p>
                </button>
              ))}
            </div>
          )}
          {form.address && (
            <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <p className="font-bold text-slate-700">{form.address} {form.detailAddress}</p>
              <p className="text-xs text-slate-400">좌표: {form.lat || "-"}, {form.lon || "-"}</p>
            </div>
          )}
          <input value={form.detailAddress} onChange={(e) => set("detailAddress", e.target.value)} className={`mt-2 w-full ${T.input}`} placeholder="상세주소 (선택)" />
        </div>
          </div>{/* 좌측 컬럼 끝 */}

          {/* 우측: 근무 조건 */}
          <div className="space-y-5">
        <div className={T.card}>
          <p className="mb-4 text-sm font-black text-slate-900">근무 조건</p>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div><label className={T.label}>직무지도 시작일 *</label><input type="date" value={form.serviceStart} onChange={(e) => set("serviceStart", e.target.value)} className={`w-full ${T.input}`} /></div>
            <div><label className={T.label}>직무지도 종료일 *</label><input type="date" value={form.serviceEnd} min={form.serviceStart || undefined} onChange={(e) => set("serviceEnd", e.target.value)} className={`w-full ${T.input}`} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={T.label}>근무시간</label><input value={form.workHours} onChange={(e) => set("workHours", e.target.value)} className={`w-full ${T.input}`} placeholder="예) 09:00~18:00" /></div>
            <div><label className={T.label}>근무요일</label><input value={form.workDays} onChange={(e) => set("workDays", e.target.value)} className={`w-full ${T.input}`} placeholder="예) 주 5일(월~금)" /></div>
            <div><label className={T.label}>급여</label><input value={form.payInfo} onChange={(e) => set("payInfo", e.target.value)} className={`w-full ${T.input}`} placeholder="예) 시급 12,000원" /></div>
            <div><label className={T.label}>모집 인원</label><input type="number" min={1} value={form.headcount} onChange={(e) => set("headcount", e.target.value)} className={`w-full ${T.input}`} /></div>
          </div>
          <div className="mt-3">
            <label className={T.label}>상세 설명</label>
            <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={4} className="w-full rounded-xl border border-slate-200 p-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" placeholder="업무 내용, 자격 요건 등" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div><label className={T.label}>담당자명</label><input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} className={`w-full ${T.input}`} /></div>
            <div><label className={T.label}>담당자 연락처</label><input value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} className={`w-full ${T.input}`} /></div>
          </div>
        </div>
          </div>{/* 우측 컬럼 끝 */}
        </div>{/* 2단 그리드 끝 */}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => router.push("/manager/recruit")} className={T.btnSecondary}>취소</button>
          <button onClick={submit} disabled={saving} className={T.btnPrimary}>{saving ? "등록 중…" : "공고 등록"}</button>
        </div>
      </div>

      <AddressMapPicker
        open={!!mapPick}
        initialLat={mapPick?.lat ?? 37.5665}
        initialLon={mapPick?.lon ?? 126.978}
        initialAddress={mapPick?.address ?? ""}
        onConfirm={(lat, lon, addr) => {
          setForm((p) => ({ ...p, address: addr, lat: String(lat), lon: String(lon), region: addr.split(/\s+/).slice(0, 2).join(" ") }));
          setMapPick(null);
        }}
        onClose={() => setMapPick(null)}
      />
    </div>
  );
}
