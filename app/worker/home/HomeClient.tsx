"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Home,
  Layers,
  LogOut,
  MapPin,
  PenLine,
  Sparkles,
  User,
  X,
} from "lucide-react";
import type { WorkerPayload } from "../_lib/session";

// ─── 타입 ───────────────────────────────────────────────
type AttendanceStatus = "BEFORE" | "WORKING" | "DONE" | "CLOSED";

interface Trainee {
  id: string;
  name: string;
  gender: string;
}

interface HomeData {
  siteName: string | null;
  siteId: string | null;
  assignmentId: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  allowanceRange: number;
  workType: string | null;
  commuteGuidanceIncluded: boolean;
  customWorkStart: string | null;
  customWorkEnd: string | null;
  traineeCount: number;
  trainees: Trainee[];
  attendanceStatus: AttendanceStatus;
  attendanceId: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  isFinalClosed: boolean;
  serviceStep: string | null;
  trainingType: "PRE" | "FIELD" | "ADAPTATION";
}

// ─── 유틸 ───────────────────────────────────────────────
function calcDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

function normalizeStatus(data: any): AttendanceStatus {
  const raw = String(data?.attendanceStatus || "").toUpperCase();
  const isFinal = data?.isFinalClosed === true || data?.isFinalized === true;
  if (raw === "CLOSED" || raw === "FINAL") return "CLOSED";
  if (raw === "DONE" && isFinal) return "CLOSED";
  if (raw === "BEFORE" || raw === "WORKING" || raw === "DONE" || raw === "CLOSED")
    return raw as AttendanceStatus;
  if (raw.includes("IN")) return "WORKING";
  if (raw.includes("OUT")) return "DONE";
  return "BEFORE";
}

function formatHHMM(val: string | null | Date): string {
  if (!val) return "--:--";
  try {
    const d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return "--:--";
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "--:--";
  }
}

function nowDateStr(): string {
  const d = new Date();
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;
}

function getWorkTimes(
  workType: string | null,
  customStart?: string | null,
  customEnd?: string | null,
): { clockIn: string; clockOut: string } | null {
  if (workType === "AM")       return { clockIn: "09:00", clockOut: "12:00" };
  if (workType === "PM")       return { clockIn: "13:00", clockOut: "17:00" };
  if (workType === "FULL_DAY") return { clockIn: "09:00", clockOut: "18:00" };
  if (workType === "CUSTOM" && customStart && customEnd)
    return { clockIn: customStart, clockOut: customEnd };
  return null;
}

function scheduleAlarm(
  targetHHMM: string,
  alertMinutes: number,
  message: string,
  alreadyFired: Set<string>,
): void {
  if (alertMinutes === 0) return;
  const key = `${targetHHMM}-${message}`;
  if (alreadyFired.has(key)) return;
  const [h, m] = targetHHMM.split(":").map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m - alertMinutes, 0, 0);
  const diff = target.getTime() - now.getTime();
  if (diff < 0 || diff > 60 * 60 * 1000) return;
  alreadyFired.add(key);
  setTimeout(() => {
    const sw = navigator.serviceWorker?.controller;
    if (sw) {
      sw.postMessage({ type: "SHOW_ALARM", body: message });
    } else if (Notification.permission === "granted") {
      new Notification("AbleLink 알람", { body: message, icon: "/icons/icon-192.png" });
    }
  }, diff);
}

