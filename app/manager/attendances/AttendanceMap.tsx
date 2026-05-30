"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const fixIcons = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
};

function makeIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7], popupAnchor: [0, -10],
  });
}

type AttendanceItem = {
  id: string; workDate: string;
  startTime: string | null; endTime: string | null;
  startLocLat: string | null; startLocLon: string | null;
  endLocLat: string | null; endLocLon: string | null;
  isGpsModified: boolean; withinRange: boolean | null; rangeM: number | null;
  site: { companyName: string } | null;
  user: { workerName: string } | null;
};

function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export default function AttendanceMap({ items }: { items: AttendanceItem[] }) {
  useEffect(() => { fixIcons(); }, []);

  const pins: { lat: number; lon: number; type: "in" | "out"; item: AttendanceItem }[] = [];
  for (const item of items) {
    if (item.startLocLat && item.startLocLon) {
      const lat = parseFloat(item.startLocLat), lon = parseFloat(item.startLocLon);
      if (!isNaN(lat) && !isNaN(lon)) pins.push({ lat, lon, type: "in", item });
    }
    if (item.endLocLat && item.endLocLon) {
      const lat = parseFloat(item.endLocLat), lon = parseFloat(item.endLocLon);
      if (!isNaN(lat) && !isNaN(lon)) pins.push({ lat, lon, type: "out", item });
    }
  }

  if (pins.length === 0) return (
    <div className="flex h-[400px] flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50">
      <span className="text-3xl">📍</span>
      <p className="text-sm font-semibold text-slate-400">GPS 좌표가 있는 출퇴근 기록이 없습니다.</p>
    </div>
  );

  const center: [number, number] = [
    pins.reduce((s, p) => s + p.lat, 0) / pins.length,
    pins.reduce((s, p) => s + p.lon, 0) / pins.length,
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="flex items-center gap-4 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />출근(정상)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />출근(이탈)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />퇴근
        </span>
        <span className="ml-auto text-slate-400">총 {pins.length}개 위치</span>
      </div>
      <MapContainer center={center} zoom={13} style={{ height: 460 }}>
        <TileLayer
          attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((p, i) => {
          const isIssue = p.item.isGpsModified || p.item.withinRange === false;
          const color = p.type === "out" ? "#94a3b8" : isIssue ? "#f97316" : "#22c55e";
          return (
            <Marker key={i} position={[p.lat, p.lon]} icon={makeIcon(color)}>
              <Popup>
                <div style={{ fontSize: 13, lineHeight: 1.6, minWidth: 160 }}>
                  <b>{p.item.user?.workerName || "-"}</b><br />
                  {p.item.site?.companyName || "-"}<br />
                  {p.item.workDate} · {p.type === "in" ? "출근" : "퇴근"} {p.type === "in" ? fmtTime(p.item.startTime) : fmtTime(p.item.endTime)}<br />
                  {p.type === "in" && p.item.isGpsModified && <span style={{ color: "#f97316" }}>⚠ GPS 이탈</span>}
                  {p.type === "in" && !p.item.isGpsModified && p.item.withinRange === true && <span style={{ color: "#22c55e" }}>✓ 범위 내</span>}
                </div>
              </Popup>
            </Marker>
          );
        })}
        {pins.filter(p => p.type === "in" && p.item.rangeM).map((p, i) => (
          <Circle key={`c${i}`} center={[p.lat, p.lon]} radius={p.item.rangeM!}
            pathOptions={{ color: "#0ea5e9", fillColor: "#0ea5e9", fillOpacity: 0.05, weight: 1 }} />
        ))}
      </MapContainer>
    </div>
  );
}
