"use client";

// 매니저 — 사업주(에이전시) 정보 설정. 근로계약서 생성 시 사업주(갑)으로 자동 입력된다.
import { useEffect, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";

export default function AgencySettingsPage() {
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [address, setAddress] = useState("");
  const [businessNumber, setBusinessNumber] = useState("");
  const [representativeName, setRepresentativeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/agency-profile")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setName(d.data.name || "");
          setPhoneNumber(d.data.phoneNumber || "");
          setAddress(d.data.address || "");
          setBusinessNumber(d.data.businessNumber || "");
          setRepresentativeName(d.data.representativeName || "");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/agency-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, address, businessNumber, representativeName }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.message);
      setMsg({ ok: true, text: d.message || "저장되었습니다." });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || "저장에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="사업주 정보" sub="근로계약서 생성 시 사업주(갑) 정보로 자동 입력됩니다." />

      <div className={`${T.card} max-w-xl space-y-4`}>
        {loading ? (
          <p className={T.empty}>로딩 중...</p>
        ) : (
          <>
            <div>
              <label className={T.label}>사업체명</label>
              <input value={name} disabled className={`w-full ${T.input} bg-slate-50 text-slate-400`} />
              <p className="mt-1 text-[11px] font-semibold text-slate-400">사업체명 변경은 운영자에게 문의해주세요.</p>
            </div>
            <div>
              <label className={T.label}>대표자명</label>
              <input value={representativeName} onChange={e => setRepresentativeName(e.target.value)} placeholder="예: 홍길동" className={`w-full ${T.input}`} />
            </div>
            <div>
              <label className={T.label}>대표 전화</label>
              <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="예: 02-123-4567" className={`w-full ${T.input}`} />
            </div>
            <div>
              <label className={T.label}>사업장 주소</label>
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder="사업장 주소" className={`w-full ${T.input}`} />
            </div>
            <div>
              <label className={T.label}>사업자등록번호</label>
              <input value={businessNumber} onChange={e => setBusinessNumber(e.target.value)} placeholder="예: 123-45-67890" className={`w-full ${T.input}`} />
            </div>

            {msg && (
              <p className={`text-sm font-semibold ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>
            )}
            <div className="flex justify-end">
              <button onClick={save} disabled={saving} className={T.btnPrimary}>{saving ? "저장 중..." : "저장"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