async function getCurrentPosition(): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("이 브라우저는 위치 서비스를 지원하지 않습니다."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos.coords),
      err => {
        const msgs: Record<number, string> = {
          1: "위치 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요.",
          2: "위치를 가져올 수 없습니다. 잠시 후 다시 시도해주세요.",
          3: "위치 요청 시간이 초과되었습니다.",
        };
        reject(new Error(msgs[err.code] || "위치 오류가 발생했습니다."));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

// ─── 상태별 설정 ─────────────────────────────────────────
const STATUS_CONFIG: Record<
  AttendanceStatus,
  { label: string; badge: string; card: string; title: string; btn: string }
> = {
  BEFORE:  {
    label: "출근 전",
    badge: "bg-slate-100 text-slate-500",
    card:  "bg-white border-slate-200",
    title: "오늘도 좋은 하루 되세요",
    btn:   "bg-slate-950 text-white shadow-lg shadow-slate-950/20",
  },
  WORKING: {
    label: "근무 중",
    badge: "bg-emerald-100 text-emerald-600",
    card:  "bg-emerald-50 border-emerald-200",
    title: "열심히 일하고 계시네요!",
    btn:   "bg-rose-500 text-white shadow-lg shadow-rose-500/20",
  },
  DONE: {
    label: "마감 중",
    badge: "bg-amber-100 text-amber-600",
    card:  "bg-amber-50 border-amber-200",
    title: "수고하셨습니다",
    btn:   "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20",
  },
  CLOSED: {
    label: "퇴근 완료",
    badge: "bg-slate-100 text-slate-400",
    card:  "bg-slate-50 border-slate-200",
    title: "오늘 하루도 고생하셨습니다",
    btn:   "bg-slate-200 text-slate-400 cursor-not-allowed",
  },
};

const WORK_TYPE_LABEL: Record<string, string> = {
  AM:       "오전 09:00 – 12:00",
  PM:       "오후 13:00 – 17:00",
  FULL_DAY: "전일 09:00 – 18:00",
};

// ─── 메인 컴포넌트 ───────────────────────────────────────
export default function HomeClient({ session }: { session: WorkerPayload }) {
  const router = useRouter();
  const [homeData, setHomeData] = useState<HomeData | null>(null);
  const [status, setStatus] = useState<AttendanceStatus>("BEFORE");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const [dialog, setDialog] = useState<{
    title: string;
    msg: string;
    confirmLabel?: string;
    cancelLabel?: string;
    dismissLabel?: string;
    onConfirm: () => void;
    onCancel?: () => void;
    onDismiss?: () => void;
    variant?: "danger" | "default";
  } | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const profileRef = useRef<HTMLButtonElement>(null);

  const [clockInAlert,  setClockInAlert]  = useState(3);
  const [clockOutAlert, setClockOutAlert] = useState(3);
  const [showAlarmSettings, setShowAlarmSettings] = useState(false);
  const alarmFiredRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/worker/notification")
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setClockInAlert(d.data.clockInAlertMinutes ?? 3);
          setClockOutAlert(d.data.clockOutAlertMinutes ?? 3);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!homeData) return;
    const times = getWorkTimes(homeData.workType, homeData.customWorkStart, homeData.customWorkEnd);
    if (!times) return;
    scheduleAlarm(times.clockIn,  clockInAlert,  `출근 ${clockInAlert}분 전입니다. 출근 버튼을 눌러주세요.`,  alarmFiredRef.current);
    scheduleAlarm(times.clockOut, clockOutAlert, `퇴근 ${clockOutAlert}분 전입니다. 퇴근 버튼을 눌러주세요.`, alarmFiredRef.current);
  }, [homeData, clockInAlert, clockOutAlert]);

  async function saveAlarmSettings(inMin: number, outMin: number) {
    setClockInAlert(inMin);
    setClockOutAlert(outMin);
    await fetch("/api/worker/notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clockInAlertMinutes: inMin, clockOutAlertMinutes: outMin }),
    }).catch(() => {});
  }

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = (msg: string, type: "success" | "error" | "info" = "info") =>
    setToast({ msg, type });

  const fetchHome = useCallback(async () => {
    try {
      const res = await fetch(`/api/home/${session.userId}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      const raw = data.data;
      const normalized: HomeData = {
        siteName: raw.companyName && raw.companyName !== "배정된 현장 없음"
          ? raw.companyName : null,
        siteId: raw.id ? String(raw.id) : null,
        assignmentId: raw.assignmentId ? String(raw.assignmentId) : null,
        gpsLat: raw.gpsLat ?? null,
        gpsLon: raw.gpsLon ?? null,
        allowanceRange: raw.allowanceRange ?? 100,
        workType: raw.workType ?? null,
        commuteGuidanceIncluded: raw.commuteGuidanceIncluded ?? false,
        customWorkStart: raw.customWorkStart ?? null,
        customWorkEnd: raw.customWorkEnd ?? null,
        traineeCount: Array.isArray(raw.trainees) ? raw.trainees.length : 0,
        trainees: (raw.trainees ?? []).map((t: any) => ({
          id: String(t.id),
          name: t.name,
          gender: t.gender === "M" || t.gender === "남" ? "M" : "F",
        })),
        attendanceStatus: normalizeStatus(raw),
        attendanceId: raw.attendanceId ? String(raw.attendanceId) : null,
        workStartTime: raw.startTime ?? null,
        workEndTime: raw.endTime ?? null,
        isFinalClosed: raw.isFinalClosed ?? false,
        serviceStep: raw.serviceStep ?? null,
        trainingType: raw.trainingType ?? "FIELD",
      };

      setHomeData(normalized);
      setStatus(normalized.attendanceStatus);
    } catch (e: any) {
      showToast(e.message || "데이터를 불러올 수 없습니다.", "error");
    } finally {
      setLoading(false);
    }
  }, [session.userId]);

  useEffect(() => {
    fetchHome();
  }, [fetchHome]);

  async function doAttendance(
    endpoint: string,
    extraPayload: Record<string, any> = {},
    confirmOutOfRange = false,
  ): Promise<boolean> {
    setActionLoading(true);
    try {
      let coords: GeolocationCoordinates;
      try {
        coords = await getCurrentPosition();
      } catch (err: any) {
        showToast(err.message, "error");
        return false;
      }

      const { latitude, longitude } = coords;
      const allowance = homeData?.allowanceRange ?? 100;
      const baseLat = homeData?.gpsLat;
      const baseLon = homeData?.gpsLon;
      let isGpsModified = false;

      if (baseLat && baseLon) {
        const dist = Math.round(calcDistance(latitude, longitude, baseLat, baseLon));
        if (dist > allowance && !confirmOutOfRange) {
          return new Promise(resolve => {
            setDialog({
              title: "위치 확인",
              msg: `현장에서 약 ${dist}m 떨어져 있습니다.\n(허용 ${allowance}m)\n현재 위치로 계속 진행하시겠습니까?`,
              confirmLabel: "확인",
              cancelLabel: "취소",
              onConfirm: async () => {
                setDialog(null);
                setActionLoading(true);
                const ok = await doAttendance(endpoint, extraPayload, true);
                setActionLoading(false);
                resolve(ok);
              },
              onCancel: () => { setDialog(null); resolve(false); },
            });
          });
        }
        if (dist > allowance) isGpsModified = true;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: session.userId,
          latitude,
          longitude,
          isGpsModified,
          confirmOutOfRange,
          ...extraPayload,
        }),
      });
      const data = await res.json();

      if (!data.success) {
        if (res.status === 409 && data.code === "OUT_OF_RANGE") {
          return new Promise(resolve => {
            const dist = data.distanceMeters ?? "?";
            const allowed = data.allowedRangeMeters ?? allowance;
            setDialog({
              title: "위치 확인",
              msg: `현장 반경을 벗어났습니다.\n현재 ${dist}m (허용 ${allowed}m)\n계속 진행하시겠습니까?`,
              confirmLabel: "확인",
              cancelLabel: "취소",
              onConfirm: async () => {
                setDialog(null);
                setActionLoading(true);
                const ok = await doAttendance(endpoint, { ...extraPayload, confirmOutOfRange: true }, true);
                setActionLoading(false);
                resolve(ok);
              },
              onCancel: () => { setDialog(null); resolve(false); },
            });
          });
        }
        showToast(data.message || "처리 중 오류가 발생했습니다.", "error");
        return false;
      }

      await fetchHome();
      return true;
    } finally {
      setActionLoading(false);
    }
  }

  async function handleClockIn() {
    const ok = await doAttendance("/api/attendance/clock-in");
    if (ok) showToast("출근 처리되었습니다.", "success");
  }

  async function handleClockOut() {
    const ok = await doAttendance("/api/attendance/clock-out");
    if (ok) showToast("퇴근 처리되었습니다. (퇴근 시간 재확인 가능)", "success");
  }

  async function handleReconfirm() {
    setDialog({
      title: "퇴근 시간 재확인",
      msg: "퇴근 시간을 어떻게 처리할까요?",
      confirmLabel: "재확인",
      cancelLabel: "최종마감",
      dismissLabel: "취소",
      variant: "default",
      onConfirm: async () => {
        setDialog(null);
        const ok = await doAttendance("/api/attendance/clock-out", { reconfirm: true });
        if (ok) showToast("퇴근 시간이 업데이트되었습니다.", "success");
      },
      onCancel: () => {
        setDialog(null);
        setDialog({
          title: "최종 마감 확인",
          msg: "최종 마감 후에는 퇴근 시간 재확인이 불가합니다.\n정말 최종 마감하시겠습니까?",
          confirmLabel: "최종마감",
          cancelLabel: "취소",
          variant: "danger",
          onConfirm: async () => {
            setDialog(null);
            const ok = await doAttendance("/api/attendance/clock-out", { finalize: true });
            if (ok) showToast("오늘 업무가 최종 종료되었습니다.", "success");
          },
          onCancel: () => setDialog(null),
        });
      },
      onDismiss: () => setDialog(null),
    });
  }

  async function handleLogout() {
    setShowProfile(false);
    await fetch("/api/worker/auth/logout", { method: "POST" });
    router.replace("/worker/login");
  }

  // ─── 로딩 ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50">
        <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-900" />
        <p className="mt-3 text-sm font-semibold text-slate-400">불러오는 중...</p>
      </div>
    );
  }

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${pad2(currentTime.getHours())}:${pad2(currentTime.getMinutes())}`;
  const secStr  = pad2(currentTime.getSeconds());

  const cfg = STATUS_CONFIG[status];
  const startStr = formatHHMM(homeData?.workStartTime ?? null);
  const endStr   = formatHHMM(homeData?.workEndTime ?? null);

  const workTypeLabel = homeData?.workType
    ? (WORK_TYPE_LABEL[homeData.workType] ?? `${homeData.customWorkStart}–${homeData.customWorkEnd}`)
    : null;

  const NAV_ITEMS = [
    { icon: Home,           label: "홈",      href: "/worker/home" },
    { icon: CalendarDays,   label: "캘린더",  href: "/worker/calendar" },
    { icon: PenLine,        label: "전자서명", href: "/worker/signature" },
    { icon: FileText,       label: "문서",    href: "/worker/docs" },
    { icon: CircleDollarSign, label: "히스토리", href: "/worker/history" },
  ];

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* ── 헤더 ── */}
      <header className="bg-slate-950 px-5 pb-5 pt-safe-top text-white">
        <div className="mx-auto max-w-md">
          <div className="flex items-center justify-between py-4">
            {/* 로고 + 현장 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xl font-black tracking-tight text-white">AbleLink</span>
              {homeData?.siteName && (
                <button
                  onClick={() => router.push("/worker/site")}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300"
                >
                  <MapPin className="h-3 w-3 text-sky-400" aria-hidden="true" />
                  {homeData.siteName}
                </button>
              )}
            </div>

            {/* 프로필 */}
            <div className="relative">
              <button
                ref={profileRef}
                onClick={() => setShowProfile(v => !v)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-800 text-slate-300 transition active:scale-95"
                aria-label="프로필 메뉴"
              >
                <User className="h-5 w-5" aria-hidden="true" />
              </button>
              {showProfile && (
                <div className="absolute right-0 top-12 z-50 min-w-[140px] rounded-2xl border border-slate-100 bg-white p-2 shadow-xl shadow-slate-950/10">
                  <p className="border-b border-slate-100 px-3 pb-2 pt-1 text-xs font-semibold text-slate-400">
                    {session.userName}님
                  </p>
                  <button
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    onClick={() => { setShowProfile(false); router.push("/worker/profile"); }}
                  >
                    <User className="h-4 w-4 text-slate-400" />
                    정보수정
                  </button>
                  <button
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-rose-500 transition hover:bg-rose-50"
                    onClick={handleLogout}
                  >
                    <LogOut className="h-4 w-4" />
                    로그아웃
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 날짜 + 상태 */}
          <div className="flex items-center justify-between pb-1">
            <span className="text-base font-bold text-slate-300">{nowDateStr()}</span>
            <span className={`rounded-full px-3 py-1 text-xs font-black ${cfg.badge}`}>
              {cfg.label}
            </span>
          </div>
        </div>
      </header>

      {/* ── 컨텐츠 ── */}
      <div className="mx-auto max-w-md px-4 pb-28 pt-4 space-y-4">

        {/* 출퇴근 카드 */}
        <div className={`rounded-3xl border p-5 ${cfg.card}`}>
          <p className="mb-4 text-center text-sm font-semibold text-slate-500">{cfg.title}</p>

          {/* 시간 표시 */}
          <div className="mb-5 flex items-baseline justify-center gap-1">
            {status === "BEFORE" && (
              <>
                <span className="font-black tabular-nums text-[52px] leading-none tracking-tight text-slate-950">
                  {timeStr}
                </span>
                <span className="text-2xl font-semibold text-slate-400">{secStr}</span>
              </>
            )}
            {status === "WORKING" && (
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">출근</p>
                  <p className="text-3xl font-black tabular-nums tracking-tight text-slate-900">{startStr}</p>
                </div>
                <span className="text-xl font-light text-slate-300">/</span>
                <div className="text-center">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">현재</p>
                  <p className="text-3xl font-black tabular-nums tracking-tight text-emerald-600">{timeStr}</p>
                </div>
              </div>
            )}
            {(status === "DONE" || status === "CLOSED") && (
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">출근</p>
                  <p className="text-3xl font-black tabular-nums tracking-tight text-slate-900">{startStr}</p>
                </div>
                <span className="text-xl font-light text-slate-300">–</span>
                <div className="text-center">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">퇴근</p>
                  <p className="text-3xl font-black tabular-nums tracking-tight text-slate-900">{endStr}</p>
                </div>
              </div>
            )}
          </div>

          {/* 액션 버튼 */}
          {status === "BEFORE" && (
            <button
              onClick={handleClockIn}
              disabled={actionLoading}
              className={`w-full min-h-14 rounded-2xl text-base font-black transition active:scale-[0.97] disabled:opacity-70 ${cfg.btn}`}
            >
              {actionLoading ? "위치 확인 중..." : "출근하기"}
            </button>
          )}
          {status === "WORKING" && (
            <button
              onClick={handleClockOut}
              disabled={actionLoading}
              className={`w-full min-h-14 rounded-2xl text-base font-black transition active:scale-[0.97] disabled:opacity-70 ${cfg.btn}`}
            >
              {actionLoading ? "처리 중..." : "퇴근하기"}
            </button>
          )}
          {status === "DONE" && (
            <>
              <button
                onClick={handleReconfirm}
                disabled={actionLoading}
                className={`w-full min-h-14 rounded-2xl text-base font-black transition active:scale-[0.97] disabled:opacity-70 ${cfg.btn}`}
              >
                {actionLoading ? "처리 중..." : "퇴근 시간 재확인"}
              </button>
              <p className="mt-2.5 text-center text-xs font-semibold text-amber-600">
                퇴근 후 60분이 지나면 자동으로 확정됩니다
              </p>
            </>
          )}
          {status === "CLOSED" && (
            <button disabled className={`w-full min-h-14 rounded-2xl text-base font-black ${cfg.btn}`}>
              업무 종료
            </button>
          )}
        </div>

        {/* 근무형태 + 알람 */}
        {homeData?.siteName && homeData.workType && (
          <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wide text-sky-600">근무형태</p>
                <p className="mt-0.5 text-sm font-black text-sky-900">{workTypeLabel}</p>
                {homeData.workType !== "FULL_DAY" && (
                  <p className="mt-0.5 text-[11px] font-semibold text-sky-600">
                    {homeData.commuteGuidanceIncluded
                      ? "출퇴근 지도 포함 (+60분) · 휴게 지도 포함 (+30분)"
                      : "휴게 지도 포함 (+30분)"}
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowAlarmSettings(v => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-600 transition active:scale-95"
                title="알람 설정"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {showAlarmSettings && (
              <AlarmSettingsPanel
                clockInAlert={clockInAlert}
                clockOutAlert={clockOutAlert}
                onSave={saveAlarmSettings}
              />
            )}
          </div>
        )}

        {/* 훈련생 목록 */}
        {homeData?.trainees && homeData.trainees.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="text-sm font-black text-slate-800">담당 훈련생</span>
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-black text-white">
                {homeData.trainees.length}명
              </span>
            </div>
            <div className="space-y-2.5">
              {homeData.trainees.map(t => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3.5 shadow-sm"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-black text-slate-600">
                    {t.name.slice(0, 1)}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-black text-slate-900">{t.name}</p>
                    <p className="text-xs font-semibold text-slate-400">{t.gender === "M" ? "남성" : "여성"}</p>
                  </div>
                  <button
                    onClick={() => {
                      const aid = homeData?.attendanceId ?? "";
                      const trainingType = homeData?.trainingType || "FIELD";
                      const params = new URLSearchParams({
                        traineeId: t.id,
                        traineeName: t.name,
                        trainingType,
                        ...(aid ? { attendanceId: aid } : {}),
                      });
                      router.push(`/worker/worklog?${params.toString()}`);
                    }}
                    className="flex items-center gap-1 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition active:scale-95"
                  >
                    <ClipboardList className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                    일지 작성
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 현장 없을 때 */}
        {!homeData?.siteName && (
          <div className="rounded-3xl border border-slate-100 bg-white py-12 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
              <MapPin className="h-7 w-7 text-slate-400" aria-hidden="true" />
            </div>
            <p className="mb-5 text-sm font-semibold text-slate-500">배정된 현장이 없습니다.</p>
            <button
              onClick={() => router.push("/worker/site/register")}
              className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-95"
            >
              현장 등록하기
            </button>
          </div>
        )}

        {/* AI 일괄 일지 작성 버튼 */}
        {homeData?.siteName && (
          <button
            onClick={() => router.push("/worker/worklog/batch")}
            className="flex w-full items-center gap-3 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3.5 text-left transition active:scale-[0.98]"
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-100">
              <Layers className="h-5 w-5 text-violet-600" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-black text-violet-900">AI 일지 일괄 작성</p>
              <p className="text-xs font-semibold text-violet-500">음성 1번으로 여러 날짜 일지를 한번에 작성</p>
            </div>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-violet-400" aria-hidden="true" />
          </button>
        )}

        {/* PREMIUM 배너 */}
        {homeData?.siteName && (
          <button
            onClick={() => router.push("/worker/subscribe")}
            className="flex w-full items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3.5 text-left transition active:scale-[0.98]"
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-sky-100">
              <Sparkles className="h-5 w-5 text-sky-500" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-black text-sky-900">AI 기능 &amp; PDF 자동 생성</p>
              <p className="text-xs font-semibold text-sky-600">음성 일지 작성, PDF 자동 발송 등 PREMIUM 기능</p>
            </div>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-sky-400" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* ── 다이얼로그 ── */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-5">
          <div className="w-full max-w-xs rounded-3xl bg-white p-6 shadow-2xl">
            <p className="mb-2 text-base font-black text-slate-900">{dialog.title}</p>
            <p className="mb-5 whitespace-pre-line text-sm font-semibold leading-6 text-slate-500">
              {dialog.msg}
            </p>
            {dialog.onDismiss ? (
              <div className="space-y-2">
                <button
                  className="w-full min-h-12 rounded-2xl bg-slate-950 text-sm font-black text-white transition active:scale-[0.97]"
                  onClick={dialog.onConfirm}
                >
                  {dialog.confirmLabel ?? "확인"}
                </button>
                <button
                  className="w-full min-h-12 rounded-2xl bg-rose-500 text-sm font-black text-white transition active:scale-[0.97]"
                  onClick={dialog.onCancel}
                >
                  {dialog.cancelLabel ?? "최종마감"}
                </button>
                <button
                  className="w-full min-h-12 rounded-2xl bg-slate-100 text-sm font-black text-slate-600 transition active:scale-[0.97]"
                  onClick={dialog.onDismiss}
                >
                  {dialog.dismissLabel ?? "취소"}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                {dialog.onCancel && (
                  <button
                    className="flex-1 min-h-12 rounded-2xl bg-slate-100 text-sm font-black text-slate-600 transition active:scale-[0.97]"
                    onClick={dialog.onCancel}
                  >
                    {dialog.cancelLabel ?? "취소"}
                  </button>
                )}
                <button
                  className={`flex-1 min-h-12 rounded-2xl text-sm font-black text-white transition active:scale-[0.97] ${
                    dialog.variant === "danger" ? "bg-rose-500" : "bg-slate-950"
                  }`}
                  onClick={dialog.onConfirm}
                >
                  {dialog.confirmLabel ?? "확인"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 토스트 ── */}
      {toast && (
        <div
          className={`fixed bottom-24 left-1/2 z-50 -translate-x-1/2 max-w-[90vw] rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-lg ${
            toast.type === "success" ? "bg-emerald-500" :
            toast.type === "error"   ? "bg-rose-500"    : "bg-slate-900"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* ── 하단 네비게이션 ── */}
      <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 border-t border-slate-100 bg-white pb-safe-bottom">
        {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
          const isActive = typeof window !== "undefined" && window.location.pathname === href;
          return (
            <button
              key={href}
              onClick={() => router.push(href)}
              className="flex flex-1 flex-col items-center justify-center gap-1 py-3"
            >
              <Icon
                className={`h-5 w-5 ${isActive ? "text-slate-950" : "text-slate-400"}`}
                aria-hidden="true"
              />
              <span className={`text-[10px] font-black ${isActive ? "text-slate-950" : "text-slate-400"}`}>
                {label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ─── 알람 설정 패널 ──────────────────────────────────────────
function AlarmSettingsPanel({
  clockInAlert,
  clockOutAlert,
  onSave,
}: {
  clockInAlert: number;
  clockOutAlert: number;
  onSave: (inMin: number, outMin: number) => void;
}) {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default",
  );

  async function requestPermission() {
    const result = await Notification.requestPermission();
    setPermission(result);
  }

  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true);

  return (
    <div className="mt-3 rounded-2xl border border-sky-200 bg-white p-4">
      <p className="mb-3 text-xs font-black text-slate-800">출퇴근 알람 설정</p>

      {[
        { label: "출근 알람", value: clockInAlert,  set: (v: number) => onSave(v, clockOutAlert) },
        { label: "퇴근 알람", value: clockOutAlert, set: (v: number) => onSave(clockInAlert, v) },
      ].map(({ label, value, set }) => (
        <div key={label} className="mb-2.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-600">{label}</span>
          <div className="flex gap-1.5">
            {[0, 1, 3, 5, 10].map(m => (
              <button
                key={m}
                onClick={() => set(m)}
                className={`rounded-lg px-2.5 py-1 text-xs font-black transition ${
                  value === m
                    ? "bg-sky-500 text-white"
                    : "border border-slate-200 bg-white text-slate-500"
                }`}
              >
                {m === 0 ? "끄기" : `${m}분`}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="mt-3 rounded-xl bg-slate-50 p-3">
        {permission === "granted" ? (
          <p className="text-[11px] font-semibold text-emerald-600">
            알림 권한이 허용되어 있습니다{isStandalone ? " · 앱 모드" : ""}
          </p>
        ) : permission === "denied" ? (
          <div>
            <p className="text-[11px] font-semibold text-rose-600">알림 권한이 차단되어 있습니다</p>
            <p className="mt-1 text-[10px] text-slate-400">브라우저 설정 → 사이트 설정 → 알림에서 허용해주세요</p>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-amber-600">알림 권한이 필요합니다</p>
            <button
              onClick={requestPermission}
              className="rounded-lg bg-slate-900 px-3 py-1 text-[11px] font-black text-white"
            >
              권한 허용
            </button>
          </div>
        )}
        {!isStandalone && permission === "granted" && (
          <p className="mt-1.5 text-[10px] text-slate-400">
            앱을 홈 화면에 설치하면 백그라운드에서도 알림을 받을 수 있습니다
          </p>
        )}
      </div>
    </div>
  );
}
