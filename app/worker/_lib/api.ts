// app/worker/_lib/api.ts
// 직무지도원 웹용 API 클라이언트

export interface HomeData {
  userId: string;
  userName: string;
  siteName: string | null;
  siteId: string | null;
  assignmentId: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  allowanceRange: number;
  workType: string | null;
  isExtraTime: boolean;
  traineeCount: number;
  trainees: Trainee[];
  attendanceStatus: "BEFORE" | "WORKING" | "DONE" | "CLOSED";
  attendanceId: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  isFinalClosed: boolean;
}

export interface Trainee {
  id: string;
  name: string;
  gender: string;
  trainingType?: string;
}

export async function fetchHome(userId: string): Promise<HomeData> {
  const res = await fetch(`/api/home/${userId}`, { cache: "no-store" });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "홈 데이터 로드 실패");
  return data.data;
}

export async function clockIn(payload: {
  userId: string;
  latitude: number;
  longitude: number;
  isGpsModified?: boolean;
  confirmOutOfRange?: boolean;
}) {
  const res = await fetch("/api/attendance/clock-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function clockOut(payload: {
  userId: string;
  latitude: number;
  longitude: number;
  isGpsModified?: boolean;
  confirmOutOfRange?: boolean;
  reconfirm?: boolean;
  finalize?: boolean;
}) {
  const res = await fetch("/api/attendance/clock-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export function calcDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function normalizeStatus(data: any): "BEFORE" | "WORKING" | "DONE" | "CLOSED" {
  const raw = String(data?.attendanceStatus || "").toUpperCase();
  if (raw === "CLOSED" || raw === "FINAL" || raw === "FINALIZED") return "CLOSED";
  const isFinal =
    data?.isFinalClosed === true || data?.isFinalized === true || data?.finalized === true;
  if (raw === "DONE" && isFinal) return "CLOSED";
  if (raw === "BEFORE" || raw === "WORKING" || raw === "DONE" || raw === "CLOSED") return raw as any;
  if (raw.includes("IN")) return "WORKING";
  if (raw.includes("OUT")) return "DONE";
  return "BEFORE";
}
