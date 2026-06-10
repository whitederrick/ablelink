"use client";

// 근태 캘린더 — 현장/직무지도원 조건조회 + 월간 출근현황. (전체 근무자 수 + 선택 직무지도원 캘린더)
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import { StatCardRow } from "../_components/StatCard";

type Worker = { id: string; workerName: string; siteName: string };
type AttRec = { workDate: string; status: string; startTime: string | null; endTime: string | null; isFinalClosed: boolean; isGpsModified: boolean };

const DOW_HEADER = ["일", "월", "화", "수", "목", "금", "토"];

function pad2(n: number) { return String(n).padStart(2, "0"); }
function nowYM() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function hhMM(iso: string | null) {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export default function ManagerCalendarPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [siteFilter, setSiteFilter] = useState("");           // 현장명("" = 전체)
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [records, setRecords] = useState<AttRec[]>([]);
  const [yearMonth, setYearMonth] = useState(nowYM());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/admin/workers?pageSize=200").then(r => r.json())
      .then(d => {
        if (d.success) {
          const list: Worker[] = (d.data ?? []).map((c: any) => ({
            id: c.id, workerName: c.workerName, siteName: c.activeAssignment?.siteName ?? "",
          }));
          setWorkers(list);
          if (list.length > 0) setSelectedWorker(list[0]);
        }
      }).catch(() => {});
  }, []);

  // 현장 목록(배정 있는 직무지도원의 현장)
  const sites = useMemo(
    () => [...new Set(workers.map(w => w.siteName).filter(s => s && s !== "-"))].sort(),
    [workers],
  );
  const filteredWorkers = useMemo(
    () => siteFilter ? workers.filter(w => w.siteName === siteFilter) : workers,
    [workers, siteFilter],
  );

  // 현장 필터 변경 시, 선택 직무지도원이 목록에 없으면 첫 번째로 자동 전환
  useEffect(() => {
    if (filteredWorkers.length === 0) { setSelectedWorker(null); return; }
    if (!selectedWorker || !filteredWorkers.some(w => w.id === selectedWorker.id)) {
      setSelectedWorker(filteredWorkers[0]);
    }
  }, [filteredWorkers]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    if (!selectedWorker) { setRecords([]); return; }
    setLoading(true);
    fetch(`/api/admin/attendances?workerId=${selectedWorker.id}&yearMonth=${yearMonth}&pageSize=200`)
      .then(r => r.json())
      .then(d => { if (d.success) setRecords(d.items ?? []); }) // ✅ API는 items로 반환
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedWorker, yearMonth]);

  useEffect(() => { load(); }, [load]);

  function changeMonth(delta: number) {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYearMonth(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }

  const [y, m] = yearMonth.split("-").map(Number);
  const firstDay = new Date(y, m - 1, 1).getDay();
  const lastDate = new Date(y, m, 0).getDate();
  const recordMap: Record<string, AttRec> = {};
  for (const r of records) recordMap[r.workDate] = r;

  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: lastDate }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = todayStr();

  function dayColor(dateStr: string) {
    const r = recordMap[dateStr];
    if (!r) return "";
    if (r.status === "WORKING") return "bg-sky-50 border-sky-200";
    if (r.isFinalClosed) return "bg-emerald-50 border-emerald-200";
    if (r.status === "DONE") return "bg-amber-50 border-amber-200";
    return "";
  }

  const working = records.filter(r => r.startTime).length;
  const finalized = records.filter(r => r.isFinalClosed).length;
  const todayRec = recordMap[today];
  const isWorkingToday = todayRec?.status === "WORKING";

  return (
    <div>
      <PageHeader title="근태 캘린더" sub="현장·직무지도원을 선택해 월간 출근 현황을 확인합니다." />

      <StatCardRow
        className="mb-5"
        cols={3}
        items={[
          { label: siteFilter ? `${siteFilter} 직무지도원` : "전체 직무지도원", value: `${filteredWorkers.length}명` },
          { label: "이번 달 출근", value: `${working}일`, tone: "sky" },
          { label: "확정", value: `${finalized}일`, tone: "emerald" },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} className={`min-w-[160px] ${T.select}`}>
          <option value="">전체 현장</option>
          {sites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={selectedWorker?.id ?? ""} onChange={e => setSelectedWorker(filteredWorkers.find(x => x.id === e.target.value) ?? null)}
          className={`min-w-[160px] ${T.select}`}>
          {filteredWorkers.length === 0 && <option value="">직무지도원 없음</option>}
          {filteredWorkers.map(c => <option key={c.id} value={c.id}>{c.workerName}</option>)}
        </select>
        <div className="flex items-center gap-1.5">
          <button onClick={() => changeMonth(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:bg-slate-50 active:scale-95">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[110px] text-center text-base font-black text-slate-900">{yearMonth.replace("-", "년 ")}월</span>
          <button onClick={() => changeMonth(1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:bg-slate-50 active:scale-95">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button onClick={() => window.open(`/api/admin/export/csv?type=attendance&from=${yearMonth}-01&to=${yearMonth}-${pad2(lastDate)}&workerId=${selectedWorker?.id ?? ""}`, "_blank")}
          disabled={!selectedWorker}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 active:scale-95 disabled:opacity-40">
          <Download className="h-4 w-4" />내보내기
        </button>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {selectedWorker ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <b className="text-slate-900">{selectedWorker.workerName}</b>
            {selectedWorker.siteName && selectedWorker.siteName !== "-" && <span className="text-slate-400">· {selectedWorker.siteName}</span>}
            {isWorkingToday && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-black text-sky-700">오늘 근무중</span>}
          </p>
        ) : <span />}
        {/* 범례 — 달력 우상단 */}
        <div className="flex flex-wrap items-center gap-3 text-[12px] font-semibold text-slate-500">
          {[["bg-sky-50 border border-sky-200", "근무중"], ["bg-amber-50 border border-amber-200", "마감중"], ["bg-emerald-50 border border-emerald-200", "확정"]].map(([cls, label]) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`h-3 w-3 rounded ${cls}`} /><span>{label}</span>
            </div>
          ))}
          <span className="text-slate-400">✓확정 · ⚠GPS · 오늘=테두리</span>
        </div>
      </div>

      {!selectedWorker ? (
        <div className="flex h-60 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm font-semibold text-slate-400">선택한 현장에 배정된 직무지도원이 없습니다.</p>
        </div>
      ) : loading ? (
        <div className="flex h-60 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" /></div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
            {DOW_HEADER.map((d, i) => (
              <div key={d} className={`py-2.5 text-center text-[15px] font-black ${i === 0 ? "text-rose-400" : i === 6 ? "text-blue-400" : "text-slate-500"}`}>{d}</div>
            ))}
          </div>
          {/* 날짜 그리드 */}
          {Array.from({ length: cells.length / 7 }, (_, week) => (
            <div key={week} className="grid grid-cols-7 border-b border-slate-50 last:border-0">
              {cells.slice(week * 7, (week + 1) * 7).map((day, di) => {
                const dateStr = day ? `${yearMonth}-${pad2(day)}` : "";
                const isWeekend = di === 0 || di === 6;
                const r = day ? recordMap[dateStr] : undefined;
                const isToday = dateStr === today;
                return (
                  <div key={di} className={`relative min-h-[100px] border-r border-slate-50 p-2 last:border-0 ${day ? dayColor(dateStr) : "bg-slate-50/50"} ${isToday ? "ring-2 ring-inset ring-slate-900/70" : ""}`}>
                    {day && (
                      <>
                        <p className={`text-[17px] font-black ${isWeekend ? (di === 0 ? "text-rose-400" : "text-blue-400") : "text-slate-800"}`}>{day}</p>
                        {r && (
                          <div className="mt-1 text-[13px] font-semibold leading-tight text-slate-700">
                            {r.status === "WORKING"
                              ? <span className="text-sky-700">근무중 {hhMM(r.startTime)}~</span>
                              : <span>{hhMM(r.startTime)}~{hhMM(r.endTime)}</span>}
                            <div className="mt-0.5 flex gap-1">
                              {r.isFinalClosed && <span className="text-emerald-600">✓확정</span>}
                              {r.isGpsModified && <span className="text-amber-600">⚠GPS</span>}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
