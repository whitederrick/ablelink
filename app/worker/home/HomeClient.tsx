"use client";
// app/worker/home/HomeClient.tsx
// 직무지도원 메인화면 - 출퇴근 전체 플로우

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkerPayload } from "../_lib/session";

// ─── 타입 ───────────────────────────────────────────
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
}

// ─── 유틸 ───────────────────────────────────────────
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
  return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// ─── GPS 획득 ────────────────────────────────────────
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

// ─── 메인 컴포넌트 ───────────────────────────────────
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
    onConfirm: () => void;
    onCancel?: () => void;
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

  // 홈 데이터 로드 — API 응답 필드명을 HomeData 타입에 맞게 정규화
  const fetchHome = useCallback(async () => {
    try {
      const res = await fetch(`/api/home/${session.userId}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      const raw = data.data;

      // API 필드명 → HomeData 필드명 매핑
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

      // 거리 체크
      if (baseLat && baseLon) {
        const dist = Math.round(calcDistance(latitude, longitude, baseLat, baseLon));
        if (dist > allowance && !confirmOutOfRange) {
          // 범위 초과 → 확인 다이얼로그
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

  // 출근
  async function handleClockIn() {
    const ok = await doAttendance("/api/attendance/clock-in");
    if (ok) showToast("출근 처리되었습니다.", "success");
  }

  // 퇴근
  async function handleClockOut() {
    const ok = await doAttendance("/api/attendance/clock-out");
    if (ok) showToast("퇴근 처리되었습니다. (퇴근 시간 재확인 가능)", "success");
  }

  // 퇴근 시간 재확인
  async function handleReconfirm() {
    setDialog({
      title: "퇴근 시간 재확인",
      msg: "선택하신 시점의 위치값과 퇴근 시간이 업데이트됩니다.",
      confirmLabel: "재확인",
      cancelLabel: "최종마감",
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
    });
  }

  // 로그아웃
  async function handleLogout() {
    setShowProfile(false);
    await fetch("/api/worker/auth/logout", { method: "POST" });
    router.replace("/worker/login");
  }

  // ─── 렌더 ──────────────────────────────────────────
  if (loading) {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <p style={{ color: "#888", marginTop: 12 }}>불러오는 중...</p>
      </div>
    );
  }

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${pad2(currentTime.getHours())} : ${pad2(currentTime.getMinutes())}`;

  const statusLabel: Record<AttendanceStatus, string> = {
    BEFORE: "출근전", WORKING: "퇴근전", DONE: "마감중", CLOSED: "퇴근완료",
  };
  const cardTitle: Record<AttendanceStatus, string> = {
    BEFORE: "출근 버튼을 눌러주세요.",
    WORKING: "오늘도 화이팅하세요!",
    DONE: "오늘 업무가 종료되었습니다.",
    CLOSED: "오늘 업무가 최종 종료되었습니다.",
  };

  const startStr = formatHHMM(homeData?.workStartTime ?? null);
  const endStr = formatHHMM(homeData?.workEndTime ?? null);

  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* ── 헤더 ── */}
        <div style={s.header}>
          <div>
            <p style={s.greeting}>안녕하세요, {session.userName}님</p>
            {homeData?.siteName && (
              <button
                onClick={() => router.push("/worker/site")}
                style={s.siteBadge}
              >
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
              <span style={s.profileIcon}>👤</span>
            </button>
            {showProfile && (
              <div style={s.profileMenu}>
                <button style={s.menuItem} onClick={() => { setShowProfile(false); router.push("/worker/profile"); }}>
                  정보수정
                </button>
                <button style={{ ...s.menuItem, ...s.menuDanger }} onClick={handleLogout}>
                  로그아웃
                </button>
                <button style={{ ...s.menuItem, color: "#888" }} onClick={() => setShowProfile(false)}>
                  닫기
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── 날짜 + 상태 배지 ── */}
        <div style={s.dateRow}>
          <span style={s.dateText}>{nowDateStr()}</span>
          <span style={{
            ...s.statusBadge,
            ...(status === "WORKING" ? s.statusWorking : {}),
            ...(status === "CLOSED" ? s.statusClosed : {}),
          }}>
            {statusLabel[status]}
          </span>
        </div>

        {/* ── 출퇴근 카드 ── */}
        <div style={s.card}>
          <p style={s.cardTitle}>{cardTitle[status]}</p>

          {status === "BEFORE" && (
            <>
              <p style={s.cardSub}>현재 시간</p>
              <p style={s.clockTime}>{timeStr}</p>
              <button
                style={{ ...s.actionBtn, opacity: actionLoading ? 0.7 : 1 }}
                onClick={handleClockIn}
                disabled={actionLoading}
              >
                {actionLoading ? "처리 중..." : "➜ 출근하기"}
              </button>
            </>
          )}

          {status === "WORKING" && (
            <>
              <p style={s.cardSub}>출근 시각 / 현재 시각</p>
              <p style={s.clockTime}>{startStr} / {timeStr}</p>
              <button
                style={{ ...s.actionBtn, backgroundColor: "#e53935", opacity: actionLoading ? 0.7 : 1 }}
                onClick={handleClockOut}
                disabled={actionLoading}
              >
                {actionLoading ? "처리 중..." : "➜ 퇴근하기"}
              </button>
            </>
          )}

          {status === "DONE" && (
            <>
              <p style={s.cardSub}>시작 시각 / 종료 시각</p>
              <p style={s.clockTime}>{startStr} / {endStr}</p>
              <p style={s.cardSub}>현재 시간</p>
              <p style={{ ...s.clockTime, fontSize: "28px", color: "#888" }}>{timeStr}</p>
              <button
                style={{ ...s.actionBtn, backgroundColor: "#2e7d32", opacity: actionLoading ? 0.7 : 1 }}
                onClick={handleReconfirm}
                disabled={actionLoading}
              >
                {actionLoading ? "처리 중..." : "퇴근 시간 재확인"}
              </button>
            </>
          )}

          {status === "CLOSED" && (
            <>
              <p style={s.cardSub}>시작 시각 / 종료 시각</p>
              <p style={s.clockTime}>{startStr} / {endStr}</p>
              <p style={{ color: "#999", fontSize: "15px", marginTop: 8 }}>오늘 업무가 종료되었습니다.</p>
              <button style={{ ...s.actionBtn, backgroundColor: "#aaa", cursor: "not-allowed" }} disabled>
                업무 종료
              </button>
            </>
          )}
        </div>

        {/* ── 훈련생 목록 ── */}
        {homeData?.trainees && homeData.trainees.length > 0 && (
          <div style={s.traineeSection}>
            {homeData.trainees.map(t => (
              <div key={t.id} style={s.traineeCard}>
                <div>
                  <p style={s.traineeName}>{t.name} 훈련생</p>
                  <p style={s.traineeGender}>{t.gender === "M" ? "남성" : "여성"}</p>
                </div>
                <button
                  style={s.logBtn}
                  onClick={() => {
                    const aid = homeData?.attendanceId ?? "";
                    const params = new URLSearchParams({
                      traineeId: t.id,
                      traineeName: t.name,
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
        )}

        {/* 현장 없을 때 */}
        {!homeData?.siteName && (
          <div style={s.noSite}>
            <p style={{ color: "#888", marginBottom: 12 }}>배정된 현장이 없습니다.</p>
            <button style={s.actionBtn} onClick={() => router.push("/worker/site/register")}>
              현장 등록하기
            </button>
          </div>
        )}

        {/* PREMIUM 구독 유도 배너 */}
        {homeData?.siteName && (
          <div style={s.subscribeBanner} onClick={() => router.push("/worker/subscribe")}>
            <div>
              <p style={s.bannerTitle}>🎁 AI 기능 & PDF 자동 생성</p>
              <p style={s.bannerDesc}>구독하시면 음성 일지 작성, PDF 자동 발송 등 PREMIUM 기능을 사용할 수 있어요.</p>
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
            <div style={s.dialogBtns}>
              {dialog.onCancel && (
                <button
                  style={{ ...s.dialogBtn, ...s.dialogBtnCancel }}
                  onClick={dialog.onCancel}
                >
                  {dialog.cancelLabel ?? "취소"}
                </button>
              )}
              <button
                style={{
                  ...s.dialogBtn,
                  ...(dialog.variant === "danger" ? s.dialogBtnDanger : s.dialogBtnPrimary),
                }}
                onClick={dialog.onConfirm}
              >
                {dialog.confirmLabel ?? "확인"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 토스트 ── */}
      {toast && (
        <div style={{
          ...s.toast,
          backgroundColor:
            toast.type === "success" ? "#2e7d32" :
            toast.type === "error" ? "#c62828" : "#2563eb",
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── 하단 네비게이션 ── */}
      <nav style={s.bottomNav}>
        <button style={s.navItem} onClick={() => router.push("/worker/home")}>
          <span style={{ ...s.navIcon, color: "#2563eb" }}>🏠</span>
          <span style={{ ...s.navLabel, color: "#2563eb" }}>홈</span>
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
      </nav>
    </div>
  );
}

// ─── 스타일 ──────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", backgroundColor: "#f8f9ff" },
  container: { maxWidth: "480px", margin: "0 auto", padding: "20px 16px 90px" },
  center: { minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
  spinner: { width: 40, height: 40, border: "3px solid #e5e7eb", borderTop: "3px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" },

  // 헤더
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  greeting: { fontSize: 20, fontWeight: 700, color: "#111827", margin: "0 0 8px" },
  siteBadge: { display: "inline-flex", alignItems: "center", gap: 4, backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: 20, padding: "7px 14px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  profileBtn: { width: 48, height: 48, borderRadius: "50%", backgroundColor: "#f0f0f0", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  profileIcon: { fontSize: 22 },
  profileMenu: { position: "absolute", right: 0, top: 56, backgroundColor: "#fff", border: "1px solid #eee", borderRadius: 14, padding: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 100, minWidth: 140 },
  menuItem: { display: "block", width: "100%", padding: "11px 16px", border: "none", backgroundColor: "transparent", fontSize: 15, fontWeight: 600, cursor: "pointer", textAlign: "left", borderRadius: 8, color: "#333" },
  menuDanger: { color: "#e53935", backgroundColor: "#fff5f5", marginTop: 4 },

  // 날짜/상태
  dateRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  dateText: { fontSize: 20, fontWeight: 700, color: "#333" },
  statusBadge: { backgroundColor: "#e0e0e0", color: "#555", padding: "7px 14px", borderRadius: 20, fontSize: 14, fontWeight: 700 },
  statusWorking: { backgroundColor: "#e8f5e9", color: "#2e7d32" },
  statusClosed: { backgroundColor: "#f0f0f0", color: "#999" },

  // 카드
  card: { backgroundColor: "#fff", borderRadius: 20, padding: "28px 24px", textAlign: "center", marginBottom: 24, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1px solid #eee" },
  cardTitle: { fontSize: 14, fontWeight: 600, color: "#374151", margin: "0 0 12px" },
  cardSub: { fontSize: 13, color: "#888", margin: "0 0 4px" },
  clockTime: { fontSize: 38, fontWeight: 800, color: "#111827", margin: "4px 0 20px" },
  actionBtn: { width: "100%", padding: "15px", backgroundColor: "#2563eb", color: "#fff", fontSize: 18, fontWeight: 700, border: "none", borderRadius: 12, cursor: "pointer", transition: "opacity 0.2s" },

  // 훈련생
  traineeSection: { display: "flex", flexDirection: "column", gap: 12 },
  traineeCard: { display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, padding: "16px 18px", boxShadow: "0 1px 6px rgba(0,0,0,0.05)", border: "1px solid #eee" },
  traineeName: { fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 2px" },
  traineeGender: { fontSize: 13, color: "#888", margin: 0 },
  logBtn: { backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" },

  noSite: { textAlign: "center", padding: "40px 0" },
  subscribeBanner: { display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#eff6ff", borderRadius: 14, padding: "14px 16px", marginTop: 16, cursor: "pointer", border: "1px solid #bfdbfe" },
  bannerTitle: { fontSize: 14, fontWeight: 700, color: "#2563eb", margin: "0 0 4px" },
  bannerDesc: { fontSize: 12, color: "#666", margin: 0, lineHeight: 1.5 },
  bannerArrow: { fontSize: 22, color: "#2563eb", flexShrink: 0 },

  // 다이얼로그
  overlay: { position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 },
  dialogBox: { backgroundColor: "#fff", borderRadius: 16, padding: "24px 20px", maxWidth: 320, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" },
  dialogTitle: { fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 10px" },
  dialogMsg: { fontSize: 14, color: "#555", lineHeight: 1.6, margin: "0 0 20px", whiteSpace: "pre-line" },
  dialogBtns: { display: "flex", gap: 8, justifyContent: "flex-end" },
  dialogBtn: { padding: "10px 18px", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  dialogBtnPrimary: { backgroundColor: "#2563eb", color: "#fff" },
  dialogBtnDanger: { backgroundColor: "#e53935", color: "#fff" },
  dialogBtnCancel: { backgroundColor: "#f0f0f0", color: "#555" },

  // 하단 네비게이션
  bottomNav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, backgroundColor: "#fff", borderTop: "1px solid #eee", display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" },
  navItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "10px 0", border: "none", backgroundColor: "transparent", cursor: "pointer" },
  navIcon: { fontSize: 22 },
  navLabel: { fontSize: 11, color: "#888", fontWeight: 500 },

  // 토스트
  toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", color: "#fff", padding: "12px 20px", borderRadius: 12, fontSize: 14, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", zIndex: 2000, whiteSpace: "nowrap", maxWidth: "90vw", textAlign: "center" },
};
