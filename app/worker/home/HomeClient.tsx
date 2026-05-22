"use client";
// app/worker/home/HomeClient.tsx
// 직무지도원 메인화면 — Phase 2 UX 개선

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  isExtraTime: boolean;
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

// ─── GPS 획득 ────────────────────────────────────────────
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
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

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

  // 시계
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 토스트 자동 닫기
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = (msg: string, type: "success" | "error" | "info" = "info") =>
    setToast({ msg, type });

  // 홈 데이터 로드
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
        isExtraTime: raw.isExtraTime ?? false,
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

  // GPS 기반 출퇴근 공통 로직
  async function doAttendance(
    endpoint: string,
    extraPayload: Record<string, any> = {},
    confirmOutOfRange = false
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

  // ─── 렌더 ──────────────────────────────────────────────
  if (loading) {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <p style={{ color: "#9ca3af", marginTop: 12, fontSize: 14 }}>불러오는 중...</p>
      </div>
    );
  }

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${pad2(currentTime.getHours())}:${pad2(currentTime.getMinutes())}`;
  const secStr = pad2(currentTime.getSeconds());

  const STATUS_CONFIG: Record<AttendanceStatus, {
    label: string; badgeBg: string; badgeColor: string;
    cardBg: string; cardBorder: string; title: string;
  }> = {
    BEFORE:  { label: "출근 전",  badgeBg: "#f3f4f6", badgeColor: "#6b7280", cardBg: "#fff", cardBorder: "#e5e7eb", title: "오늘도 좋은 하루 되세요" },
    WORKING: { label: "근무 중",  badgeBg: "#dcfce7", badgeColor: "#16a34a", cardBg: "#f0fdf4", cardBorder: "#86efac", title: "열심히 일하고 계시네요!" },
    DONE:    { label: "마감 중",  badgeBg: "#fef3c7", badgeColor: "#d97706", cardBg: "#fffbeb", cardBorder: "#fde68a", title: "수고하셨습니다" },
    CLOSED:  { label: "퇴근 완료", badgeBg: "#f3f4f6", badgeColor: "#9ca3af", cardBg: "#fafafa", cardBorder: "#e5e7eb", title: "오늘 하루도 고생하셨습니다" },
  };

  const cfg = STATUS_CONFIG[status];
  const startStr = formatHHMM(homeData?.workStartTime ?? null);
  const endStr = formatHHMM(homeData?.workEndTime ?? null);

  // 출퇴근 버튼 스타일
  const btnStyle: Record<AttendanceStatus, React.CSSProperties> = {
    BEFORE:  { background: "#111827", color: "#fff" },
    WORKING: { background: "#dc2626", color: "#fff" },
    DONE:    { background: "#16a34a", color: "#fff" },
    CLOSED:  { background: "#d1d5db", color: "#9ca3af", cursor: "not-allowed" },
  };

  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* ── 헤더 ── */}
        <div style={s.header}>
          <div style={s.headerLeft}>
            <span style={s.logoText}>
              <span style={{ color: "#111827" }}>Able</span>
              <span style={{ color: "#ef4444" }}>Link</span>
            </span>
            {homeData?.siteName && (
              <button onClick={() => router.push("/worker/site")} style={s.siteBadge}>
                📍 {homeData.siteName}
              </button>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <button
              ref={profileRef}
              onClick={() => setShowProfile(v => !v)}
              style={s.profileBtn}
              aria-label="프로필 메뉴"
            >
              <span style={{ fontSize: 18 }}>👤</span>
            </button>
            {showProfile && (
              <div style={s.profileMenu}>
                <div style={s.profileName}>{session.userName}님</div>
                <button style={s.menuItem} onClick={() => { setShowProfile(false); router.push("/worker/profile"); }}>
                  정보수정
                </button>
                <button style={{ ...s.menuItem, color: "#ef4444" }} onClick={handleLogout}>
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── 날짜 + 상태 ── */}
        <div style={s.dateRow}>
          <span style={s.dateText}>{nowDateStr()}</span>
          <span style={{ ...s.statusBadge, background: cfg.badgeBg, color: cfg.badgeColor }}>
            {cfg.label}
          </span>
        </div>

        {/* ── 출퇴근 카드 ── */}
        <div style={{ ...s.card, background: cfg.cardBg, borderColor: cfg.cardBorder }}>
          <p style={s.cardTitle}>{cfg.title}</p>

          {/* 시간 표시 */}
          <div style={s.clockWrap}>
            {status === "BEFORE" && (
              <>
                <span style={s.clockTime}>{timeStr}</span>
                <span style={s.clockSec}>{secStr}</span>
              </>
            )}
            {status === "WORKING" && (
              <div style={s.timePair}>
                <div style={s.timeBlock}>
                  <span style={s.timeBlockLabel}>출근</span>
                  <span style={s.timeBlockValue}>{startStr}</span>
                </div>
                <span style={s.timeSep}>/</span>
                <div style={s.timeBlock}>
                  <span style={s.timeBlockLabel}>현재</span>
                  <span style={{ ...s.timeBlockValue, color: "#16a34a" }}>{timeStr}</span>
                </div>
              </div>
            )}
            {(status === "DONE" || status === "CLOSED") && (
              <div style={s.timePair}>
                <div style={s.timeBlock}>
                  <span style={s.timeBlockLabel}>출근</span>
                  <span style={s.timeBlockValue}>{startStr}</span>
                </div>
                <span style={s.timeSep}>–</span>
                <div style={s.timeBlock}>
                  <span style={s.timeBlockLabel}>퇴근</span>
                  <span style={s.timeBlockValue}>{endStr}</span>
                </div>
              </div>
            )}
          </div>

          {/* 액션 버튼 */}
          {status === "BEFORE" && (
            <button
              style={{ ...s.actionBtn, ...btnStyle.BEFORE, opacity: actionLoading ? 0.7 : 1 }}
              onClick={handleClockIn}
              disabled={actionLoading}
            >
              {actionLoading ? "위치 확인 중..." : "출근하기"}
            </button>
          )}
          {status === "WORKING" && (
            <button
              style={{ ...s.actionBtn, ...btnStyle.WORKING, opacity: actionLoading ? 0.7 : 1 }}
              onClick={handleClockOut}
              disabled={actionLoading}
            >
              {actionLoading ? "처리 중..." : "퇴근하기"}
            </button>
          )}
          {status === "DONE" && (
            <>
              <button
                style={{ ...s.actionBtn, ...btnStyle.DONE, opacity: actionLoading ? 0.7 : 1 }}
                onClick={handleReconfirm}
                disabled={actionLoading}
              >
                {actionLoading ? "처리 중..." : "퇴근 시간 재확인"}
              </button>
              <p style={{ fontSize: 12, color: "#d97706", margin: "10px 0 0", textAlign: "center" as const }}>
                ⏱ 퇴근 후 60분이 지나면 자동으로 확정됩니다
              </p>
            </>
          )}
          {status === "CLOSED" && (
            <button style={{ ...s.actionBtn, ...btnStyle.CLOSED }} disabled>
              업무 종료
            </button>
          )}
        </div>

        {/* ── 훈련생 목록 ── */}
        {homeData?.trainees && homeData.trainees.length > 0 && (
          <div style={s.section}>
            <div style={s.sectionHeader}>
              <span style={s.sectionTitle}>담당 훈련생</span>
              <span style={s.sectionCount}>{homeData.trainees.length}명</span>
            </div>
            <div style={s.traineeList}>
              {homeData.trainees.map(t => (
                <div key={t.id} style={s.traineeCard}>
                  <div style={s.traineeAvatar}>
                    {t.gender === "M" ? "👨" : "👩"}
                  </div>
                  <div style={s.traineeInfo}>
                    <p style={s.traineeName}>{t.name}</p>
                    <p style={s.traineeGender}>{t.gender === "M" ? "남성" : "여성"}</p>
                  </div>
                  <button
                    style={s.logBtn}
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
                  >
                    일지 작성
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 현장 없을 때 */}
        {!homeData?.siteName && (
          <div style={s.noSite}>
            <span style={{ fontSize: 40, display: "block", marginBottom: 12 }}>🏢</span>
            <p style={s.noSiteText}>배정된 현장이 없습니다.</p>
            <button style={s.noSiteBtn} onClick={() => router.push("/worker/site/register")}>
              현장 등록하기
            </button>
          </div>
        )}

        {/* PREMIUM 배너 */}
        {homeData?.siteName && (
          <div style={s.subscribeBanner} onClick={() => router.push("/worker/subscribe")}>
            <div style={s.bannerIcon}>🎁</div>
            <div style={s.bannerBody}>
              <p style={s.bannerTitle}>AI 기능 & PDF 자동 생성</p>
              <p style={s.bannerDesc}>음성 일지 작성, PDF 자동 발송 등 PREMIUM 기능</p>
            </div>
            <span style={s.bannerArrow}>›</span>
          </div>
        )}

      </div>

      {/* ── 다이얼로그 ── */}
      {dialog && (
        <div style={s.overlay}>
          <div style={s.dialogBox}>
            <p style={s.dialogTitle}>{dialog.title}</p>
            <p style={s.dialogMsg}>{dialog.msg}</p>
            {/* 3버튼(재확인/최종마감/취소)일 때 세로 스택 */}
            {dialog.onDismiss ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button style={{ ...s.dialogBtn, ...s.dialogBtnPrimary, width: "100%" }} onClick={dialog.onConfirm}>
                  {dialog.confirmLabel ?? "확인"}
                </button>
                <button style={{ ...s.dialogBtn, ...s.dialogBtnDanger, width: "100%" }} onClick={dialog.onCancel}>
                  {dialog.cancelLabel ?? "최종마감"}
                </button>
                <button style={{ ...s.dialogBtn, ...s.dialogBtnCancel, width: "100%" }} onClick={dialog.onDismiss}>
                  {dialog.dismissLabel ?? "취소"}
                </button>
              </div>
            ) : (
              <div style={s.dialogBtns}>
                {dialog.onCancel && (
                  <button style={{ ...s.dialogBtn, ...s.dialogBtnCancel }} onClick={dialog.onCancel}>
                    {dialog.cancelLabel ?? "취소"}
                  </button>
                )}
                <button
                  style={{ ...s.dialogBtn, ...(dialog.variant === "danger" ? s.dialogBtnDanger : s.dialogBtnPrimary) }}
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
        <div style={{
          ...s.toast,
          backgroundColor:
            toast.type === "success" ? "#16a34a" :
            toast.type === "error" ? "#dc2626" : "#111827",
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── 하단 네비게이션 ── */}
      <nav style={s.bottomNav}>
        <button style={s.navItem} onClick={() => router.push("/worker/home")}>
          <span style={{ ...s.navIcon, color: "#111827" }}>🏠</span>
          <span style={{ ...s.navLabel, color: "#111827", fontWeight: 700 }}>홈</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/calendar")}>
          <span style={s.navIcon}>📅</span>
          <span style={s.navLabel}>캘린더</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/signature")}>
          <span style={s.navIcon}>✍️</span>
          <span style={s.navLabel}>전자서명</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/docs")}>
          <span style={s.navIcon}>📄</span>
          <span style={s.navLabel}>문서</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/history")}>
          <span style={s.navIcon}>💰</span>
          <span style={s.navLabel}>히스토리</span>
        </button>
      </nav>
    </div>
  );
}

// ─── 스타일 ──────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", backgroundColor: "#f9fafb" },
  container: { maxWidth: "480px", margin: "0 auto", padding: "16px 16px 90px" },
  center: { minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
  spinner: { width: 36, height: 36, border: "3px solid #e5e7eb", borderTop: "3px solid #111827", borderRadius: "50%", animation: "spin 0.8s linear infinite" },

  // 헤더
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, paddingTop: 4 },
  headerLeft: { display: "flex", flexDirection: "column", gap: 6 },
  logoText: { fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px" },
  siteBadge: { display: "inline-flex", alignItems: "center", gap: 4, background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 20, padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  profileBtn: { width: 40, height: 40, borderRadius: "50%", background: "#f3f4f6", border: "1px solid #e5e7eb", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  profileMenu: { position: "absolute", right: 0, top: 48, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.10)", zIndex: 100, minWidth: 140 },
  profileName: { padding: "8px 12px 8px", fontSize: 12, color: "#9ca3af", fontWeight: 600, borderBottom: "1px solid #f3f4f6", marginBottom: 4 },
  menuItem: { display: "block", width: "100%", padding: "10px 12px", border: "none", background: "transparent", fontSize: 14, fontWeight: 600, cursor: "pointer", textAlign: "left", borderRadius: 8, color: "#374151" },

  // 날짜/상태
  dateRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  dateText: { fontSize: 17, fontWeight: 700, color: "#111827" },
  statusBadge: { padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600 },

  // 카드
  card: { borderRadius: 20, padding: "24px 20px", textAlign: "center", marginBottom: 20, border: "1.5px solid" },
  cardTitle: { fontSize: 13, fontWeight: 500, color: "#6b7280", margin: "0 0 20px" },

  // 시간 표시
  clockWrap: { display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4, marginBottom: 24 },
  clockTime: { fontSize: 52, fontWeight: 800, color: "#111827", fontVariantNumeric: "tabular-nums", letterSpacing: "-2px" },
  clockSec: { fontSize: 24, fontWeight: 600, color: "#9ca3af", letterSpacing: "-1px" },
  timePair: { display: "flex", alignItems: "center", gap: 20, justifyContent: "center" },
  timeBlock: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  timeBlockLabel: { fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px" },
  timeBlockValue: { fontSize: 32, fontWeight: 800, color: "#111827", letterSpacing: "-1px", fontVariantNumeric: "tabular-nums" },
  timeSep: { fontSize: 20, color: "#d1d5db", fontWeight: 300, marginTop: 12 },

  // 버튼
  actionBtn: { width: "100%", padding: "15px", fontSize: 16, fontWeight: 700, border: "none", borderRadius: 12, cursor: "pointer", transition: "opacity 0.2s" },

  // 섹션
  section: { marginBottom: 16 },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, padding: "0 2px" },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: "#374151" },
  sectionCount: { fontSize: 13, color: "#9ca3af", fontWeight: 600 },

  // 훈련생
  traineeList: { display: "flex", flexDirection: "column", gap: 8 },
  traineeCard: { display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "14px 16px", border: "1px solid #f3f4f6" },
  traineeAvatar: { width: 40, height: 40, borderRadius: "50%", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 },
  traineeInfo: { flex: 1 },
  traineeName: { fontSize: 15, fontWeight: 700, color: "#111827", margin: "0 0 2px" },
  traineeGender: { fontSize: 12, color: "#9ca3af", margin: 0 },
  logBtn: { background: "#111827", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 },

  // 현장 없음
  noSite: { textAlign: "center", padding: "40px 0" },
  noSiteText: { color: "#9ca3af", fontSize: 15, marginBottom: 20 },
  noSiteBtn: { padding: "13px 28px", background: "#111827", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer" },

  // 배너
  subscribeBanner: { display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "14px 16px", marginTop: 8, cursor: "pointer", border: "1px solid #e5e7eb" },
  bannerIcon: { fontSize: 24, flexShrink: 0 },
  bannerBody: { flex: 1 },
  bannerTitle: { fontSize: 13, fontWeight: 700, color: "#111827", margin: "0 0 2px" },
  bannerDesc: { fontSize: 12, color: "#9ca3af", margin: 0 },
  bannerArrow: { fontSize: 20, color: "#9ca3af", flexShrink: 0 },

  // 다이얼로그
  overlay: { position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.50)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 },
  dialogBox: { backgroundColor: "#fff", borderRadius: 16, padding: "24px 20px", maxWidth: 320, width: "100%", boxShadow: "0 16px 48px rgba(0,0,0,0.20)" },
  dialogTitle: { fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 10px" },
  dialogMsg: { fontSize: 14, color: "#6b7280", lineHeight: 1.7, margin: "0 0 20px", whiteSpace: "pre-line" },
  dialogBtns: { display: "flex", gap: 8 },
  dialogBtn: { flex: 1, padding: "11px", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  dialogBtnPrimary: { background: "#111827", color: "#fff" },
  dialogBtnDanger: { background: "#dc2626", color: "#fff" },
  dialogBtnCancel: { background: "#f3f4f6", color: "#374151" },

  // 하단 네비게이션
  bottomNav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, backgroundColor: "#fff", borderTop: "1px solid #f3f4f6", display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" },
  navItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: "10px 0", border: "none", backgroundColor: "transparent", cursor: "pointer" },
  navIcon: { fontSize: 22 },
  navLabel: { fontSize: 11, color: "#9ca3af", fontWeight: 500 },

  // 토스트
  toast: { position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", color: "#fff", padding: "11px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", zIndex: 2000, whiteSpace: "nowrap", maxWidth: "90vw", textAlign: "center" },
};
