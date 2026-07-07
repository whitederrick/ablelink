"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ChevronsUpDown,
  CircleDollarSign,
  ClipboardList,
  FileText,
  FileWarning,
  Home,
  Layers,
  LogOut,
  MapPin,
  Megaphone,
  PenLine,
  Search,
  Send,
  Sparkles,
  User,
  X,
  Zap,
} from "lucide-react";
import type { WorkerPayload } from "../_lib/session";
import type { HomeSummary } from "@/lib/worker/homeSummary";

// 배정 요청 근무형태 라벨
const REQ_WT_LABEL: Record<string, string> = { AM: "오전", PM: "오후", FULL_DAY: "전일", CUSTOM: "직접" };
// 멀티 현장 전환 스위처 근무형태 짧은 라벨
const WORKTYPE_SHORT: Record<string, string> = { AM: "오전", PM: "오후", FULL_DAY: "종일", CUSTOM: "맞춤" };
import { LATE_CLOCK_OUT_REASONS } from "@/lib/attendance/lateClockOut";
import { setActiveAssignmentCookie } from "../_lib/activeAssignmentCookie";

type MissedClockOut = { attendanceId: string; workDate: string; siteName: string };

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
  attendanceButtonExempt: boolean;
  pipelineGate: "AWAITING_CONTRACT" | "NOT_CONNECTED" | "LOCATION_NOT_CONFIRMED" | null;
  attendanceId: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  actualStartTime: string | null;  // 실제 버튼 시각(화면 표시용)
  actualEndTime: string | null;
  isFinalClosed: boolean;
  serviceStep: string | null;
  trainingType: "PRE" | "FIELD" | "ADAPTATION";
}

type NoticeItem = { id: string; title: string; body: string; type: string; kind?: string; yearMonth: string | null; link?: string | null; read: boolean; createdAt: string };

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
      new Notification("Able-Link 알람", { body: message, icon: "/icons/icon-192.png" });
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

