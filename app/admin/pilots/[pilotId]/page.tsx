"use client";

// app/admin/pilots/[pilotId]/page.tsx
// 파일럿 일괄 설정 — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §8
//
// ★위탁기관 담당자(Manager)가 없으므로 매니저가 하던 등록을 운영자가 대신한다.
//  사업체 · 사업체 담당자 · 훈련생/재적 · 직무지도원 계정 · 근무형태/기간.
//  ★근로계약·급여기준은 만들지 않는다 — 출근부·일지 PDF payload에 쓰이지 않는다.
//
// ★주소 검색 결과가 이미 좌표(x=경도, y=위도)를 갖는다. **선택 즉시 좌표를 채우고** 지도는
//  조정용으로만 연다 — 지도 SDK가 실패해도 사업체 등록이 막히지 않아야 한다
//  (4-B에서 Kakao 도메인 미등록으로 등록 전체가 막힌 전례).
//
// ★운영자 콘솔은 데스크톱 전제다.

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { T } from "../../_styles";
import PageHeader from "../../_components/PageHeader";
import AddressMapPicker from "@/components/AddressMapPicker";

type Detail = {
  pilot: { id: string; name: string; note: string | null; createdAt: string };
  agency: { id: string; name: string; planType: string } | null;
  sites: { id: string; companyName: string; address: string; detailAddress: string | null; gpsLat: string; gpsLon: string; businessContactName: string | null; businessContactPhone: string | null }[];
  trainees: { id: string; name: string; gender: string; disabilityType: string; severity: string; currentSiteId: string | null }[];
  placements: { id: string; traineeId: string; siteId: string; startDate: string; endDate: string | null }[];
  workers: { id: string; workerName: string; loginId: string; planType: string; status: string }[];
  assignments: { id: string; workerId: string; siteId: string; workType: string | null; startDate: string; endDate: string | null; attendanceButtonExempt: boolean; commuteGuidanceIncluded: boolean }[];
  registry: { counts: Record<string, number>; deleteErrors: number };
};

type AddrItem = { addressName: string; x: string; y: string };

const WORK_TYPES = [
  { v: "AM", label: "오전 4시간", time: "08:30~14:00 (지도 포함)" },
  { v: "PM", label: "오후 4시간", time: "12:30~18:00 (지도 포함)" },
  { v: "FULL_DAY", label: "전일 8시간", time: "09:00~18:00 (지도 미포함)" },
];
const GENDERS = ["남", "여"];
const SEVERITIES = ["중증", "경증"];

