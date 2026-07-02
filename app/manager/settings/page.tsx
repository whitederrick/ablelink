"use client";

// 매니저 — 사업주(위탁기관) 정보 관리. 근로계약서 생성 시 사업주(갑) 정보·서명으로 자동 입력된다.
import { useEffect, useRef, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import { SignaturePad, type SignaturePadHandle } from "../../_components/SignaturePad";
import { isValidBRN, formatBRN } from "@/lib/validateBRN";
import { visibleTemplates } from "@/lib/contractTemplates";

type AddrItem = { addressName: string };

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export default function AgencySettingsPage() {
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [address, setAddress] = useState("");
  const [addrDetail, setAddrDetail] = useState("");
  const [businessNumber, setBusinessNumber] = useState("");
  const [representativeName, setRepresentativeName] = useState("");
  // 장애인고용공단 담당자(복수) — 일지 관리 '문서 발송' 기본 수신자
  const [govContacts, setGovContacts] = useState<{ name: string; email: string }[]>([{ name: "", email: "" }]);
  // 급여 자동 DRAFT 생성일(매월 N일, 1~28). ""=자동 생성 안 함.
  const [payrollAutoDay, setPayrollAutoDay] = useState("");
  // 지각 인정 기준(분) — 기관 기본값. 현장에서 미설정 시 이 값 적용. 기본 30.
  const [lateThresholdMin, setLateThresholdMin] = useState("30");
  // 기본 근로계약서 양식(계약 작성 시 프리필). ""=표준
  const [defaultContractTemplate, setDefaultContractTemplate] = useState("");
  // 본 기관에 부여된 전용 양식 키 목록(드롭다운 노출 필터용)
  const [allowedTemplates, setAllowedTemplates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 주소 검색
  const [addrQuery, setAddrQuery] = useState("");
  const [addrResults, setAddrResults] = useState<AddrItem[]>([]);
  const [addrLoading, setAddrLoading] = useState(false);
  const [addrMsg, setAddrMsg] = useState("");  // 사업장 주소 입력 아래 전용 안내(검색 결과 없음/실패)

  // 대표자 서명
  const [sigUrl, setSigUrl] = useState<string | null>(null);
  const [sigMode, setSigMode] = useState<"view" | "draw" | "stamp">("view");
  const [sigEmpty, setSigEmpty] = useState(true);
  const [sigSaving, setSigSaving] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);
  // 직인(도장) 이미지 — 업로드 시 흰 배경을 투명 처리한 미리보기(dataURL)
  const [stampPreview, setStampPreview] = useState<string | null>(null);

  // 스마트폰(대표자) 서명 — QR / SMS
  const [phoneSign, setPhoneSign] = useState<{ url: string; qr: string } | null>(null);
  const [smsNote, setSmsNote] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 사업자번호 유효성(빈 값은 허용, 입력 시 체크섬 검증)
  const bnDigits = businessNumber.replace(/\D/g, "");
  const bnInvalid = bnDigits.length > 0 && !isValidBRN(businessNumber);

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
          {
            const list = Array.isArray(d.data.govContacts) ? d.data.govContacts : [];
            setGovContacts(list.length ? list.map((c: any) => ({ name: c?.name || "", email: c?.email || "" })) : [{ name: "", email: "" }]);
          }
          setPayrollAutoDay(d.data.payrollAutoDay != null ? String(d.data.payrollAutoDay) : "");
          setLateThresholdMin(d.data.lateThresholdMin != null ? String(d.data.lateThresholdMin) : "30");
          setDefaultContractTemplate(d.data.defaultContractTemplate || "");
          setAllowedTemplates(Array.isArray(d.data.allowedContractTemplates) ? d.data.allowedContractTemplates : []);
          setSigUrl(d.data.representativeSignatureUrl || null);
        }
      })
      .finally(() => setLoading(false));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function searchAddress() {
    if (!addrQuery.trim()) return;
    setAddrLoading(true); setAddrResults([]); setAddrMsg("");
    try {
      const r = await fetch(`/api/geo/search-address?q=${encodeURIComponent(addrQuery.trim())}`, { cache: "no-store" });
      const d = await r.json();
      const items: AddrItem[] =
        d?.items?.map((x: any) => ({ addressName: x.addressName ?? x.address_name })) ||
        d?.documents?.map((x: any) => ({ addressName: x.addressName ?? x.address_name })) || [];
      setAddrResults(items);
      if (items.length === 0) setAddrMsg("주소 검색 결과가 없습니다.");
    } catch {
      setAddrMsg("주소 검색에 실패했습니다.");
    } finally {
      setAddrLoading(false);
    }
  }
  function pickAddress(it: AddrItem) {
    setAddress(it.addressName);
    setAddrResults([]);
    setAddrMsg("");
    setAddrQuery("");
  }

  async function save() {
    if (bnInvalid) { setMsg({ ok: false, text: "사업자등록번호가 올바르지 않습니다." }); return; }
    setSaving(true); setMsg(null);
    try {
      const fullAddress = `${address}${addrDetail.trim() ? " " + addrDetail.trim() : ""}`.trim();
      const r = await fetch("/api/admin/agency-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, address: fullAddress, businessNumber, representativeName, govContacts: govContacts.filter(c => c.name.trim() || c.email.trim()), payrollAutoDay: payrollAutoDay === "" ? null : Number(payrollAutoDay), lateThresholdMin: lateThresholdMin === "" ? 30 : Number(lateThresholdMin), defaultContractTemplate: defaultContractTemplate || null }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.message);
      setAddress(fullAddress); setAddrDetail("");
      if (businessNumber) setBusinessNumber(formatBRN(businessNumber));
      setMsg({ ok: true, text: d.message || "저장되었습니다." });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || "저장에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  }

  async function saveSignature() {
    const blob = await padRef.current?.getBlob();
    if (!blob) { setMsg({ ok: false, text: "서명을 입력해주세요." }); return; }
    setSigSaving(true); setMsg(null);
    try {
      const dataUrl = await blobToDataURL(blob);
      const r = await fetch("/api/admin/agency-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ representativeSignatureUrl: dataUrl }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.message);
      setSigUrl(dataUrl); setSigMode("view");
      setMsg({ ok: true, text: "대표자 서명이 저장되었습니다." });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || "서명 저장에 실패했습니다." });
    } finally {
      setSigSaving(false);
    }
  }

  async function deleteSignature() {
    if (!confirm("대표자 서명을 삭제하시겠습니까?")) return;
    const r = await fetch("/api/admin/agency-profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ representativeSignatureUrl: null }),
    });
    const d = await r.json();
    if (d.success) { setSigUrl(null); setMsg({ ok: true, text: "삭제되었습니다." }); }
  }

  // 직인 이미지 선택 → 흰 배경 자동 투명 처리 → 미리보기 생성
  function handleStampFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMsg({ ok: false, text: "이미지 파일을 선택해주세요." }); return; }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { setMsg({ ok: false, text: "이미지 처리에 실패했습니다." }); return; }
      ctx.drawImage(img, 0, 0);
      const W = canvas.width, H = canvas.height;
      const imgData = ctx.getImageData(0, 0, W, H);
      const px = imgData.data;
      // 1) 흰색(밝은) 배경 → 투명. 도장 인주(빨강/검정)는 유지. + 불투명 영역 경계 계산(여백 트림)
      let minX = W, minY = H, maxX = -1, maxY = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (px[i] > 230 && px[i + 1] > 230 && px[i + 2] > 230) { px[i + 3] = 0; continue; }
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      if (maxX < 0) { setMsg({ ok: false, text: "직인 형태를 인식하지 못했습니다. 배경이 흰색인 이미지를 사용해주세요." }); return; }
      // 2) 트림한 직인을 고정 정사각 캔버스에 중앙 배치(계약서에서 모든 직인이 동일 크기로 렌더되도록 정규화)
      const SIZE = 400;
      const sw = maxX - minX + 1, sh = maxY - minY + 1;
      const out = document.createElement("canvas");
      out.width = SIZE; out.height = SIZE;
      const octx = out.getContext("2d");
      if (!octx) { setMsg({ ok: false, text: "이미지 처리에 실패했습니다." }); return; }
      const scale = (SIZE * 0.92) / Math.max(sw, sh); // 약간의 여백을 두고 꽉 차게
      const dw = sw * scale, dh = sh * scale;
      octx.drawImage(canvas, minX, minY, sw, sh, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
      setStampPreview(out.toDataURL("image/png"));
    };
    img.onerror = () => setMsg({ ok: false, text: "이미지를 불러올 수 없습니다." });
    img.src = URL.createObjectURL(file);
  }

  // 직인 저장 — 대표자 서명과 동일하게 representativeSignatureUrl에 저장(계약서 서명란 자동 삽입)
  async function saveStamp() {
    if (!stampPreview) { setMsg({ ok: false, text: "직인 이미지를 선택해주세요." }); return; }
    setSigSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/agency-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ representativeSignatureUrl: stampPreview }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.message);
      setSigUrl(stampPreview); setStampPreview(null); setSigMode("view");
      setMsg({ ok: true, text: "직인이 저장되었습니다." });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || "직인 저장에 실패했습니다." });
    } finally {
      setSigSaving(false);
    }
  }

  // 대표자 서명 토큰 발급 → QR 표시 + 완료 폴링 (스마트폰으로 직접 서명)
  async function startPhoneSign() {
    setSmsNote("");
    try {
      const d = await fetch("/api/admin/agency-profile/sign-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).then(r => r.json());
      if (!d.success) { setSmsNote(d.message || "발급 실패"); return; }

      const QRCode = (await import("qrcode")).default;
      const qr = await QRCode.toDataURL(d.url, { width: 260, margin: 1 });
      const baseline = sigUrl;
      setPhoneSign({ url: d.url, qr });

      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const r = await fetch("/api/admin/agency-profile").then(x => x.json()).catch(() => null);
        const next = r?.success ? r.data?.representativeSignatureUrl : null;
        if (next && next !== baseline) {
          if (pollRef.current) clearInterval(pollRef.current);
          setSigUrl(next);
          setPhoneSign(null);
          setSigMode("view");
          setMsg({ ok: true, text: "대표자 서명이 저장되었습니다." });
        }
      }, 3000);
    } catch {
      setSmsNote("오류가 발생했습니다.");
    }
  }

  function cancelPhoneSign() {
    if (pollRef.current) clearInterval(pollRef.current);
    setPhoneSign(null);
    setSmsNote("");
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader title="위탁기관 정보 관리" sub="위탁기관의 기본 정보와 서비스 이용에 필요한 정보를 입력 및 관리합니다." />
        <div className={T.card}><p className={T.empty}>로딩 중...</p></div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="위탁기관 정보 관리" sub="위탁기관의 기본 정보와 서비스 이용에 필요한 정보를 입력 및 관리합니다." />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[13fr_7fr]">
        {/* 기본 정보 */}
        <div className={`${T.card} space-y-4`}>
          <p className="text-sm font-black text-slate-900">기본 정보</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className={T.label}>사업체명</label>
              <input value={name} disabled className={`w-full ${T.input} bg-slate-50 text-slate-400`} />
              <p className="mt-1 text-[11px] font-semibold text-slate-400">변경은 시스템 관리자에게 문의해주세요.</p>
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
              <label className={T.label}>사업자등록번호</label>
              <input
                value={businessNumber}
                onChange={e => setBusinessNumber(formatBRN(e.target.value))}
                placeholder="예: 123-45-67890"
                inputMode="numeric"
                className={`w-full ${T.input} ${bnInvalid ? "border-rose-300 focus:border-rose-400" : ""}`}
              />
              {bnInvalid
                ? <p className="mt-1 text-[11px] font-semibold text-rose-500">유효하지 않은 사업자등록번호입니다.</p>
                : bnDigits.length === 10
                ? <p className="mt-1 text-[11px] font-semibold text-emerald-600">✓ 확인된 번호</p>
                : null}
            </div>
          </div>

          {/* 사업장 주소 + 공단 담당자 좌우 2열 배치 */}
          <div className="grid grid-cols-1 gap-5 border-t border-slate-100 pt-4 lg:grid-cols-2">
            {/* 사업장 주소 (검색) */}
            <div>
            <label className={T.label}>사업장 주소</label>
            <div className="flex gap-2">
              <input
                value={addrQuery}
                onChange={e => setAddrQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); searchAddress(); } }}
                placeholder="도로명/지번/건물명 검색 (예: 세종대로 110)"
                className={`flex-1 ${T.input}`}
              />
              <button type="button" onClick={searchAddress} disabled={addrLoading} className={T.btnSecondary}>
                {addrLoading ? "검색중..." : "주소검색"}
              </button>
            </div>
            {addrMsg && <p className="mt-1 text-[11px] font-semibold text-rose-500">{addrMsg}</p>}
            {addrResults.length > 0 && (
              <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-slate-200">
                {addrResults.map((it, i) => (
                  <button key={i} type="button" onClick={() => pickAddress(it)}
                    className="block w-full border-b border-slate-50 px-3 py-2 text-left text-sm font-semibold text-slate-700 last:border-b-0 hover:bg-sky-50">
                    {it.addressName}
                  </button>
                ))}
              </div>
            )}
            <input value={address} readOnly placeholder="검색 후 선택된 주소" className={`mt-2 w-full ${T.input} bg-slate-50`} />
            <input value={addrDetail} onChange={e => setAddrDetail(e.target.value)} placeholder="상세주소 (동/호 등, 선택)" className={`mt-2 w-full ${T.input}`} />
            </div>

            {/* 장애인고용공단 담당자(복수) — 일지 관리 '문서 발송' 기본 수신자 */}
            <div>
            <label className={T.label}>장애인고용공단 담당자</label>
            <p className="mb-2 text-[11px] font-semibold text-slate-400">일지를 수신 받을 기본 수신자입니다. 여러 명 등록하면 전체 인원에게 발송됩니다.</p>
            <div className="space-y-2">
              {govContacts.map((c, i) => (
                <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
                  <input value={c.name} onChange={e => setGovContacts(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="담당자명 (예: 김공단)" className={`w-full ${T.input}`} />
                  <input value={c.email} onChange={e => setGovContacts(prev => prev.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} placeholder="이메일 (예: officer@kead.or.kr)" type="email" inputMode="email" className={`w-full ${T.input}`} />
                  <button
                    type="button"
                    onClick={() => setGovContacts(prev => { const n = prev.filter((_, j) => j !== i); return n.length ? n : [{ name: "", email: "" }]; })}
                    disabled={govContacts.length === 1 && !c.name.trim() && !c.email.trim()}
                    className={`${T.btnSecondary} shrink-0 disabled:opacity-40`}
                    title="이 담당자 삭제"
                  >삭제</button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setGovContacts(prev => prev.length >= 10 ? prev : [...prev, { name: "", email: "" }])}
              disabled={govContacts.length >= 10}
              className={`${T.btnSecondary} mt-2 disabled:opacity-40`}
            >+ 담당자 추가</button>
            </div>
          </div>

          {/* 급여 자동 생성일 + 기본 근로계약서 양식 좌우 2열 배치 */}
          <div className="grid grid-cols-1 gap-5 border-t border-slate-100 pt-4 lg:grid-cols-2">
            {/* 급여 자동 생성일 */}
            <div>
            <label className={T.label}>급여 자동 생성일</label>
            <p className="mb-2 text-[11px] font-semibold text-slate-400">매월 해당 날짜에 <b>전월분 급여를 자동 계산</b>합니다.<br /><span className="text-rose-500">최종 명세서 발급은 담당자가 검토 후 확정해야 됩니다. 날짜 미입력시 자동 생성되지 않습니다.</span></p>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-500">매월</span>
              <input type="number" min={1} max={31} value={payrollAutoDay}
                onChange={e => setPayrollAutoDay(e.target.value)}
                placeholder="미사용" className={`w-24 ${T.input}`} />
              <span className="text-sm font-semibold text-slate-500">일 (1~31, <b>31=말일</b>, 비우면 사용 안 함)</span>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-slate-400">※ 31 등 그 달에 없는 날짜는 <b>그 달 마지막 날</b>에 생성됩니다(예: 2월은 28/29일).</p>
            </div>

            {/* 지각 인정 기준(기관 기본값) */}
            <div>
            <label className={T.label}>지각 인정 기준 (기관 기본값)</label>
            <p className="mb-2 text-[11px] font-semibold text-slate-400">출근이 표준 시업시각보다 이 시간 이상 늦으면 <b>지각</b>으로 표시하고, (미컨펌 시) 급여 보류(보정대기)됩니다.<br />현장별로 따로 정하지 않으면 이 기본값이 적용됩니다.</p>
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={180} step={15} value={lateThresholdMin}
                onChange={e => setLateThresholdMin(e.target.value)}
                className={`w-24 ${T.input}`} />
              <span className="text-sm font-semibold text-slate-500">분 (기본 30, 15분 단위 권장·직접 입력 가능)</span>
            </div>
            </div>

            {/* 기본 근로계약서 양식 */}
            <div>
            <label className={T.label}>기본 근로계약서 양식</label>
            <p className="mb-1 text-[11px] font-semibold text-slate-400">근로계약서 작성 시 선택된 양식으로 기본 적용됩니다.</p>
            <p className="mb-2 text-[11px] font-semibold text-rose-500">근로계약서 양식을 등록은 시스템 관리자 문의를 통해 가능합니다.(계약서 양식 등록 요청)</p>
            <select value={defaultContractTemplate} onChange={e => setDefaultContractTemplate(e.target.value)} className={`w-full max-w-md ${T.input}`}>
              <option value="">표준 근로계약서 (기본)</option>
              {visibleTemplates(allowedTemplates).filter(t => t.key !== "STANDARD").map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            {msg && <p className={`text-sm font-semibold ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>}
            <button onClick={save} disabled={saving || bnInvalid} className={T.btnPrimary}>{saving ? "저장 중..." : "저장"}</button>
          </div>
        </div>

        {/* 대표자 서명 / 직인 — 오른쪽 30% 축소(왼쪽 65% : 오른쪽 35%) */}
        <div className={T.card}>
          <p className="mb-1 text-sm font-black text-slate-900">대표자 서명 / 직인</p>
          <p className="mb-1 text-xs font-semibold text-slate-400">등록한 <strong>대표자 서명</strong> 또는 <strong>직인</strong>이 근로계약서 사업주(갑) 서명란에 자동 삽입됩니다.<br />둘 중 하나를 선택해 등록하세요.</p>
          <p className="mb-3 text-xs font-semibold text-rose-500">만약 등록하지 않으면 근로계약서에 서명 또는 직인이 포함되지 않습니다.</p>

          {sigMode === "view" ? (
            sigUrl ? (
              <>
                <div className="flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sigUrl} alt="대표자 서명 또는 직인" className="max-h-[100px] max-w-full object-contain" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => { setSigMode("draw"); setSigEmpty(true); }} className={T.btnPrimary}>✍️ 서명 등록</button>
                  <button onClick={() => { setStampPreview(null); setSigMode("stamp"); }} className={T.btnPrimary}>🟥 직인 등록</button>
                  <button onClick={deleteSignature} className={T.btnDanger}>삭제</button>
                </div>
              </>
            ) : (
              <div className="py-8 text-center">
                <p className="mb-1 text-3xl">✍️</p>
                <p className="mb-5 text-sm font-semibold text-slate-400">등록된 대표자 서명 / 직인이 없습니다.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button onClick={() => { setSigMode("draw"); setSigEmpty(true); }} className={T.btnPrimary}>✍️ 서명 등록하기</button>
                  <button onClick={() => { setStampPreview(null); setSigMode("stamp"); }} className={T.btnPrimary}>🟥 직인 등록하기</button>
                </div>
              </div>
            )
          ) : sigMode === "stamp" ? (
            <>
              <label className={`${T.btnSecondary} mb-3 inline-flex cursor-pointer`}>
                직인 이미지 선택
                <input type="file" accept="image/*" className="hidden" onChange={handleStampFile} />
              </label>
              {stampPreview && (
                <div className="mb-3 flex min-h-[120px] max-w-[460px] items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 p-5"
                  style={{ backgroundImage: "linear-gradient(45deg,#eef2f6 25%,transparent 25%,transparent 75%,#eef2f6 75%),linear-gradient(45deg,#eef2f6 25%,transparent 25%,transparent 75%,#eef2f6 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={stampPreview} alt="직인 미리보기" className="max-h-[120px] max-w-full object-contain" />
                </div>
              )}
              <p className="mb-3 text-xs font-semibold text-slate-400">도장(직인) 이미지를 올리면 <strong>흰색 배경이 자동으로 투명 처리</strong>되어 저장됩니다.</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={saveStamp} disabled={sigSaving || !stampPreview} className={T.btnPrimary}>{sigSaving ? "저장 중..." : "직인 저장"}</button>
                <button onClick={() => { setStampPreview(null); setSigMode("view"); }} className={T.btnSecondary}>취소</button>
              </div>
            </>
          ) : (
            <>
              <div className="relative mb-3 max-w-[460px] overflow-hidden rounded-xl border-2 border-slate-950 bg-white">
                <SignaturePad ref={padRef} onChange={setSigEmpty} />
                <p className="pointer-events-none absolute bottom-2 right-2 text-[11px] text-slate-300">✍️ 패드 전체에 꽉 차게 서명해 주세요</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => padRef.current?.clear()} className={T.btnSecondary}>지우기</button>
                <button onClick={saveSignature} disabled={sigSaving || sigEmpty} className={T.btnPrimary}>{sigSaving ? "저장 중..." : "서명 저장"}</button>
                <button onClick={() => startPhoneSign()} className={T.btnSecondary}>📱 스마트폰으로 서명</button>
                <button onClick={() => setSigMode("view")} className={T.btnSecondary}>취소</button>
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-400">대표자가 직접 PC에서 그리기 어려우면 "스마트폰으로 서명"으로 QR을 스캔해 폰에서 입력하세요.</p>
            </>
          )}
        </div>
      </div>

      {/* 스마트폰 서명 QR 모달 */}
      {phoneSign && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/50 px-5" onClick={e => { if (e.target === e.currentTarget) cancelPhoneSign(); }}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <p className="text-base font-black text-slate-900">대표자 스마트폰 서명</p>
            <p className="mt-1 text-sm font-semibold text-slate-400">대표자 휴대폰 카메라로 QR을 스캔한 뒤 폰 화면에서 서명하세요.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={phoneSign.qr} alt="서명 QR" className="mx-auto my-5 h-60 w-60 rounded-xl border border-slate-100" />
            {smsNote && <p className="mb-2 text-xs font-bold text-emerald-600">{smsNote}</p>}
            <div className="flex items-center justify-center gap-2 text-sm font-bold text-slate-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              서명을 기다리는 중...
            </div>
            <p className="mt-3 break-all rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-400">{phoneSign.url}</p>
            <button onClick={cancelPhoneSign} className="mt-4 w-full rounded-2xl border border-slate-200 py-3 text-sm font-black text-slate-500">
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