// home-summary의 home 객체 → HomeData 정규화 (초기 시드/재조회 공용)
function normalizeHome(raw: any): HomeData {
  return {
    siteName: raw.companyName && raw.companyName !== "배정된 현장 없음" ? raw.companyName : null,
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
    attendanceButtonExempt: raw.attendanceButtonExempt ?? false,
    pipelineGate: raw.pipelineGate ?? null,
    attendanceId: raw.attendanceId ? String(raw.attendanceId) : null,
    workStartTime: raw.startTime ?? null,
    workEndTime: raw.endTime ?? null,
    actualStartTime: raw.actualStartTime ?? null,
    actualEndTime: raw.actualEndTime ?? null,
    isFinalClosed: raw.isFinalClosed ?? false,
    serviceStep: raw.serviceStep ?? null,
    trainingType: raw.trainingType ?? "FIELD",
  };
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
export default function HomeClient({ session, initialData }: { session: WorkerPayload; initialData: HomeSummary | null }) {
  const router = useRouter();
  const [homeData, setHomeData] = useState<HomeData | null>(initialData ? normalizeHome(initialData.home) : null);
  const [status, setStatus] = useState<AttendanceStatus>(initialData ? normalizeStatus(initialData.home) : "BEFORE");
  const [loading, setLoading] = useState(!initialData);
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
  const [quickOpen, setQuickOpen] = useState(false); // 하단 중앙 고정 퀵메뉴(FAB) 펼침
  const profileRef = useRef<HTMLButtonElement>(null);

  const [clockInAlert,  setClockInAlert]  = useState(initialData?.alarm.clockInAlertMinutes ?? 3);
  const [clockOutAlert, setClockOutAlert] = useState(initialData?.alarm.clockOutAlertMinutes ?? 3);
  const [showAlarmSettings, setShowAlarmSettings] = useState(false);
  const alarmFiredRef = useRef<Set<string>>(new Set());
  const [premium, setPremium] = useState<{ access: boolean; reason: string | null; message: string | null }>({
    access: initialData?.premiumAccess ?? true,
    reason: initialData?.premiumReason ?? null,
    message: initialData?.premiumMessage ?? null,
  });
  const [unreadNotices,  setUnreadNotices]  = useState(initialData?.unreadCount ?? 0);
  const [showNotices,    setShowNotices]    = useState(false);
  const [notices,        setNotices]        = useState<NoticeItem[]>(initialData?.notices ?? []);
  // 출퇴근 카드 격려 문구(시스템 관리자 편집, SystemConfig)
  const [homeMessages,   setHomeMessages]   = useState<HomeSummary["homeMessages"] | null>(initialData?.homeMessages ?? null);
  // 놓친 업무 / 오늘 일지 상태
  const [missingCount,   setMissingCount]   = useState(initialData?.missing.count ?? 0);
  const [todayMissing,   setTodayMissing]   = useState(initialData?.today.missingTraineeCount ?? 0);
  // 오늘 일지 쓰기 — 훈련생 선택 시트
  const [showLogPicker,  setShowLogPicker]  = useState(false);
  // 퇴근 미실행(보정대기) — 늦은 퇴근 처리
  const [pendingRequests, setPendingRequests] = useState<HomeSummary["pendingRequests"]>(initialData?.pendingRequests ?? []);
  const [reqWtChoice, setReqWtChoice] = useState<Record<string, string>>({});
  const [missedClockOuts, setMissedClockOuts] = useState<MissedClockOut[]>(initialData?.missedClockOuts ?? []);
  // 멀티 현장: 오늘 활성 배정 목록 + 현재 선택 배정 + 전환 시트 열림
  const [activeAssignments, setActiveAssignments] = useState<HomeSummary["activeAssignments"]>(initialData?.activeAssignments ?? []);
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(initialData?.activeAssignmentId ?? null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [missedTarget,    setMissedTarget]    = useState<MissedClockOut | null>(null);
  const [missedReason,    setMissedReason]    = useState<string>("");
  const [missedReasonText, setMissedReasonText] = useState<string>("");

  // 단일 통합 조회 (출퇴근/일지 액션 후 재검증). 첫 로드는 서버 프리페치(initialData)로 처리.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/worker/home-summary", { cache: "no-store" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      const d: HomeSummary = data.data;
      setHomeData(normalizeHome(d.home));
      setStatus(normalizeStatus(d.home));
      setPremium({ access: d.premiumAccess, reason: d.premiumReason, message: d.premiumMessage });
      setNotices(d.notices);
      setUnreadNotices(d.unreadCount);
      setClockInAlert(d.alarm.clockInAlertMinutes);
      setClockOutAlert(d.alarm.clockOutAlertMinutes);
      setMissingCount(d.missing.count);
      setTodayMissing(d.today.missingTraineeCount);
      setMissedClockOuts(d.missedClockOuts ?? []);
      setPendingRequests(d.pendingRequests ?? []);
      setActiveAssignments(d.activeAssignments ?? []);
      setActiveAssignmentId(d.activeAssignmentId ?? null);
      if (d.homeMessages) setHomeMessages(d.homeMessages);
    } catch (e: any) {
      showToast(e.message || "데이터를 불러올 수 없습니다.", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  // 멀티 현장 전환: 쿠키 세팅 후 home-summary 재조회(쿠키 기반으로 선택 배정 반영).
  const switchAssignment = useCallback(async (id: string) => {
    setActiveAssignmentCookie(id);
    setActiveAssignmentId(id);
    setSwitchOpen(false);
    setLoading(true);
    await refresh();
  }, [refresh]);

  // initialData가 없을 때(서버 프리페치 실패)만 클라이언트 폴백 조회
  useEffect(() => {
    if (!initialData) refresh();
  }, [initialData, refresh]);

  // 배정 요청 회신: 수락(희망 근무형태) / 거절
  async function respondRequest(assignmentId: string, action: "accept" | "decline", workType?: string) {
    if (action === "accept" && !workType) { showToast("희망 근무형태를 선택해주세요.", "error"); return; }
    setActionLoading(true);
    try {
      const res = await fetch("/api/worker/assignment/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, action, workType }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      showToast(data.message || "처리되었습니다.", "success");
      await refresh();
    } catch (e: any) {
      showToast(e.message || "처리에 실패했습니다.", "error");
    } finally {
      setActionLoading(false);
    }
  }

  async function markAllRead() {
    await fetch("/api/worker/notices/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    setUnreadNotices(0);
    setNotices(prev => prev.map(n => ({ ...n, read: true })));
  }

  useEffect(() => {
    if (!homeData) return;
    if (homeData.attendanceButtonExempt) return; // 면제 배정: 출퇴근 버튼 미사용 → 알람 불필요
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

  // 최초 현장 방문 위치확정: 현재 좌표를 기준점으로 propose. 허용범위 이내면 확정(APPROVED/CONFIRMED_LOCATION).
  async function confirmLocation(
    siteId: string | undefined,
    lat: number,
    lon: number,
    accuracyM?: number,
  ): Promise<boolean> {
    if (!siteId) { showToast("현장 정보를 찾을 수 없습니다.", "error"); return false; }
    try {
      const res = await fetch("/api/site/basepoint/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, proposedLat: lat, proposedLon: lon, accuracyM }),
      });
      const data = await res.json();
      if (data.success && (data.status === "APPROVED" || data.status === "CONFIRMED_LOCATION")) {
        showToast("현장 위치가 확정되었습니다.", "success");
        return true;
      }
      showToast(data.message || "현장에서 위치 확정에 실패했습니다. 현장 안에서 다시 시도해주세요.", "error");
      return false;
    } catch {
      showToast("위치 확정 중 오류가 발생했습니다.", "error");
      return false;
    }
  }

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
          workerId: session.workerId,
          // 멀티 현장: 선택된 배정을 명시해 서버가 그 현장 기준으로 출근 기록(없으면 서버가 자동 선택 — 단일현장 호환).
          ...(homeData?.assignmentId ? { assignmentId: homeData.assignmentId, siteId: homeData.siteId ?? undefined } : {}),
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
        // 🔑 연결 게이트: 기존 유저는 배정 연결 인증코드 입력 전 출근 불가(서버 ASSIGNMENT_NOT_CONNECTED).
        if (res.status === 409 && data.message === "ASSIGNMENT_NOT_CONNECTED") {
          return new Promise<boolean>(resolve => {
            setDialog({
              title: "배정 연결 필요",
              msg: "이 현장 배정을 먼저 연결해야 출근할 수 있어요.\n담당자가 보낸 인증코드를 입력해주세요.",
              confirmLabel: "배정 연결하기",
              cancelLabel: "닫기",
              onConfirm: () => { setDialog(null); router.push("/worker/connect"); resolve(false); },
              onCancel: () => { setDialog(null); resolve(false); },
            });
          });
        }

        // 🔑 위치확정 게이트: 최초 현장 방문 위치확정 전에는 출근 불가(서버 LOCATION_NOT_CONFIRMED).
        //    현재 위치를 현장 기준점으로 확정한 뒤 출근을 재시도하도록 안내한다.
        if (res.status === 409 && data.message === "LOCATION_NOT_CONFIRMED") {
          const siteId = data.siteId as string | undefined;
          return new Promise(resolve => {
            setDialog({
              title: "현장 위치 확정",
              msg: "이 현장은 최초 방문 시 위치 확정이 필요합니다.\n현재 위치를 현장 기준점으로 확정하고 출근할까요?\n(현장 안에서 진행해주세요.)",
              confirmLabel: "위치 확정하고 출근",
              cancelLabel: "취소",
              onConfirm: async () => {
                setDialog(null);
                setActionLoading(true);
                const confirmed = await confirmLocation(siteId, latitude, longitude, coords.accuracy);
                const ok = confirmed ? await doAttendance(endpoint, extraPayload, confirmOutOfRange) : false;
                setActionLoading(false);
                resolve(ok);
              },
              onCancel: () => { setDialog(null); resolve(false); },
            });
          });
        }
        // 안정성: 실패 시에도 서버 상태로 재동기화(유실된 응답/중복요청/백그라운드 복귀 대비).
        // → UI가 서버 truth로 수렴해 "버튼은 퇴근하기인데 서버엔 이미 DONE" 같은 교착을 자가 치유.
        await refresh();
        // 이미 처리된(서버 기준 진행 중 기록 없음/이미 출근) 케이스는 에러가 아니라 동기화로 안내.
        if (data.code === "NO_ACTIVE_ATTENDANCE" || data.code === "ALREADY_CLOCKED_IN") {
          showToast("이미 처리된 상태예요. 최신 상태로 맞췄어요.", "success");
          return false;
        }
        showToast(data.message || "처리 중 오류가 발생했습니다.", "error");
        return false;
      }

      await refresh();
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

  // 퇴근 미실행 → 사유와 함께 늦은 퇴근 처리
  function openMissedModal(m: MissedClockOut) {
    setMissedTarget(m);
    setMissedReason("");
    setMissedReasonText("");
  }
  async function submitLateClockOut() {
    if (!missedTarget) return;
    if (!missedReason) { showToast("사유를 선택해주세요.", "error"); return; }
    if (missedReason === "OTHER" && !missedReasonText.trim()) { showToast("기타 사유를 입력해주세요.", "error"); return; }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/worker/attendance/${missedTarget.attendanceId}/late-clockout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonCode: missedReason, reasonText: missedReasonText.trim() }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "처리에 실패했습니다.");
      setMissedTarget(null);
      showToast("퇴근 처리되었습니다.", "success");
      await refresh();
    } catch (e: any) {
      showToast(e.message || "처리 중 오류가 발생했습니다.", "error");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleLogout() {
    setShowProfile(false);
    try { await fetch("/api/worker/auth/logout", { method: "POST" }); } catch { /* 세션 쿠키는 만료됨 */ }
    router.replace("/worker/login");
  }

  // 일지 작성 진입 (출근 안 눌러도 가능 — 서버가 출근기록 자동 생성)
  function goWorklog(trainee: Trainee) {
    const params = new URLSearchParams({
      traineeId: trainee.id,
      traineeName: trainee.name,
      trainingType: homeData?.trainingType || "FIELD",
      ...(homeData?.attendanceId ? { attendanceId: homeData.attendanceId } : {}),
    });
    router.push(`/worker/worklog?${params.toString()}`);
  }

  // "오늘 일지 쓰기" — 훈련생 1명이면 바로, 여러 명이면 선택 시트
  function handleWriteToday() {
    const ts = homeData?.trainees ?? [];
    if (ts.length === 0) return;
    if (ts.length === 1) { goWorklog(ts[0]); return; }
    setShowLogPicker(true);
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
  // 화면에는 실제 버튼 시각을 우선 표시(없으면 일괄생성 등 → 고정시각). 출근부 PDF만 고정시각 사용.
  const startStr = formatHHMM(homeData?.actualStartTime ?? homeData?.workStartTime ?? null);
  const endStr   = formatHHMM(homeData?.actualEndTime ?? homeData?.workEndTime ?? null);

  const workTypeLabel = homeData?.workType
    ? (WORK_TYPE_LABEL[homeData.workType] ?? `${homeData.customWorkStart}–${homeData.customWorkEnd}`)
    : null;

  const hasSite = !!homeData?.siteName;
  const traineeList = homeData?.trainees ?? [];
  // 출퇴근 버튼 면제(시스템 관리자 부여, 시프티 병행): 버튼 대신 자동 처리 안내. 워커가 끌 수 없음.
  const isExempt = homeData?.attendanceButtonExempt ?? false;

  const NAV_ITEMS = [
    { icon: Home,           label: "홈",      href: "/worker/home" },
    { icon: CalendarDays,   label: "캘린더",  href: "/worker/calendar" },
    { icon: PenLine,        label: "전자서명", href: "/worker/signature" },
    { icon: FileText,       label: "문서",    href: "/worker/docs/view" },
    { icon: Search,         label: "매칭",    href: "/recruit" },
  ];

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* ── 헤더 ── */}
      <header className="bg-slate-950 px-5 pb-5 pt-safe-top text-white">
        <div className="mx-auto max-w-md">
          <div className="flex items-center justify-between py-4">
            {/* 로고 + 브랜드 (현장·서비스단계 뱃지는 아래 날짜 줄로 이동 — 상단 높이 축소) */}
            <div className="flex items-center gap-2">
              <img src="/icons/icon-192.png" alt="Able-Link" className="h-7 w-7 rounded-lg" />
              <span className="text-xl font-black tracking-tight text-white">Able-Link</span>
            </div>

            {/* 알림 + 프로필 */}
            <div className="flex items-center gap-2">
              {/* 알림 배지 */}
              <div className="relative">
                <button
                  onClick={() => setShowNotices(v => !v)}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-800 text-slate-300 transition active:scale-95"
                  aria-label="알림"
                >
                  <Bell className="h-5 w-5" aria-hidden="true" />
                  {unreadNotices > 0 && (
                    <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-white">
                      {unreadNotices > 9 ? "9+" : unreadNotices}
                    </span>
                  )}
                </button>
                {showNotices && (
                  <>
                    {/* 바깥 탭 닫기(투명 — 화면을 어둡게 덮지 않음) */}
                    <div className="fixed inset-0 z-40" onClick={() => setShowNotices(false)} aria-hidden="true" />
                    {/* 상단 드롭다운 높이 유지 + 화면 가로 중앙 정렬(좁은 폰 좌측 잘림 방지) */}
                    <div className="fixed left-1/2 top-[4.25rem] z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl shadow-slate-950/10">
                      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                        <p className="text-sm font-black text-slate-900">알림</p>
                        <div className="flex items-center gap-3">
                          {unreadNotices > 0 && (
                            <button onClick={markAllRead} className="text-[11px] font-black text-sky-600 active:scale-95">모두 읽음</button>
                          )}
                          <button onClick={() => setShowNotices(false)} aria-label="닫기"><X className="h-4 w-4 text-slate-400" /></button>
                        </div>
                      </div>
                      {notices.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm font-semibold text-slate-400">알림이 없습니다.</div>
                      ) : (
                        <div className="max-h-[60vh] divide-y divide-slate-50 overflow-y-auto">
                          {notices.map(n => {
                            const go = () => {
                              setShowNotices(false);
                              if (!n.read) {
                                setUnreadNotices(c => Math.max(0, c - 1));
                                setNotices(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                              }
                              router.push(`/worker/notices?open=${n.id}`);
                            };
                            return (
                              <div
                                key={n.id}
                                onClick={go}
                                className={`cursor-pointer px-4 py-3 transition active:bg-slate-50 ${n.read ? "" : "bg-rose-50"}`}
                              >
                                <p className={`text-xs font-black ${n.type === "REJECT" ? "text-rose-600" : "text-slate-700"}`}>
                                  {n.title}
                                </p>
                                <p className="mt-0.5 line-clamp-1 text-xs font-semibold text-slate-500">{n.body}</p>
                                <div className="mt-1 flex items-center justify-between">
                                  <p className="text-[10px] text-slate-300">{new Date(n.createdAt).toLocaleDateString("ko-KR")}</p>
                                  <span className="text-[10px] font-black text-sky-600">자세히 →</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

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
                    {session.workerName}님
                  </p>
                  <button
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    onClick={() => { setShowProfile(false); router.push("/worker/history"); }}
                  >
                    <CircleDollarSign className="h-4 w-4 text-slate-400" />
                    이력관리
                  </button>
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
            </div> {/* 알림+프로필 flex wrap 닫기 */}
          </div>

          {/* 날짜 + 현장·서비스단계 + 상태 — 모바일 1줄 고정(현장명 말줄임, 상태뱃지 줄바꿈 방지) */}
          <div className="flex flex-nowrap items-center justify-between gap-2 pb-1">
            <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
              <span className="shrink-0 text-base font-bold text-slate-300">{nowDateStr()}</span>
              {homeData?.siteName && (
                <>
                  {activeAssignments.length >= 2 ? (
                    // 멀티 현장: 배지를 전환 스위처로(오전/오후 전환)
                    <button
                      onClick={() => setSwitchOpen(true)}
                      className="inline-flex min-w-0 max-w-[52vw] items-center gap-1 rounded-full border border-sky-500/60 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200"
                    >
                      {(() => {
                        const wt = activeAssignments.find(a => a.assignmentId === activeAssignmentId)?.workType;
                        return wt ? <span className="shrink-0 rounded-full bg-sky-500/25 px-1.5 text-[11px] font-black text-sky-200">{WORKTYPE_SHORT[wt] ?? wt}</span> : null;
                      })()}
                      <span className="truncate">{homeData.siteName}</span>
                      <ChevronsUpDown className="h-3 w-3 shrink-0 text-sky-400" aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      onClick={() => router.push("/worker/site")}
                      className="inline-flex min-w-0 max-w-[45vw] items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300"
                    >
                      <MapPin className="h-3 w-3 shrink-0 text-sky-400" aria-hidden="true" />
                      <span className="truncate">{homeData.siteName}</span>
                    </button>
                  )}
                  {/* 서비스 단계 뱃지 (지원고용 훈련 / 취업 후 적응지도) */}
                  <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-black ${
                    homeData.trainingType === "ADAPTATION" ? "bg-amber-400 text-slate-950" : "bg-sky-400 text-slate-950"
                  }`}>
                    {homeData.trainingType === "ADAPTATION" ? "취업 후 적응지도" : "지원고용 훈련"}
                  </span>
                </>
              )}
            </div>
            <span className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-black ${isExempt ? "bg-sky-100 text-sky-600" : cfg.badge}`}>
              {isExempt ? "자동 기록" : cfg.label}
            </span>
          </div>
        </div>
      </header>

      {/* ── 컨텐츠 ── */}
      <div className="mx-auto max-w-md px-4 pb-28 pt-4 space-y-4">

        {/* 파이프라인 게이트 안내(출근 전 필요한 단계 사전 안내) */}
        {homeData?.pipelineGate && (
          <div className={`rounded-2xl border p-4 ${
            homeData.pipelineGate === "AWAITING_CONTRACT" ? "border-amber-200 bg-amber-50"
            : homeData.pipelineGate === "NOT_CONNECTED" ? "border-sky-200 bg-sky-50"
            : "border-orange-200 bg-orange-50"
          }`}>
            {homeData.pipelineGate === "AWAITING_CONTRACT" && (
              <p className="text-sm font-bold leading-6 text-amber-800">근로계약서 작성 대기 중이에요.<br />담당자가 계약서를 보내면 다음 단계로 진행됩니다.</p>
            )}
            {homeData.pipelineGate === "NOT_CONNECTED" && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold leading-6 text-sky-800">새 현장 배정 연결이 필요해요.<br />받은 인증코드를 입력해주세요.</p>
                <button onClick={() => router.push("/worker/connect")} className="shrink-0 rounded-xl bg-sky-600 px-3.5 py-2.5 text-sm font-black text-white">배정 연결</button>
              </div>
            )}
            {homeData.pipelineGate === "LOCATION_NOT_CONFIRMED" && (
              <p className="text-sm font-bold leading-6 text-orange-800">출근하려면 현장에서 최초 위치 확정이 필요해요.<br />현장에 도착해 <b>출근하기</b>를 누르면 위치 확정 후 출근됩니다.</p>
            )}
          </div>
        )}

        {/* ── 배정 요청(수락/거절) ── */}
        {pendingRequests.length > 0 && (
          <div className="space-y-3">
            {pendingRequests.map(req => {
              const choice = reqWtChoice[req.assignmentId];
              return (
                <div key={req.assignmentId} className="rounded-3xl border border-blue-200 bg-blue-50 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Send className="h-5 w-5 text-blue-600" />
                    <p className="text-sm font-black text-blue-900">새 배정 요청</p>
                  </div>
                  <p className="text-base font-black text-slate-900">{req.siteName}</p>
                  {req.agencyName && <p className="text-xs font-semibold text-slate-500">{req.agencyName}</p>}
                  {req.replyDeadline && (
                    <p className="mt-1 text-xs font-black text-rose-600">회신 기한 {req.replyDeadline.slice(0, 10)} · 이후 자동 탈락</p>
                  )}
                  <p className="mb-1.5 mt-3 text-xs font-black text-slate-700">희망 근무형태 선택</p>
                  <div className="flex gap-2">
                    {req.requestedWorkTypes.map(wt => (
                      <button key={wt} type="button" onClick={() => setReqWtChoice(s => ({ ...s, [req.assignmentId]: wt }))}
                        className={`flex-1 rounded-xl border py-2.5 text-sm font-bold transition active:scale-95 ${
                          choice === wt ? "border-blue-600 bg-blue-600 text-white" : "border-blue-200 bg-white text-slate-700"
                        }`}>
                        {REQ_WT_LABEL[wt] ?? wt}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => respondRequest(req.assignmentId, "decline")} disabled={actionLoading}
                      className="flex-1 rounded-xl border border-slate-300 bg-white py-3 text-sm font-black text-slate-600 transition active:scale-[0.98] disabled:opacity-60">거절</button>
                    <button onClick={() => respondRequest(req.assignmentId, "accept", choice)} disabled={actionLoading || !choice}
                      className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-black text-white transition active:scale-[0.98] disabled:opacity-50">수락</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 출퇴근 카드 — 면제 배정이면 자동 처리 안내, 아니면 출퇴근 버튼 */}
        {isExempt ? (
          <div className="rounded-3xl border border-sky-200 bg-sky-50 p-5">
            <div className="mb-3 flex items-center justify-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-sky-500" aria-hidden="true" />
              <p className="text-sm font-black text-sky-900">출퇴근 자동 처리</p>
            </div>
            <p className="text-center text-sm font-semibold leading-6 text-sky-700">
              이 현장은 출퇴근 버튼을 사용하지 않아요. 근무형태 기준으로 출근부가 매일 자동으로 작성됩니다.
            </p>
            <p className="mt-3 text-center text-xs font-semibold text-sky-500">
              변경이 필요하면 시스템 관리자에게 문의하세요.
            </p>
          </div>
        ) : (
        <div className={`rounded-3xl border p-5 ${cfg.card}`}>
          <p className="mb-4 text-center text-sm font-semibold text-slate-500">{homeMessages?.[status] ?? cfg.title}</p>

          {/* 시간 표시 */}
          <div className="mb-5 flex items-baseline justify-center gap-1">
            {status === "BEFORE" && (
              <>
                <span suppressHydrationWarning className="font-black tabular-nums text-[52px] leading-none tracking-tight text-slate-950">
                  {timeStr}
                </span>
                <span suppressHydrationWarning className="text-2xl font-semibold text-slate-400">{secStr}</span>
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
                  <p suppressHydrationWarning className="text-3xl font-black tabular-nums tracking-tight text-emerald-600">{timeStr}</p>
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
        )}

        {/* ── 퇴근 미실행(보정대기) 알림 — 사유와 함께 늦은 퇴근 처리 ── */}
        {missedClockOuts.length > 0 && (
          <div className="rounded-3xl border border-amber-300 bg-amber-50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-amber-600" />
              <p className="text-sm font-black text-amber-900">퇴근 미실행 {missedClockOuts.length}건</p>
            </div>
            <p className="mb-3 text-xs font-semibold leading-5 text-amber-700">
              퇴근 버튼을 누르지 않은 날이 있어요. 사유를 등록해주세요.
              <br />처리 전까지 출근부에 퇴근 시각이 반영되지 않습니다.
            </p>
            <div className="flex flex-col gap-2">
              {missedClockOuts.map(m => (
                <button
                  key={m.attendanceId}
                  onClick={() => openMissedModal(m)}
                  className="flex items-center justify-between rounded-2xl border border-amber-200 bg-white px-4 py-3 text-left transition active:scale-[0.98]"
                >
                  <span>
                    <span className="block text-sm font-black text-slate-900">{m.workDate}</span>
                    <span className="block text-xs font-semibold text-slate-500">{m.siteName}</span>
                  </span>
                  <span className="flex items-center gap-1 text-sm font-black text-amber-700">
                    퇴근 처리 <ChevronRight className="h-4 w-4" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── 오늘 할 일 / 놓친 일 요약 (핵심 — 가장 위) ── */}
        {hasSite && (
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 pt-4 pb-3">
              <p className="text-sm font-black text-slate-900">오늘 할 일</p>
            </div>

            {/* 오늘 일지 */}
            <button
              onClick={handleWriteToday}
              disabled={traineeList.length === 0}
              className="flex w-full items-center gap-3 px-5 py-4 text-left transition active:bg-slate-50 disabled:opacity-50"
            >
              <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl ${todayMissing > 0 ? "bg-slate-950" : "bg-emerald-100"}`}>
                {todayMissing > 0
                  ? <ClipboardList className="h-5 w-5 text-sky-400" aria-hidden="true" />
                  : <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden="true" />}
              </div>
              <div className="flex-1">
                {todayMissing > 0 ? (
                  <>
                    <p className="text-base font-black text-slate-900">오늘 일지 쓰기</p>
                    <p className="text-xs font-semibold text-slate-400">{todayMissing}명 미작성 · 출근 안 해도 작성할 수 있어요</p>
                  </>
                ) : (
                  <>
                    <p className="text-base font-black text-emerald-600">오늘 일지 완료</p>
                    <p className="text-xs font-semibold text-slate-400">오늘 담당 훈련생 일지를 모두 작성했어요</p>
                  </>
                )}
              </div>
              {todayMissing > 0 && <ChevronRight className="h-5 w-5 flex-shrink-0 text-slate-300" aria-hidden="true" />}
            </button>

            {/* 놓친(밀린) 일지 */}
            <button
              onClick={() => router.push("/worker/logs/missing")}
              className="flex w-full items-center gap-3 border-t border-slate-100 px-5 py-4 text-left transition active:bg-slate-50"
            >
              <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl ${missingCount > 0 ? "bg-amber-100" : "bg-slate-100"}`}>
                {missingCount > 0
                  ? <FileWarning className="h-5 w-5 text-amber-500" aria-hidden="true" />
                  : <CheckCircle2 className="h-5 w-5 text-slate-400" aria-hidden="true" />}
              </div>
              <div className="flex-1">
                {missingCount > 0 ? (
                  <>
                    <p className="text-base font-black text-amber-700">밀린 일지 {missingCount}건</p>
                    <p className="text-xs font-semibold text-slate-400">지난 출근 중 일지가 빠진 날이 있어요</p>
                  </>
                ) : (
                  <>
                    <p className="text-base font-black text-slate-700">밀린 일지 없음</p>
                    <p className="text-xs font-semibold text-slate-400">지난 일지를 모두 작성했어요</p>
                  </>
                )}
              </div>
              <ChevronRight className="h-5 w-5 flex-shrink-0 text-slate-300" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* 담당 훈련생 목록 */}
        {traineeList.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="text-sm font-black text-slate-800">담당 훈련생</span>
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-black text-white">
                {traineeList.length}명
              </span>
            </div>
            <div className="space-y-2.5">
              {traineeList.map(t => {
                const trainingType = homeData?.trainingType || "FIELD";
                const isAdaptation = trainingType === "ADAPTATION";
                const now = new Date();
                const y = now.getFullYear();
                const mo = String(now.getMonth() + 1).padStart(2, "0");
                const last = new Date(y, now.getMonth() + 1, 0).getDate();
                const ps = `${y}-${mo}-01`;
                const pe = `${y}-${mo}-${String(last).padStart(2, "0")}`;
                const evalPath = isAdaptation
                  ? `/worker/evaluation/adaptation?traineeId=${t.id}&traineeName=${encodeURIComponent(t.name)}&periodStart=${ps}&periodEnd=${pe}`
                  : `/worker/evaluation/training?traineeId=${t.id}&traineeName=${encodeURIComponent(t.name)}&periodStart=${ps}&periodEnd=${pe}`;

                return (
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
                    <div className="flex gap-2">
                      <button
                        onClick={() => router.push(evalPath)}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600 transition active:scale-95"
                        title={isAdaptation ? "적응지도 종료 시 작성" : "훈련 종료 시 작성"}
                      >
                        종합평가
                      </button>
                      <button
                        onClick={() => goWorklog(t)}
                        className="flex items-center gap-1 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition active:scale-95"
                      >
                        <ClipboardList className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                        일지 작성
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 현장 없을 때 */}
        {!hasSite && (
          <div className="rounded-3xl border border-slate-100 bg-white py-12 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
              <MapPin className="h-7 w-7 text-slate-400" aria-hidden="true" />
            </div>
            <p className="mb-1 text-sm font-semibold text-slate-500">배정된 현장이 없습니다.</p>
            <p className="mb-5 px-6 text-xs font-semibold leading-relaxed text-slate-400">
              소속 위탁기관 또는 시스템 관리자가 현장을 배정하면 시작할 수 있어요.
            </p>
            <button
              onClick={() => router.push("/recruit")}
              className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-95"
            >
              매칭에서 직무지도 찾기
            </button>
          </div>
        )}

        {/* ── AI 일지 일괄 작성 (빠른 작업은 하단 중앙 고정 퀵메뉴로 이동) ── */}
        {hasSite && (
          <div>
            {/* AI 일괄 작성 */}
            <button
              onClick={() => router.push("/worker/worklog/batch")}
              className="mt-2.5 flex w-full items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3.5 text-left transition active:scale-[0.98]"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-100">
                <Layers className="h-5 w-5 text-emerald-600" aria-hidden="true" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-black text-emerald-900">AI 일지 일괄 작성</p>
                <p className="text-xs font-semibold text-emerald-500">음성 1번으로 여러 날짜 일지를 한번에</p>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-emerald-400" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* 근무형태 + 알람 (보조 정보 — 아래로) */}
        {hasSite && homeData?.workType && (
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

        {/* 유료기능 안내 배너 — 접근 막혔을 때만 (AI 기준) */}
        {hasSite && !premium.access && (
          <div className="flex w-full items-center gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3.5 text-left">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100">
              <Sparkles className="h-5 w-5 text-amber-500" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-black text-amber-900">
                {premium.reason === "CONTRACT_PENDING"
                  ? "근로계약서 서명이 필요해요"
                  : premium.reason === "CONTRACT_EXPIRED"
                  ? "근로계약 기간이 종료되었어요"
                  : "AI 음성 일지 안내"}
              </p>
              <p className="text-xs font-semibold leading-relaxed text-amber-700">
                {premium.message || "근로계약 기간 중에 AI 음성 일지를 사용할 수 있어요."}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── 오늘 일지 쓰기 — 훈련생 선택 시트 ── */}
      {showLogPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 px-4 pb-6" onClick={e => { if (e.target === e.currentTarget) setShowLogPicker(false); }}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6">
            <p className="mb-1 text-base font-black text-slate-900">어떤 훈련생 일지를 쓸까요?</p>
            <p className="mb-5 text-sm font-semibold text-slate-400">훈련생을 선택하면 일지 작성으로 이동합니다.</p>
            <div className="space-y-2">
              {traineeList.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setShowLogPicker(false); goWorklog(t); }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3.5 text-left transition active:scale-95"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-200 text-sm font-black text-slate-600">
                    {t.name.slice(0, 1)}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-black text-slate-900">{t.name}</p>
                    <p className="text-xs font-semibold text-slate-400">{t.gender === "M" ? "남성" : "여성"}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-300" aria-hidden="true" />
                </button>
              ))}
            </div>
            <button onClick={() => setShowLogPicker(false)} className="mt-4 w-full rounded-2xl border border-slate-200 py-3 text-sm font-black text-slate-500">
              취소
            </button>
          </div>
        </div>
      )}

      {/* ── 다이얼로그 ── */}
      {/* ── 멀티 현장 전환(오전/오후) 시트 ── */}
      {switchOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50" onClick={e => { if (e.target === e.currentTarget) setSwitchOpen(false); }}>
          <div className="w-full max-w-sm rounded-t-3xl bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">근무 현장 전환</h3>
              <button onClick={() => setSwitchOpen(false)} aria-label="닫기"><X className="h-5 w-5 text-slate-400" /></button>
            </div>
            <div className="space-y-2">
              {activeAssignments.map(a => {
                const cur = a.assignmentId === activeAssignmentId;
                return (
                  <button
                    key={a.assignmentId}
                    onClick={() => switchAssignment(a.assignmentId)}
                    className={`flex w-full items-center gap-2 rounded-2xl border px-4 py-3 text-left transition active:scale-[0.98] ${cur ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-white"}`}
                  >
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-700">{WORKTYPE_SHORT[a.workType] ?? a.workType}</span>
                    <span className="min-w-0 flex-1 truncate text-base font-black text-slate-900">{a.siteName}</span>
                    <span className="shrink-0 text-xs font-semibold text-slate-500">훈련생 {a.traineeCount}</span>
                    {cur && <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-500" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {/* ── 퇴근 미실행: 사유 선택 + 늦은 퇴근 처리 모달 ── */}
      {missedTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 sm:items-center">
          <div className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-base font-black text-slate-900">퇴근 처리</p>
              <button onClick={() => setMissedTarget(null)} className="rounded-full p-1 text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-4 text-sm font-semibold text-slate-500">
              {missedTarget.workDate} · {missedTarget.siteName}
              <br />
              <span className="text-xs text-slate-400">퇴근 시각은 근무형태 표준시각으로 출근부에 기록됩니다.</span>
            </p>

            <p className="mb-2 text-sm font-black text-slate-800">늦은 퇴근 사유</p>
            <div className="mb-3 flex flex-col gap-2">
              {LATE_CLOCK_OUT_REASONS.map(r => (
                <button
                  key={r.code}
                  onClick={() => setMissedReason(r.code)}
                  className={`min-h-12 rounded-2xl border px-4 text-left text-sm font-bold transition active:scale-[0.98] ${
                    missedReason === r.code
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {missedReason === "OTHER" && (
              <textarea
                value={missedReasonText}
                onChange={e => setMissedReasonText(e.target.value)}
                placeholder="기타 사유를 입력해주세요."
                rows={2}
                className="mb-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-slate-900"
              />
            )}

            <button
              onClick={submitLateClockOut}
              disabled={actionLoading || !missedReason}
              className="w-full min-h-14 rounded-2xl bg-slate-950 text-base font-black text-white transition active:scale-[0.97] disabled:opacity-50"
            >
              {actionLoading ? "처리 중..." : "퇴근 처리하기"}
            </button>
          </div>
        </div>
      )}

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

      {/* ── 하단 중앙 고정 퀵메뉴(FAB) — 스크롤해도 항상 표시, 탭하면 위로 펼침 ── */}
      {hasSite && (
        <>
          {quickOpen && (
            <div className="fixed inset-0 z-40" onClick={() => setQuickOpen(false)} aria-hidden="true" />
          )}
          <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 w-full max-w-md -translate-x-1/2 px-4">
            <div className="flex flex-col items-center gap-2">
              {quickOpen && (
                <div className="flex flex-col gap-2">
                  {[
                    { icon: CheckCircle2,      label: "출근부 확정", href: "/worker/review/attendance" },
                    { icon: PenLine,           label: "일지 확정",   href: "/worker/review/logs" },
                    { icon: ClipboardList,     label: "일지 목록",   href: "/worker/logs" },
                    { icon: CircleDollarSign,  label: "급여명세서",  href: "/worker/payroll" },
                    { icon: Megaphone,         label: "공지사항",    href: "/worker/notices" },
                  ].map(({ icon: Icon, label, href }) => (
                    <button
                      key={href}
                      onClick={() => { setQuickOpen(false); router.push(href); }}
                      className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-slate-200 bg-white py-2.5 pl-2.5 pr-4 shadow-lg transition active:scale-95"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
                        <Icon className="h-[18px] w-[18px] text-slate-700" aria-hidden="true" />
                      </span>
                      <span className="text-sm font-black text-slate-800">{label}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setQuickOpen(o => !o)}
                aria-label="빠른 작업 메뉴"
                aria-expanded={quickOpen}
                className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-white shadow-xl transition active:scale-95"
              >
                {quickOpen ? <X className="h-6 w-6" aria-hidden="true" /> : <Zap className="h-6 w-6" aria-hidden="true" />}
              </button>
            </div>
          </div>
        </>
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