function Card({ step, title, desc, children }: { step: number; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className={T.card}>
      <div className="mb-4">
        <h2 className="text-sm font-black text-slate-900">
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">{step}</span>
          {title}
        </h2>
        {desc && <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-500">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

export default function PilotSetupPage({ params }: { params: Promise<{ pilotId: string }> }) {
  const { pilotId } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const r = await fetch(`/api/admin/pilots/${pilotId}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.message || "불러오지 못했습니다.");
      setD(j as Detail);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [pilotId]);
  useEffect(() => { void load(); }, [load]);

  async function post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/pilots/${pilotId}/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) { alert(j?.message || "실패했습니다."); return null; }
      await load();
      return j;
    } finally { setBusy(false); }
  }

  // ── 2) 사업체 ────────────────────────────────────────────────
  const [site, setSite] = useState({ companyName: "", address: "", detailAddress: "", gpsLat: "", gpsLon: "", businessContactName: "", businessContactPhone: "" });
  const [addrQ, setAddrQ] = useState("");
  const [addrItems, setAddrItems] = useState<AddrItem[]>([]);
  const [addrLoading, setAddrLoading] = useState(false);
  const [mapPick, setMapPick] = useState<{ lat: number; lon: number; address: string } | null>(null);

  async function searchAddress() {
    if (!addrQ.trim()) return;
    setAddrLoading(true);
    try {
      const r = await fetch(`/api/geo/search-address?q=${encodeURIComponent(addrQ.trim())}`, { cache: "no-store" });
      const j = await r.json();
      const items: AddrItem[] =
        j?.items?.map((x: Record<string, string>) => ({ addressName: x.addressName ?? x.address_name, x: x.x, y: x.y })) ||
        j?.documents?.map((x: Record<string, string>) => ({ addressName: x.addressName ?? x.address_name, x: x.x, y: x.y })) || [];
      setAddrItems(items);
      if (items.length === 0) alert("주소 검색 결과가 없습니다.");
    } catch { alert("주소 검색에 실패했습니다."); }
    finally { setAddrLoading(false); }
  }

  // ★선택 즉시 주소+좌표를 폼에 채운다. 지도는 조정용으로만 연다(SDK 실패해도 등록 가능).
  function pickAddress(it: AddrItem) {
    setSite((p) => ({ ...p, address: it.addressName, gpsLat: it.y, gpsLon: it.x }));
    setAddrItems([]);
    setMapPick({ lat: parseFloat(it.y), lon: parseFloat(it.x), address: it.addressName });
  }

  const siteReady = site.companyName.trim().length >= 2 && site.address.trim() && site.gpsLat && site.gpsLon && site.businessContactName.trim().length >= 2;

  // ── 3) 훈련생 ────────────────────────────────────────────────
  const [tr, setTr] = useState({ siteId: "", name: "", gender: "남", disabilityType: "", severity: "중증", startDate: "", endDate: "" });
  const trReady = tr.siteId && tr.name.trim().length >= 2 && tr.disabilityType.trim() && tr.startDate;

  // ── 4) 직무지도원 ────────────────────────────────────────────
  const [wk, setWk] = useState({ workerName: "", phoneNumber: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [issued, setIssued] = useState<{ name: string; loginId: string; password: string } | null>(null);
  // ★중복은 발급 **전에** 알린다(§8-3). 409를 만나고 나서 알려주는 방식은 안 된다.
  const [phoneCheck, setPhoneCheck] = useState<{ state: "idle" | "checking" | "ok" | "taken" | "error"; msg?: string }>({ state: "idle" });
  const phoneValid = /^01[0-9]{8,9}$/.test(wk.phoneNumber.replace(/[^0-9]/g, ""));
  const wkReady = wk.workerName.trim().length >= 2 && phoneValid && wk.password.length >= 8 && phoneCheck.state === "ok";

  // 번호를 고치면 이전 확인 결과를 무효화한다(확인 없이 발급되는 것을 막는다).
  function onPhoneChange(v: string) {
    setWk((p) => ({ ...p, phoneNumber: v }));
    setPhoneCheck({ state: "idle" });
  }
  async function checkPhone() {
    if (!phoneValid) return;
    setPhoneCheck({ state: "checking" });
    try {
      const r = await fetch(`/api/admin/pilots/${pilotId}/workers?phone=${encodeURIComponent(wk.phoneNumber.replace(/[^0-9]/g, ""))}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) { setPhoneCheck({ state: "error", msg: j?.message || "확인에 실패했습니다." }); return; }
      setPhoneCheck(j.available
        ? { state: "ok", msg: "사용 가능한 번호입니다." }
        : { state: "taken", msg: "이미 가입된 번호입니다. 기존 계정은 재사용하지 않습니다 — 이 참여자는 제외하거나 본인 소유의 다른 번호를 쓰세요." });
    } catch {
      setPhoneCheck({ state: "error", msg: "확인에 실패했습니다." });
    }
  }

  // ── 5) 배정 ──────────────────────────────────────────────────
  const [asg, setAsg] = useState({ workerId: "", siteId: "", workType: "FULL_DAY", startDate: "", endDate: "" });
  const asgReady = asg.workerId && asg.siteId && asg.workType && asg.startDate && asg.endDate;

  if (loading) return <p className="py-16 text-center text-sm font-semibold text-slate-400">불러오는 중…</p>;
  if (loadError || !d) return (
    <div className="py-16 text-center">
      <p className="text-sm font-semibold text-rose-600">{loadError}</p>
      <button onClick={() => void load()} className={`mt-3 ${T.btnSecondary}`}>다시 시도</button>
    </div>
  );

  const siteName = (id: string) => d.sites.find((s) => s.id === id)?.companyName ?? "—";
  const workerName = (id: string) => d.workers.find((w) => w.id === id)?.workerName ?? "—";
  const c = d.registry.counts;

  return (
    <div className="space-y-5">
      <PageHeader
        title={d.pilot.name}
        sub={d.agency ? `전용 기관 ${d.agency.name} · ${d.agency.planType} 등급 (급여는 PRO 전용이라 열리지 않습니다)` : "전용 기관 없음"}
        actions={<Link href="/admin/pilots" className={T.btnSecondary}>목록</Link>}
      />

      {/* 등록 현황 — 레지스트리 기준. 여기 숫자가 곧 삭제 대상이다. */}
      <div className={T.card}>
        <h2 className="mb-3 text-sm font-black text-slate-900">등록 현황 <span className="ml-1 text-xs font-semibold text-slate-400">(레지스트리 기준 — 종료 시 삭제 대상)</span></h2>
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          {[["기관", "AGENCY"], ["사업체", "SITE"], ["훈련생", "TRAINEE"], ["재적", "PLACEMENT"], ["직무지도원", "WORKER"], ["배정", "ASSIGNMENT"]].map(([label, k]) => (
            <div key={k} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
              <p className="text-xs font-black text-slate-500">{label}</p>
              <p className="mt-0.5 text-lg font-black text-slate-900">{c[k] ?? 0}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 2) 사업체 */}
      <Card step={2} title="사업체 등록" desc="주소를 검색해 선택하면 좌표가 자동으로 채워집니다. 지도는 위치를 더 정확히 맞출 때만 쓰면 됩니다.">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className={T.label}>사업체명 <span className="text-rose-500">*</span></label>
            <input value={site.companyName} onChange={(e) => setSite((p) => ({ ...p, companyName: e.target.value }))} className={`w-full ${T.input}`} />
          </div>
          <div>
            <label className={T.label}>상세주소</label>
            <input value={site.detailAddress} onChange={(e) => setSite((p) => ({ ...p, detailAddress: e.target.value }))} className={`w-full ${T.input}`} />
          </div>
        </div>

        <div className="mt-3">
          <label className={T.label}>주소 검색 <span className="text-rose-500">*</span></label>
          <div className="flex gap-2">
            <input value={addrQ} onChange={(e) => setAddrQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void searchAddress(); }}
              placeholder="도로명·지번·건물명" className={`flex-1 ${T.input}`} />
            <button onClick={() => void searchAddress()} disabled={addrLoading} className={T.btnSecondary}>
              {addrLoading ? "검색 중…" : "검색"}
            </button>
          </div>
          {addrItems.length > 0 && (
            <ul className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-slate-200">
              {addrItems.map((it, i) => (
                <li key={i}>
                  <button onClick={() => pickAddress(it)} className="w-full px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    {it.addressName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="md:col-span-1">
            <label className={T.label}>선택한 주소</label>
            <input value={site.address} readOnly className={`w-full ${T.input} bg-slate-50`} placeholder="주소 검색 후 자동입력" />
          </div>
          <div>
            <label className={T.label}>위도(gpsLat)</label>
            <input value={site.gpsLat} readOnly className={`w-full ${T.input} bg-slate-50`} placeholder="자동입력" />
          </div>
          <div>
            <label className={T.label}>경도(gpsLon)</label>
            <input value={site.gpsLon} readOnly className={`w-full ${T.input} bg-slate-50`} placeholder="자동입력" />
          </div>
        </div>
        {site.gpsLat && site.gpsLon && (
          <button onClick={() => setMapPick({ lat: parseFloat(site.gpsLat), lon: parseFloat(site.gpsLon), address: site.address })}
            className={`mt-2 ${T.btnSecondary}`}>지도에서 위치 조정</button>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className={T.label}>사업체 담당자 성명 <span className="text-rose-500">*</span></label>
            <input value={site.businessContactName} onChange={(e) => setSite((p) => ({ ...p, businessContactName: e.target.value }))} className={`w-full ${T.input}`} />
          </div>
          <div>
            <label className={T.label}>담당자 연락처 (선택)</label>
            <input value={site.businessContactPhone} onChange={(e) => setSite((p) => ({ ...p, businessContactPhone: e.target.value }))} placeholder="01012345678" className={`w-full ${T.input}`} />
          </div>
        </div>
        <p className="mt-2 text-xs font-semibold text-slate-500">
          이메일은 수집하지 않습니다 — 운영 환경은 외부 발송이 켜져 있어 수신처가 있으면 오발송 경로가 됩니다.
        </p>

        <div className="mt-4 flex justify-end">
          <button disabled={!siteReady || busy}
            onClick={async () => { if (await post("sites", site)) setSite({ companyName: "", address: "", detailAddress: "", gpsLat: "", gpsLon: "", businessContactName: "", businessContactPhone: "" }); }}
            className={T.btnPrimary}>사업체 등록</button>
        </div>

        {d.sites.length > 0 && (
          <table className="mt-4 w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-black text-slate-500">
                <th className="w-[200px] py-2 pr-3">사업체명</th>
                <th className="w-[280px] py-2 pr-3">주소</th>
                <th className="w-[140px] py-2 pr-3">담당자</th>
                <th className="w-[180px] py-2">좌표</th>
              </tr>
            </thead>
            <tbody>
              {d.sites.map((s) => (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="truncate py-2.5 pr-3 font-black text-slate-900">{s.companyName}</td>
                  <td className="truncate py-2.5 pr-3 font-semibold text-slate-500">{s.address}</td>
                  <td className="truncate py-2.5 pr-3 font-semibold text-slate-700">{s.businessContactName || "—"}</td>
                  <td className="truncate py-2.5 font-semibold text-slate-500">{Number(s.gpsLat).toFixed(5)}, {Number(s.gpsLon).toFixed(5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* 3) 훈련생 */}
      <Card step={3} title="훈련생 등록 · 재적"
        desc="★같은 현장에 재적한 훈련생이 2명 이상이면 출근부가 1:多 서식으로 나옵니다(날짜별 판정). 체험할 형태에 맞춰 인원을 정하세요.">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className={T.label}>사업체 <span className="text-rose-500">*</span></label>
            <select value={tr.siteId} onChange={(e) => setTr((p) => ({ ...p, siteId: e.target.value }))} className={`w-full ${T.input}`}>
              <option value="">선택</option>
              {d.sites.map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}
            </select>
          </div>
          <div>
            <label className={T.label}>성명 <span className="text-rose-500">*</span></label>
            <input value={tr.name} onChange={(e) => setTr((p) => ({ ...p, name: e.target.value }))} className={`w-full ${T.input}`} />
          </div>
          <div>
            <label className={T.label}>성별</label>
            <select value={tr.gender} onChange={(e) => setTr((p) => ({ ...p, gender: e.target.value }))} className={`w-full ${T.input}`}>
              {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className={T.label}>장애유형 <span className="text-rose-500">*</span></label>
            <input value={tr.disabilityType} onChange={(e) => setTr((p) => ({ ...p, disabilityType: e.target.value }))} placeholder="예: 지적장애" className={`w-full ${T.input}`} />
          </div>
          <div>
            <label className={T.label}>중증도</label>
            <select value={tr.severity} onChange={(e) => setTr((p) => ({ ...p, severity: e.target.value }))} className={`w-full ${T.input}`}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div />
          <div>
            <label className={T.label}>재적 시작일 <span className="text-rose-500">*</span></label>
            <input type="date" value={tr.startDate} onChange={(e) => setTr((p) => ({ ...p, startDate: e.target.value }))} className={`w-full ${T.input}`} />
          </div>
          <div>
            <label className={T.label}>재적 종료일 (선택)</label>
            <input type="date" value={tr.endDate} onChange={(e) => setTr((p) => ({ ...p, endDate: e.target.value }))} className={`w-full ${T.input}`} />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button disabled={!trReady || busy}
            onClick={async () => { if (await post("trainees", tr)) setTr((p) => ({ ...p, name: "", disabilityType: "" })); }}
            className={T.btnPrimary}>훈련생 등록</button>
        </div>

        {d.trainees.length > 0 && (
          <table className="mt-4 w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-black text-slate-500">
                <th className="w-[140px] py-2 pr-3">성명</th>
                <th className="w-[200px] py-2 pr-3">사업체</th>
                <th className="w-[160px] py-2 pr-3">장애유형/중증도</th>
                <th className="w-[200px] py-2">재적기간</th>
              </tr>
            </thead>
            <tbody>
              {d.trainees.map((t) => {
                const pl = d.placements.find((p) => p.traineeId === t.id);
                return (
                  <tr key={t.id} className="border-b border-slate-100">
                    <td className="truncate py-2.5 pr-3 font-black text-slate-900">{t.name}</td>
                    <td className="truncate py-2.5 pr-3 font-semibold text-slate-500">{pl ? siteName(pl.siteId) : "—"}</td>
                    <td className="truncate py-2.5 pr-3 font-semibold text-slate-700">{t.disabilityType} / {t.severity}</td>
                    <td className="truncate py-2.5 font-semibold text-slate-500">
                      {pl ? `${pl.startDate.slice(0, 10)} ~ ${pl.endDate ? pl.endDate.slice(0, 10) : "무기한"}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* 4) 직무지도원 */}
      <Card step={4} title="직무지도원 계정 발급"
        desc="아이디는 휴대전화번호입니다. 초기 비밀번호는 발급 직후 한 번만 보이며 이후에는 다시 볼 수 없습니다.">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className={T.label}>성명 <span className="text-rose-500">*</span></label>
            <input value={wk.workerName} onChange={(e) => setWk((p) => ({ ...p, workerName: e.target.value }))} className={`w-full ${T.input}`} />
          </div>
          <div>
            <label className={T.label}>휴대전화번호 (= 아이디) <span className="text-rose-500">*</span></label>
            <div className="flex gap-2">
              <input value={wk.phoneNumber} onChange={(e) => onPhoneChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void checkPhone(); }}
                placeholder="01012345678" className={`flex-1 ${T.input}`} />
              <button onClick={() => void checkPhone()} disabled={!phoneValid || phoneCheck.state === "checking"} className={T.btnSecondary}>
                {phoneCheck.state === "checking" ? "확인 중…" : "중복확인"}
              </button>
            </div>
            {phoneCheck.msg && (
              <p className={`mt-1 text-xs font-semibold leading-relaxed ${phoneCheck.state === "ok" ? "text-emerald-600" : "text-rose-600"}`}>
                {phoneCheck.msg}
              </p>
            )}
          </div>
          <div>
            <label className={T.label}>임시 비밀번호 (8자 이상) <span className="text-rose-500">*</span></label>
            <div className="flex gap-2">
              <input type={showPw ? "text" : "password"} value={wk.password} autoComplete="new-password"
                onChange={(e) => setWk((p) => ({ ...p, password: e.target.value }))} className={`flex-1 ${T.input}`} />
              <button onClick={() => setShowPw((v) => !v)} className={T.btnSecondary}>{showPw ? "숨기기" : "표시"}</button>
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs font-semibold leading-relaxed text-slate-500">
          발급 전에 <b className="text-slate-700">중복확인</b>을 해야 버튼이 활성화됩니다.
          <b className="text-slate-700"> 기존 계정은 재사용하지 않습니다</b> — 이미 가입된 번호라면 그 참여자는 제외하거나 본인 소유의 다른 번호를 쓰세요.
          <br />
          발급된 계정은 <b className="text-slate-700">임시 비밀번호 상태</b>라 참여자가 최초 로그인 시 비밀번호를 바꾸게 됩니다.
        </p>
        <div className="mt-4 flex justify-end">
          <button disabled={!wkReady || busy}
            onClick={async () => {
              const j = await post("workers", wk);
              if (j) {
                setIssued({ name: String(j.workerName), loginId: String(j.loginId), password: String(j.initialPassword) });
                setWk({ workerName: "", phoneNumber: "", password: "" });
                setPhoneCheck({ state: "idle" });
                setShowPw(false);
              }
            }}
            className={T.btnPrimary}>계정 발급</button>
        </div>

        {issued && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-black text-amber-900">발급 완료 — 지금 전달하세요. 이 정보는 다시 볼 수 없습니다.</p>
            <div className="mt-2 space-y-1 text-sm font-semibold text-amber-900">
              <p>성명 : {issued.name}</p>
              <p>아이디 : {issued.loginId}</p>
              <p>초기 비밀번호 : <span className="font-black">{issued.password}</span></p>
              <p className="pt-1 text-xs">참여자가 최초 로그인하면 비밀번호 변경 화면으로 이동합니다.</p>
            </div>
            <button onClick={() => setIssued(null)} className={`mt-3 ${T.btnSecondary}`}>확인했습니다</button>
          </div>
        )}

        {d.workers.length > 0 && (
          <table className="mt-4 w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-black text-slate-500">
                <th className="w-[160px] py-2 pr-3">성명</th>
                <th className="w-[180px] py-2 pr-3">아이디</th>
                <th className="w-[120px] py-2 pr-3">등급</th>
                <th className="w-[120px] py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {d.workers.map((w) => (
                <tr key={w.id} className="border-b border-slate-100">
                  <td className="truncate py-2.5 pr-3 font-black text-slate-900">{w.workerName}</td>
                  <td className="truncate py-2.5 pr-3 font-semibold text-slate-500">{w.loginId}</td>
                  <td className="truncate py-2.5 pr-3 font-semibold text-slate-700">{w.planType}</td>
                  <td className="truncate py-2.5 font-semibold text-slate-500">{w.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* 5) 배정 */}
      <Card step={5} title="근무형태 · 기간 배정"
        desc="출퇴근 버튼 없이 표준 근무시각으로 출근부가 만들어집니다(출퇴근 관리 면제). 근무시각은 근무형태가 결정하며 직접 입력하지 않습니다.">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className={T.label}>직무지도원 <span className="text-rose-500">*</span></label>
            <select value={asg.workerId} onChange={(e) => setAsg((p) => ({ ...p, workerId: e.target.value }))} className={`w-full ${T.input}`}>
              <option value="">선택</option>
              {d.workers.map((w) => <option key={w.id} value={w.id}>{w.workerName}</option>)}
            </select>
          </div>
          <div>
            <label className={T.label}>사업체 <span className="text-rose-500">*</span></label>
            <select value={asg.siteId} onChange={(e) => setAsg((p) => ({ ...p, siteId: e.target.value }))} className={`w-full ${T.input}`}>
              <option value="">선택</option>
              {d.sites.map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}
            </select>
          </div>
          <div>
            <label className={T.label}>근무형태 <span className="text-rose-500">*</span></label>
            <select value={asg.workType} onChange={(e) => setAsg((p) => ({ ...p, workType: e.target.value }))} className={`w-full ${T.input}`}>
              {WORK_TYPES.map((w) => <option key={w.v} value={w.v}>{w.label}</option>)}
            </select>
            <p className="mt-1 text-xs font-semibold text-slate-400">{WORK_TYPES.find((w) => w.v === asg.workType)?.time}</p>
          </div>
          <div>
            <label className={T.label}>배정 시작일 <span className="text-rose-500">*</span></label>
            <input type="date" value={asg.startDate} onChange={(e) => setAsg((p) => ({ ...p, startDate: e.target.value }))} className={`w-full ${T.input}`} />
          </div>
          <div>
            <label className={T.label}>배정 종료일 <span className="text-rose-500">*</span></label>
            <input type="date" value={asg.endDate} onChange={(e) => setAsg((p) => ({ ...p, endDate: e.target.value }))} className={`w-full ${T.input}`} />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button disabled={!asgReady || busy}
            onClick={async () => { if (await post("assignments", asg)) setAsg((p) => ({ ...p, workerId: "", siteId: "" })); }}
            className={T.btnPrimary}>배정 등록</button>
        </div>

        {d.assignments.length > 0 && (
          <table className="mt-4 w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-black text-slate-500">
                <th className="w-[140px] py-2 pr-3">직무지도원</th>
                <th className="w-[200px] py-2 pr-3">사업체</th>
                <th className="w-[140px] py-2 pr-3">근무형태</th>
                <th className="w-[200px] py-2 pr-3">기간</th>
                <th className="w-[110px] py-2">출퇴근</th>
              </tr>
            </thead>
            <tbody>
              {d.assignments.map((a) => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="truncate py-2.5 pr-3 font-black text-slate-900">{workerName(a.workerId)}</td>
                  <td className="truncate py-2.5 pr-3 font-semibold text-slate-500">{siteName(a.siteId)}</td>
                  <td className="truncate py-2.5 pr-3 font-semibold text-slate-700">{WORK_TYPES.find((w) => w.v === a.workType)?.label ?? a.workType}</td>
                  <td className="truncate py-2.5 pr-3 font-semibold text-slate-500">
                    {a.startDate.slice(0, 10)} ~ {a.endDate ? a.endDate.slice(0, 10) : "무기한"}
                  </td>
                  <td className="truncate py-2.5 font-semibold text-slate-500">{a.attendanceButtonExempt ? "면제" : "사용"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <AddressMapPicker
        open={!!mapPick}
        initialLat={mapPick?.lat ?? 0}
        initialLon={mapPick?.lon ?? 0}
        initialAddress={mapPick?.address ?? ""}
        onConfirm={(lat, lon, addr) => {
          setSite((p) => ({ ...p, address: addr || p.address, gpsLat: String(lat), gpsLon: String(lon) }));
          setMapPick(null);
        }}
        onClose={() => setMapPick(null)}
      />
    </div>
  );
}
