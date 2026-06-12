"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import Pagination from "../_components/Pagination";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import StatusBadge from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import { List, Map as MapIcon, CalendarDays, Download } from "lucide-react";

const LIST_PAGE_SIZE = 10;
// 근태 상태 뱃지 매핑(공통 톤)
const ATT_BADGE = {
  done: { label: "종료", tone: "emerald" as const },
  working: { label: "근무중", tone: "sky" as const },
  before: { label: "출근전", tone: "slate" as const },
  gps: { label: "이탈", tone: "amber" as const },
};

const AttendanceMap = dynamic(() => import("./AttendanceMap"), { ssr: false });

type AttendanceItem = {
  id: string; workDate: string;
  startTime: string | null; endTime: string | null;
  actualStartTime: string | null; actualEndTime: string | null;
  isFinalClosed: boolean; isGpsModified: boolean;
  status: string;
  startLocLat: string | null; startLocLon: string | null;
  endLocLat: string | null;   endLocLon: string | null;
  startDistanceM: number | null; endDistanceM: number | null;
  withinRange: boolean | null; rangeM: number | null;
  site: { companyName: string } | null;
  user: { workerName: string; phoneNumber: string } | null;
};

type ViewMode = "list" | "map" | "monthly";

function pad2(n: number) { return String(n).padStart(2, "0"); }
function getDefaultYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function formatTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function daysInMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function cellBgCls(item?: AttendanceItem): string {
  if (!item) return "bg-slate-100";
  if (item.isGpsModified) return "bg-orange-200";
  if (!item.startTime) return "bg-rose-100";
  if (!item.isFinalClosed) return "bg-yellow-100";
  return "bg-emerald-100";
}
function cellTextCls(item?: AttendanceItem): string {
  if (!item || !item.startTime) return "text-slate-300";
  if (item.isGpsModified) return "text-orange-700";
  if (!item.isFinalClosed) return "text-yellow-700";
  return "text-emerald-600";
}
function cellLabel(item?: AttendanceItem): string {
  if (!item || !item.startTime) return "-";
  if (item.isGpsModified) return "⚠";
  if (!item.isFinalClosed) return "▷";
  return "✓";
}

