"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { T } from "../_styles";
import { List, Map as MapIcon, CalendarDays, Download } from "lucide-react";

const AttendanceMap = dynamic(() => import("./AttendanceMap"), { ssr: false });

type AttendanceItem = {
  id: string; workDate: string;
  startTime: string | null; endTime: string | null;
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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

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
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`/api/admin/attendances?${params}`);
      const data = await res.json();
      if (data.success) { setItems(data.items || []); setTotal(data.total || 0); }
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { fetchData(); }, [yearMonth]);

  const clockedIn = items.filter(i => i.startTime).length;
  const finalized = items.filter(i => i.isFinalClosed).length;
  const gpsIssues = items.filter(i => i.isGpsModified).length;

  const VIEW_TABS: { mode: ViewMode; label: string; Icon: any }[] = [
    { mode: "list",    label: "목록",    Icon: List },
    { mode: "map",     label: "지도",    Icon: MapIcon },
    { mode: "monthly", label: "월별현황", Icon: CalendarDays },
  ];

  return (
    <div className="space-y-5">
      <h1 className={T.pageTitle}>근태 현황</h1>

      <div className={T.summaryGrid}>
        {[
          { label: "전체 기록", value: total,     cls: "text-slate-900" },
          { label: "출근 완료", value: clockedIn,  cls: "text-sky-600" },
          { label: "최종 종료", value: finalized,  cls: "text-emerald-600" },
          { label: "GPS 이탈",  value: gpsIssues,  cls: "text-orange-600" },
        ].map((item, i) => (
          <div key={i} className={T.summaryCard}>
            <p className={`${T.summaryNum} ${item.cls}`}>{item.value}</p>
            <p className={T.summaryLabel}>{item.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="month" value={yearMonth} onChange={e => setYearMonth(e.target.value)}
          className={`w-auto ${T.input}`} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && fetchData()}
          placeholder="직무지도원 이름 / 현장명 검색"
          className={`flex-1 ${T.input}`} />
        <button onClick={fetchData} className={T.btnSecondary}>검색</button>
        <div className="flex gap-1.5">
          <button
            onClick={() => downloadCsv("attendance")}
            disabled={csvLoading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95 disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            근태 CSV
          </button>
          <button
            onClick={() => downloadCsv("logs")}
            disabled={csvLoading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95 disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            일지 CSV
          </button>
        </div>
        <div className="ml-auto flex gap-1.5">
          {VIEW_TABS.map(({ mode, label, Icon }) => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition active:scale-95 ${
                viewMode === mode
                  ? "border-slate-950 bg-slate-950 font-black text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}>
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <div className="h-7 w-7 animate-spin rounded-full border-[2.5px] border-slate-200 border-t-slate-950" />
          <p className="text-sm font-semibold text-slate-400">로딩 중...</p>
        </div>
      ) : viewMode === "map" ? (
        <AttendanceMap items={items} />
      ) : viewMode === "monthly" ? (
        <MonthlyView items={items} yearMonth={yearMonth} />
      ) : items.length === 0 ? (
        <div className={T.tableWrap}><p className={T.empty}>해당 기간에 근태 기록이 없습니다.</p></div>
      ) : (
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
              {items.map(row => (
                <tr key={row.id} className={T.trBase}>
                  <td className={`${T.td} text-xs text-slate-500`}>{row.workDate}</td>
                  <td className={T.td}>
                    <div className="font-black text-slate-900">{row.user?.workerName || "-"}</div>
                    <div className="text-xs text-slate-400">{row.user?.phoneNumber}</div>
                  </td>
                  <td className={T.td}>{row.site?.companyName || "-"}</td>
                  <td className={`${T.td} ${row.startTime ? "font-semibold text-emerald-600" : "text-slate-300"}`}>
                    {formatTime(row.startTime)}
                  </td>
                  <td className={`${T.td} ${row.endTime ? "text-slate-700" : "text-slate-300"}`}>
                    {formatTime(row.endTime)}
                  </td>
                  <td className={T.td}>
                    {row.isFinalClosed
                      ? <span className={`${T.badge} bg-emerald-50 text-emerald-600`}>종료</span>
                      : row.startTime
                      ? <span className={`${T.badge} bg-sky-50 text-sky-600`}>근무중</span>
                      : <span className={`${T.badge} bg-slate-100 text-slate-400`}>출근전</span>}
                  </td>
                  <td className={T.td}>
                    {row.isGpsModified
                      ? <span className={`${T.badge} bg-orange-50 text-orange-600`}>이탈</span>
                      : row.withinRange === true
                      ? <span className="text-sm font-semibold text-emerald-600">정상</span>
                      : <span className="text-slate-300">-</span>}
                  </td>
                  <td className={`${T.td} ${row.startDistanceM && row.startDistanceM > 100 ? "font-semibold text-orange-600" : "text-slate-700"}`}>
                    {row.startDistanceM != null ? `${Math.round(row.startDistanceM)}m` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
