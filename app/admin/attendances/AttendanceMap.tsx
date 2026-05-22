"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix webpack default icon path issue
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
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });
}

type AttendanceItem = {
  id: string;
  workDate: string;
  startTime: string | null;
  endTime: string | null;
  startLocLat: string | null;
  startLocLon: string | null;
  endLocLat: string | null;
  endLocLon: string | null;
  isGpsModified: boolean;
  withinRange: boolean | null;
  rangeM: number | null;
  site: { companyName: string } | null;
  user: { userName: string } | null;
};

function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

interface Props {
  items: AttendanceItem[];
}

export default function AttendanceMap({ items }: Props) {
  useEffect(() => { fixIcons(); }, []);

  const pins: { lat: number; lon: number; type: "in" | "out"; item: AttendanceItem }[] = [];
  for (const item of items) {
    if (item.startLocLat && item.startLocLon) {
      const lat = parseFloat(item.startLocLat);
      const lon = parseFloat(item.startLocLon);
      if (!isNaN(lat) && !isNaN(lon)) pins.push({ lat, lon, type: "in", item });
    }
    if (item.endLocLat && item.endLocLon) {
      const lat = parseFloat(item.endLocLat);
      const lon = parseFloat(item.endLocLon);
      if (!isNaN(lat) && !isNaN(lon)) pins.push({ lat, lon, type: "out", item });
    }
  }

  if (pins.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, background: "#f9fafb", borderRadius: 12, border: "1px solid #e5e7eb" }}>
        <div style={{ textAlign: "center", color: "#9ca3af" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📍</div>
          <p style={{ margin: 0, fontSize: 14 }}>GPS 좌표가 있는 출퇴근 기록이 없습니다.</p>
        </div>
      </div>
    );
  }

  const center: [number, number] = [
    pins.reduce((s, p) => s + p.lat, 0) / pins.length,
    pins.reduce((s, p) => s + p.lon, 0) / pins.length,
  ];

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #e5e7eb" }}>
      <div style={{ display: "flex", gap: 16, padding: "10px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontSize: 12, color: "#6b7280" }}>
        <span>● <span style={{ color: "#16a34a" }}>●</span> 출근(정상)</span>
        <span>● <span style={{ color: "#ea580c" }}>●</span> 출근(이탈)</span>
        <span>● <span style={{ color: "#6b7280" }}>●</span> 퇴근</span>
        <span style={{ marginLeft: "auto" }}>총 {pins.length}개 위치</span>
      </div>
      <MapContainer center={center} zoom={13} style={{ height: 460 }}>
        <TileLayer
          attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((p, i) => {
          const isIssue = p.item.isGpsModified || p.item.withinRange === false;
          const color = p.type === "out" ? "#6b7280" : isIssue ? "#ea580c" : "#16a34a";
          return (
            <Marker key={i} position={[p.lat, p.lon]} icon={makeIcon(color)}>
              <Popup>
                <div style={{ fontSize: 13, lineHeight: 1.6, minWidth: 160 }}>
                  <b>{p.item.user?.userName || "-"}</b><br />
                  {p.item.site?.companyName || "-"}<br />
                  {p.item.workDate} · {p.type === "in" ? "출근" : "퇴근"} {p.type === "in" ? fmtTime(p.item.startTime) : fmtTime(p.item.endTime)}<br />
                  {p.type === "in" && p.item.isGpsModified && <span style={{ color: "#ea580c" }}>⚠ GPS 이탈</span>}
                  {p.type === "in" && !p.item.isGpsModified && p.item.withinRange === true && <span style={{ color: "#16a34a" }}>✓ 범위 내</span>}
                </div>
              </Popup>
            </Marker>
          );
        })}
        {/* range circles for sites — shown when rangeM exists */}
        {pins.filter(p => p.type === "in" && p.item.rangeM).map((p, i) => (
          <Circle key={`c${i}`} center={[p.lat, p.lon]} radius={p.item.rangeM!}
            pathOptions={{ color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.05, weight: 1 }} />
        ))}
      </MapContainer>
    </div>
  );
}