function MonthlyView({ items, yearMonth }: { items: AttendanceItem[]; yearMonth: string }) {
  const days = daysInMonth(yearMonth);
  const dayNums = Array.from({ length: days }, (_, i) => i + 1);
  const [y, m] = yearMonth.split("-").map(Number);
  const dow = ["일", "월", "화", "수", "목", "금", "토"];

  const workers = useMemo(() => {
    const map = new Map<string, { name: string; site: string; byDay: Map<string, AttendanceItem> }>();
    for (const item of items) {
      const uid = item.user?.workerName || item.id;
      if (!map.has(uid)) map.set(uid, { name: uid, site: item.site?.companyName || "-", byDay: new Map() });
      map.get(uid)!.byDay.set(item.workDate.slice(8), item);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  if (workers.length === 0) return (
    <div className="flex h-[200px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
      <p className="text-sm font-semibold text-slate-400">해당 기간에 근태 기록이 없습니다.</p>
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div className="mb-3 flex gap-4">
          {[
            { cls: "bg-emerald-100", label: "정상 종료" },
            { cls: "bg-yellow-100",  label: "미종료" },
            { cls: "bg-orange-200",  label: "GPS이탈" },
            { cls: "bg-rose-100",    label: "미출근" },
            { cls: "bg-slate-100",   label: "기록없음" },
          ].map(({ cls, label }) => (
            <span key={label} className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <span className={`inline-block h-3 w-3 rounded-sm ${cls}`} />{label}
            </span>
          ))}
        </div>

        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[100px] border border-slate-200 bg-slate-50 px-3 py-2 text-left font-black text-slate-700">직무지도원</th>
              <th className="sticky left-[100px] z-10 min-w-[80px] border border-slate-200 bg-slate-50 px-2 py-2 text-center font-black text-slate-700">현장</th>
              {dayNums.map(d => {
                const weekday = new Date(y, m - 1, d).getDay();
                return (
                  <th key={d} className={`min-w-[28px] border border-slate-200 bg-slate-50 px-0.5 py-1 text-center ${weekday === 0 ? "text-rose-500" : weekday === 6 ? "text-sky-600" : "text-slate-600"}`}>
                    <div className="font-black">{d}</div>
                    <div className={`text-[10px] font-semibold ${weekday === 0 ? "text-rose-400" : weekday === 6 ? "text-sky-400" : "text-slate-400"}`}>{dow[weekday]}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {workers.map(worker => (
              <tr key={worker.name}>
                <td className="sticky left-0 z-10 whitespace-nowrap border border-slate-200 bg-white px-3 py-1.5 font-black text-slate-900">{worker.name}</td>
                <td className="sticky left-[100px] z-10 whitespace-nowrap border border-slate-200 bg-white px-2 py-1.5 text-slate-500">{worker.site}</td>
                {dayNums.map(d => {
                  const item = worker.byDay.get(pad2(d));
                  return (
                    <td key={d} className={`border border-slate-200 p-0.5 text-center ${cellBgCls(item)}`}>
                      <span className={`font-black ${cellTextCls(item)}`}>{cellLabel(item)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AttendancesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [yearMonth, setYearMonth] = useState(getDefaultYearMonth());
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<AttendanceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  async function downloadCsv(type: "attendance" | "logs") {
    setCsvLoading(true);
    try {
      const [y, m] = yearMonth.split("-").map(Number);
      const from = `${yearMonth}-01`;
      const to = `${yearMonth}-${pad2(new Date(y, m, 0).getDate())}`;
      const params = new URLSearchParams({ type, from, to });
      const res = await fetch(`/api/admin/export/csv?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data?.message || res.statusText;
        if (res.status === 403 || msg?.includes("플랜")) {
          alert("이 기능은 현재 플랜에서 제한됩니다. 보관기간 내 데이터만 다운로드됩니다.");
        } else {
          alert("다운로드 실패: " + msg);
        }
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("content-disposition") ?? "";
      const match = cd.match(/filename\*=UTF-8''(.+)/);
      a.download = match ? decodeURIComponent(match[1]) : `export_${yearMonth}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("다운로드 중 오류가 발생했습니다.");
    } finally {
      setCsvLoading(false);
    }
  }

  async function fetchData() {
    setLoading(true);
    try {
      const [y, m] = yearMonth.split("-").map(Number);
      const from = `${yearMonth}-01`;
      const to = `${yearMonth}-${pad2(new Date(y, m, 0).getDate())}`;
      const params = new URLSearchParams({ from, to, pageSize: "500", page: "1" });
      const res = await fetch(`/api/admin/attendances?${params}`);
      const data = await res.json();
      if (data.success) setItems(data.items || []);
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { fetchData(); }, [yearMonth]);

  // 검색(직무지도원/현장명) + 상태 멀티필터 — 클라이언트 처리(서버 q 미지원 일관화)
  function matchStatus(i: AttendanceItem, keys: string[]) {
    if (keys.length === 0) return true;
    return keys.some(k =>
      k === "done" ? i.isFinalClosed :
      k === "working" ? (!!i.startTime && !i.isFinalClosed) :
      k === "before" ? !i.startTime :
      k === "gps" ? i.isGpsModified : false);
  }
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i =>
      (!q || (i.user?.workerName ?? "").toLowerCase().includes(q) || (i.site?.companyName ?? "").toLowerCase().includes(q))
      && matchStatus(i, statusFilter));
  }, [items, search, statusFilter]);

  const clockedIn = filtered.filter(i => i.startTime).length;
  const finalized = filtered.filter(i => i.isFinalClosed).length;
  const gpsIssues = filtered.filter(i => i.isGpsModified).length;

  // 목록 페이징(월 데이터 클라 분할). 지도·월별현황은 전체 사용.
  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [yearMonth, search, viewMode, statusFilter]);

  const statusFilters: FilterChip[] = [
    { value: "working", label: "근무중", count: items.filter(i => i.startTime && !i.isFinalClosed).length },
    { value: "done", label: "종료", count: items.filter(i => i.isFinalClosed).length },
    { value: "before", label: "출근전", count: items.filter(i => !i.startTime).length },
    { value: "gps", label: "GPS이탈", count: items.filter(i => i.isGpsModified).length },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  const VIEW_TABS: { mode: ViewMode; label: string; Icon: any }[] = [
    { mode: "list",    label: "목록",    Icon: List },
    { mode: "map",     label: "지도",    Icon: MapIcon },
    { mode: "monthly", label: "월별현황", Icon: CalendarDays },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="근태 현황" />

      <StatCardRow
        cols={4}
        items={[
          { label: "전체 기록", value: filtered.length },
          { label: "출근 완료", value: clockedIn, tone: "sky" },
          { label: "최종 종료", value: finalized, tone: "emerald" },
          { label: "GPS 이탈", value: gpsIssues, tone: "amber" },
        ]}
      />

      <ListToolbar
        query={search}
        onQueryChange={setSearch}
        placeholder="직무지도원 이름 / 현장명 검색"
        filters={statusFilters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
        extra={
          <>
            <input type="month" value={yearMonth} onChange={e => setYearMonth(e.target.value)} className={`w-auto ${T.input}`} />
            <button onClick={() => downloadCsv("attendance")} disabled={csvLoading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95 disabled:opacity-50">
              <Download className="h-4 w-4" />근태 CSV
            </button>
            <button onClick={() => downloadCsv("logs")} disabled={csvLoading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95 disabled:opacity-50">
              <Download className="h-4 w-4" />일지 CSV
            </button>
            <div className="flex gap-1.5">
              {VIEW_TABS.map(({ mode, label, Icon }) => (
                <button key={mode} onClick={() => setViewMode(mode)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition active:scale-95 ${
                    viewMode === mode ? "border-slate-950 bg-slate-950 font-black text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}>
                  <Icon className="h-4 w-4" />{label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 border-l border-slate-200 pl-2">
              <StatusBadge status="working" map={ATT_BADGE} />
              <StatusBadge status="done" map={ATT_BADGE} />
              <StatusBadge status="before" map={ATT_BADGE} />
              <StatusBadge status="gps" map={ATT_BADGE} />
            </div>
          </>
        }
      />

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <div className="h-7 w-7 animate-spin rounded-full border-[2.5px] border-slate-200 border-t-slate-950" />
          <p className="text-sm font-semibold text-slate-400">로딩 중...</p>
        </div>
      ) : viewMode === "map" ? (
        <AttendanceMap items={filtered} />
      ) : viewMode === "monthly" ? (
        <MonthlyView items={filtered} yearMonth={yearMonth} />
      ) : filtered.length === 0 ? (
        <div className={T.tableWrap}><p className={T.empty}>해당 기간에 근태 기록이 없습니다.</p></div>
      ) : (
        <>
        <div className={T.tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["날짜", "직무지도원", "현장", "출근", "퇴근", "상태", "GPS", "출근 거리"].map(h => (
                  <th key={h} className={T.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageItems.map(row => (
                <tr key={row.id} className={T.trBase}>
                  <td className={T.td}>{row.workDate}</td>
                  <td className={T.td}>
                    {row.user?.workerName || "-"}{row.user?.phoneNumber ? ` (${row.user.phoneNumber})` : ""}
                  </td>
                  <td className={T.td}>{row.site?.companyName || "-"}</td>
                  <td className={`${T.td} ${row.startTime ? "font-semibold text-emerald-600" : ""}`}>
                    {formatTime(row.startTime)}
                    {row.actualStartTime && (
                      <span className="mt-0.5 block text-[11px] font-medium text-slate-400">
                        실제 {formatTime(row.actualStartTime)}
                      </span>
                    )}
                  </td>
                  <td className={T.td}>
                    {formatTime(row.endTime)}
                    {row.actualEndTime && (
                      <span className="mt-0.5 block text-[11px] font-medium text-slate-400">
                        실제 {formatTime(row.actualEndTime)}
                      </span>
                    )}
                  </td>
                  <td className={T.td}>
                    <StatusBadge status={row.isFinalClosed ? "done" : row.startTime ? "working" : "before"} map={ATT_BADGE} />
                  </td>
                  <td className={T.td}>
                    {row.isGpsModified
                      ? <StatusBadge status="gps" map={ATT_BADGE} />
                      : row.withinRange === true
                      ? <span className="font-semibold text-emerald-600">정상</span>
                      : "-"}
                  </td>
                  <td className={`${T.td} ${row.startDistanceM && row.startDistanceM > 100 ? "font-semibold text-orange-600" : ""}`}>
                    {row.startDistanceM != null ? `${Math.round(row.startDistanceM)}m` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination className="mt-4" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
