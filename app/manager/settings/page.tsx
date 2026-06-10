"use client";

// 매니저 — 사업주(에이전시) 정보 관리. 근로계약서 생성 시 사업주(갑) 정보·서명으로 자동 입력된다.
import { useEffect, useRef, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import { SignaturePad, type SignaturePadHandle } from "../../_components/SignaturePad";
import { isValidBRN, formatBRN } from "@/lib/validateBRN";

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
  // 장애인고용공단 담당자 — 일지 관리 '문서 발송' 기본 수신자
  const [govEmail, setGovEmail] = useState("");
  const [govName, setGovName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 주소 검색
  const [addrQuery, setAddrQuery] = useState("");
  const [addrResults, setAddrResults] = useState<AddrItem[]>([]);
  const [addrLoading, setAddrLoading] = useState(false);

  // 대표자 서명
  const [sigUrl, setSigUrl] = useState<string | null>(null);
  const [sigMode, setSigMode] = useState<"view" | "draw">("view");
  const [sigEmpty, setSigEmpty] = useState(true);
  const [sigSaving, setSigSaving] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);

  // 스마트폰(대표자) 서명 — QR / SMS
  const [phoneSign, setPhoneSign] = useState<{ url: string; qr: string } | null>(null);
  const [repPhone, setRepPhone] = useState("");
  const [smsSending, setSmsSending] = useState(false);
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
          setGovEmail(d.data.govContactEmail || "");
          setGovName(d.data.govContactName || "");
          setSigUrl(d.data.representativeSignatureUrl || null);
        }
      })
      .finally(() => setLoading(false));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function searchAddress() {
    if (!addrQuery.trim()) return;
    setAddrLoading(true); setAddrResults([]);
    try {
      const r = await fetch(`/api/geo/search-address?q=${encodeURIComponent(addrQuery.trim())}`, { cache: "no-store" });
      const d = await r.json();
      const items: AddrItem[] =
        d?.items?.map((x: any) => ({ addressName: x.addressName ?? x.address_name })) ||
        d?.documents?.map((x: any) => ({ addressName: x.addressName ?? x.address_name })) || [];
      setAddrResults(items);
      if (items.length === 0) setMsg({ ok: false, text: "주소 검색 결과가 없습니다." });
    } catch {
      setMsg({ ok: false, text: "주소 검색에 실패했습니다." });
    } finally {
      setAddrLoading(false);
    }
  }
  function pickAddress(it: AddrItem) {
    setAddress(it.addressName);
    setAddrResults([]);
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
        body: JSON.stringify({ phoneNumber, address: fullAddress, businessNumber, representativeName, govContactEmail: govEmail, govContactName: govName }),
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

  // 대표자 서명 토큰 발급 → (옵션) 휴대폰 SMS 발송 → QR 표시 + 완료 폴링
  async function startPhoneSign(opts?: { phone?: string }) {
    setSmsNote("");
    if (opts?.phone) setSmsSending(true);
    try {
      const d = await fetch("/api/admin/agency-profile/sign-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts?.phone ? { phone: opts.phone } : {}),
      }).then(r => r.json());
      if (!d.success) { setSmsNote(d.message || "발급 실패"); return; }

      const QRCode = (await import("qrcode")).default;
      const qr = await QRCode.toDataURL(d.url, { width: 260, margin: 1 });
      const baseline = sigUrl;
      setPhoneSign({ url: d.url, qr });
      if (opts?.phone) setSmsNote(d.sent ? "대표자 휴대폰으로 서명 링크를 전송했습니다." : "문자 발송 환경 미설정 — QR로 진행해주세요.");

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
    } finally {
      setSmsSending(false);
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
        <PageHeader title="사업주 정보 관리" sub="근로계약서 생성 시 사업주(갑) 정보로 자동 입력됩니다." />
        <div className={T.card}><p className={T.empty}>로딩 중...</p></div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="사업주 정보 관리" sub="근로계약서 생성 시 사업주(갑) 정보·서명으로 자동 입력됩니다." />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 기본 정보 */}
        <div className={`${T.card} space-y-4`}>
          <p className="text-sm font-black text-slate-900">기본 정보</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={T.label}>사업체명</label>
              <input value={name} disabled className={`w-full ${T.input} bg-slate-50 text-slate-400`} />
              <p className="mt-1 text-[11px] font-semibold text-slate-400">변경은 운영자에게 문의해주세요.</p>
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

          {/* 사업장 주소 (검색) */}
          <div className="border-t border-slate-100 pt-4">
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

          {/* 장애인고용공단 담당자 — 일지 관리 '문서 발송' 기본 수신자 */}
          <div className="border-t border-slate-100 pt-4">
            <label className={T.label}>장애인고용공단 담당자</label>
            <p className="mb-2 text-[11px] font-semibold text-slate-400">‘일지 관리 → 문서 발송’의 기본 수신자로 채워집니다. (발송 시 수정 가능)</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input value={govName} onChange={e => setGovName(e.target.value)} placeholder="담당자명 (예: 김공단)" className={`w-full ${T.input}`} />
              <input value={govEmail} onChange={e => setGovEmail(e.target.value)} placeholder="이메일 (예: officer@kead.or.kr)" type="email" inputMode="email" className={`w-full ${T.input}`} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            {msg && <p className={`text-sm font-semibold ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>}
            <button onClick={save} disabled={saving || bnInvalid} className={T.btnPrimary}>{saving ? "저장 중..." : "저장"}</button>
          </div>
        </div>

        {/* 대표자 서명 */}
        <div className={T.card}>
          <p className="mb-1 text-sm font-black text-slate-900">대표자 서명</p>
          <p className="mb-3 text-xs font-semibold text-slate-400">등록한 서명은 근로계약서 사업주(갑) <strong>대표자</strong> 서명란에 자동 삽입됩니다.</p>

          {sigMode === "view" ? (
            sigUrl ? (
              <>
                <div className="flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sigUrl} alt="대표자 서명" className="max-h-[100px] max-w-full object-contain" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => { setSigMode("draw"); setSigEmpty(true); }} className={T.btnPrimary}>다시 등록</button>
                  <button onClick={() => startPhoneSign()} className={T.btnSecondary}>📱 스마트폰으로 서명</button>
                  <button onClick={deleteSignature} className={T.btnDanger}>삭제</button>
                </div>
              </>
            ) : (
              <div className="py-8 text-center">
                <p className="mb-1 text-3xl">✍️</p>
                <p className="mb-5 text-sm font-semibold text-slate-400">등록된 대표자 서명이 없습니다.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button onClick={() => { setSigMode("draw"); setSigEmpty(true); }} className={T.btnPrimary}>서명 등록하기</button>
                  <button onClick={() => startPhoneSign()} className={T.btnSecondary}>📱 스마트폰으로 서명</button>
                </div>
              </div>
            )
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
              <p className="mt-2 text-xs font-semibold text-slate-400">대표자가 직접 PC에서 그리기 어려우면 "스마트폰으로 서명"으로 QR·문자 링크를 통해 폰에서 입력하세요.</p>
            </>
          )}

          {/* 대표자 휴대폰으로 서명 요청 (SMS) */}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <label className={T.label}>대표자 휴대폰으로 서명 요청 (문자)</label>
            <div className="flex gap-2">
              <input
                value={repPhone}
                onChange={e => setRepPhone(e.target.value)}
                placeholder="대표자 휴대폰번호 (예: 010-1234-5678)"
                type="tel"
                className={`flex-1 ${T.input}`}
              />
              <button
                onClick={() => startPhoneSign({ phone: repPhone })}
                disabled={smsSending || !repPhone.replace(/-/g, "").match(/^01[0-9]{8,9}$/)}
                className={T.btnSecondary}
              >
                {smsSending ? "전송 중..." : "서명 링크 전송"}
              </button>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-slate-400">대표자가 현장에 없을 때, 휴대폰으로 서명 링크를 보내 직접 서명받을 수 있습니다.</p>
          </div>
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
