"use client";
// app/admin/page.tsx — 에이전시 관리자 대시보드

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface DashboardData {
  today: string;
  summary: {
    todayWorking: number; todayDone: number;
    unconfirmedCount: number; docPendingSubmit: number; docOverdue: number;
    endingIn5: number; endingIn10: number; unassignedSiteCount: number;
  };
  attendanceIssueList: Array<{
    id: string; userName: string; siteName: string;
    workDate: string; issueTypes: string[]; createdAt: string;
  }>;
  docList: Array<{
    id: string; docType: string; docTypeLabel: string;
    coachName: string; siteName: string; dueAt: string;
    isOverdue: boolean; hasVersion: boolean;
  }>;
  assignmentAlerts: Array<{
    id: string; userName: string; siteName: string;
    endDate: string | null; serviceStep: string; daysLeft: number | null;
  }>;
  riskAlerts: Array<{
    type: string; label: string; target: string; detail: string;
    severity: "high" | "medium" | "low";
  }>;
  todayList: Array<{
    id: string; userName: string; siteName: string;
    clockIn: string | null; clockOut: string | null;
    isFinalClosed: boolean; isGpsModified: boolean;
    hasIssue: boolean; logStatus: "미작성" | "임시저장" | "완료";
  }>;
}

const SEVERITY_COLOR = { high: "#dc2626", medium: "#ea580c", low: "#6b7280" };
const SEVERITY_BG   = { high: "#fef2f2", medium: "#fff7ed", low: "#f9fafb" };
const LOG_COLOR: Record<string, string> = { 완료: "#16a34a", 임시저장: "#d97706", 미작성: "#dc2626" };
const ISSUE_TYPE_LABEL: Record<string, string> = {
  MISSING_CLOCK_IN: "출근 누락", MISSING_CLOCK_OUT: "퇴근 누락",
  OUT_OF_RANGE: "GPS 이탈", TIME_ANOMALY: "시간 이상",
};
const SERVICE_STEP_LABEL: Record<string, string> = {
  PRE_TRAINING: "사전훈련", FIELD_TRAINING: "현장훈련", ADAPTATION: "적응지도",
};

// ── 팝업 컴포넌트 ──────────────────────────────────────────────────
function CountPopup({
  count, color, bg, items, onItemClick, onClose, renderItem,
}: {
  count: number; color: string; bg: string;
  items: any[]; onItemClick: (item: any) => void;
  onClose: () => void; renderItem: (item: any) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <span
        style={{ fontSize: 15, fontWeight: 800, color, cursor: count > 0 ? "pointer" : "default",
          background: bg, padding: "2px 10px", borderRadius: 20, border: `1px solid ${color}30` }}
      >
        {count}건
      </span>
      {count > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 100,
          width: 320, maxHeight: 280, overflowY: "auto",
        }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", fontSize: 11, color: "#9ca3af", fontWeight: 600 }}>
            총 {items.length}건 · 클릭하면 상세 화면으로 이동
          </div>
          {items.map((item, i) => (
            <div
              key={i}
              onClick={() => { onItemClick(item); onClose(); }}
              style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f9", cursor: "pointer",
                fontSize: 13, color: "#374151", transition: "background 0.1s" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#f9fafb"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "#fff"}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // 팝업 상태
  const [popup, setPopup] = useState<null | "attendance_unconfirmed" | "attendance_gps" | "attendance_time" | "doc_pending" | "doc_overdue" | "assign_ending">(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/dashboard", { cache: "no-store" });
      const json = await res.json();
      if (json.success) { setData(json.data); setLastUpdated(new Date()); }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const t = setInterval(fetchDashboard, 3 * 60 * 1000);
    return () => clearInterval(t);
  }, [fetchDashboard]);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400, flexDirection: "column", gap: 12 }}>
      <div style={{ width: 28, height: 28, border: "2.5px solid #e5e7eb", borderTop: "2.5px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ color: "#9ca3af", fontSize: 13 }}>로딩 중...</span>
    </div>
  );

  const d = data;
  const s = d?.summary;
  const todayFmt = d?.today
    ? `${d.today.slice(0,4)}년 ${Number(d.today.slice(5,7))}월 ${Number(d.today.slice(8,10))}일 (${["일","월","화","수","목","금","토"][new Date(d.today).getDay()]})`
    : "";

  // 이슈 분류
  const gpsIssues = d?.attendanceIssueList.filter(i => i.issueTypes.includes("OUT_OF_RANGE")) ?? [];
  const timeIssues = d?.attendanceIssueList.filter(i => i.issueTypes.includes("MISSING_CLOCK_IN") || i.issueTypes.includes("MISSING_CLOCK_OUT") || i.issueTypes.includes("TIME_ANOMALY")) ?? [];
  const docPendingList = d?.docList.filter(r => !r.isOverdue) ?? [];
  const docOverdueList = d?.docList.filter(r => r.isOverdue) ?? [];

  return (
    <div style={{ maxWidth: 1200, fontFamily: "inherit" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827", letterSpacing: "-0.3px" }}>◆ 업무 현황 요약</h1>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: "#9ca3af" }}>{todayFmt}</p>
        </div>
        <button onClick={fetchDashboard} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, background: "none", border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 12, color: "#6b7280" }}>
          <span>새로고침</span>
          <span style={{ color: "#d1d5db", fontSize: 11 }}>{lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 업데이트</span>
        </button>
      </div>

      {/* 요약 카드 7종 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10, marginBottom: 24 }}>
        {[
          { label: "오늘 근무",      value: s?.todayWorking ?? 0,        unit: "명", color: "#2563eb", bg: "#eff6ff" },
          { label: "미확인 근태",    value: s?.unconfirmedCount ?? 0,    unit: "건", color: "#dc2626", bg: "#fef2f2", urgent: (s?.unconfirmedCount ?? 0) > 0, onClick: () => router.push("/admin/inbox/attendance") },
          { label: "보고서 제출 대기", value: s?.docPendingSubmit ?? 0,  unit: "건", color: "#d97706", bg: "#fffbeb", onClick: () => router.push("/admin/documents") },
          { label: "보고서 미제출",   value: s?.docOverdue ?? 0,         unit: "건", color: "#dc2626", bg: "#fef2f2", urgent: (s?.docOverdue ?? 0) > 0, onClick: () => router.push("/admin/documents") },
          { label: "배정 종료 임박",  value: s?.endingIn5 ?? 0,          unit: "명", color: "#dc2626", bg: "#fef2f2", sub: `D-10: ${s?.endingIn10 ?? 0}명` },
          { label: "종료 임박(D-10)", value: s?.endingIn10 ?? 0,         unit: "명", color: "#dc2626", bg: "#fef2f2" },
          { label: "미배정 Site",     value: s?.unassignedSiteCount ?? 0, unit: "건", color: (s?.unassignedSiteCount ?? 0) > 0 ? "#dc2626" : "#6b7280", bg: (s?.unassignedSiteCount ?? 0) > 0 ? "#fef2f2" : "#f9fafb", onClick: () => router.push("/admin/sites") },
        ].map((card, i) => (
          <div key={i} onClick={card.onClick}
            style={{ background: card.bg, borderRadius: 12, padding: "14px 10px", textAlign: "center",
              cursor: card.onClick ? "pointer" : "default", border: `1px solid ${card.urgent ? card.color + "40" : "#e5e7eb"}` }}
          >
            <p style={{ margin: "0 0 6px", fontSize: 11, color: "#6b7280", lineHeight: 1.3 }}>{card.label}</p>
            <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: card.color, lineHeight: 1 }}>
              {card.value}<span style={{ fontSize: 12, fontWeight: 500, marginLeft: 2 }}>{card.unit}</span>
            </p>
            {card.sub && <p style={{ margin: "3px 0 0", fontSize: 10, color: "#9ca3af" }}>{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* 메인 그리드 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>

        {/* 좌측: 3개 ActionCard */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* 근태 현황 */}
          <Section title="◆ 근태 현황" sub="근무 중 직무지도원 근태 현황" count={s?.unconfirmedCount} onMore={() => router.push("/admin/inbox/attendance")}>
            <ActionRow
              icon="●" iconColor="#dc2626" label="출퇴근 기록 누락"
              count={timeIssues.length} countColor="#dc2626" countBg="#fef2f2"
              onCountClick={() => setPopup(p => p === "attendance_time" ? null : "attendance_time")}
              showPopup={popup === "attendance_time"}
              popupItems={timeIssues}
              onPopupItemClick={() => router.push("/admin/inbox/attendance")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span><b>{item.userName}</b> · {item.siteName}</span>
                  <span style={{ color: "#9ca3af", fontSize: 12 }}>{item.workDate}</span>
                </div>
              )}
            />
            <ActionRow
              icon="▲" iconColor="#d97706" label="근무지 기준 범위 이탈"
              count={gpsIssues.length} countColor="#d97706" countBg="#fffbeb"
              onCountClick={() => setPopup(p => p === "attendance_gps" ? null : "attendance_gps")}
              showPopup={popup === "attendance_gps"}
              popupItems={gpsIssues}
              onPopupItemClick={() => router.push("/admin/inbox/attendance")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span><b>{item.userName}</b> · {item.siteName}</span>
                  <span style={{ color: "#9ca3af", fontSize: 12 }}>{item.workDate}</span>
                </div>
              )}
            />
            <div style={{ marginTop: 8, padding: "8px 0 0", borderTop: "1px solid #f0f0f0" }}>
              <button onClick={() => router.push("/admin/inbox/attendance")}
                style={{ fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                → 근태 관리 바로가기
              </button>
            </div>
          </Section>

          {/* 보고서 제출 현황 */}
          <Section title="◆ 보고서 제출 현황" sub="직무지도원 문서 제출 현황" count={(s?.docPendingSubmit ?? 0) + (s?.docOverdue ?? 0)} onMore={() => router.push("/admin/documents")}>
            <ActionRow
              icon="●" iconColor="#d97706" label="보고서 제출 대기"
              count={s?.docPendingSubmit ?? 0} countColor="#d97706" countBg="#fffbeb"
              onCountClick={() => setPopup(p => p === "doc_pending" ? null : "doc_pending")}
              showPopup={popup === "doc_pending"}
              popupItems={docPendingList}
              onPopupItemClick={() => router.push("/admin/documents")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span><b>{item.siteName}</b> · {item.coachName}</span>
                  <span style={{ color: "#d97706", fontSize: 12 }}>{item.docTypeLabel}</span>
                </div>
              )}
            />
            <ActionRow
              icon="▲" iconColor="#6b7280" label="보고서 반려(수정 요청)"
              count={0} countColor="#6b7280" countBg="#f9fafb"
              onCountClick={() => {}}
              showPopup={false} popupItems={[]}
              onPopupItemClick={() => {}} onPopupClose={() => {}}
              renderPopupItem={() => null}
            />
            <ActionRow
              icon="⊙" iconColor="#dc2626" label="보고서 미제출"
              count={s?.docOverdue ?? 0} countColor="#dc2626" countBg="#fef2f2"
              onCountClick={() => setPopup(p => p === "doc_overdue" ? null : "doc_overdue")}
              showPopup={popup === "doc_overdue"}
              popupItems={docOverdueList}
              onPopupItemClick={() => router.push("/admin/documents")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span><b>{item.siteName}</b> · {item.coachName}</span>
                  <span style={{ color: "#dc2626", fontSize: 12 }}>{item.docTypeLabel}</span>
                </div>
              )}
            />
            <div style={{ marginTop: 8, padding: "8px 0 0", borderTop: "1px solid #f0f0f0" }}>
              <button onClick={() => router.push("/admin/documents")}
                style={{ fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                → 문서 관리 바로가기
              </button>
            </div>
          </Section>

          {/* 배정/계약 현황 */}
          <Section title="◆ 배정 / 계약 현황" sub="배정 / 계약 이슈 현황" count={s?.endingIn10} onMore={() => router.push("/admin/coaches")}>
            <ActionRow
              icon="●" iconColor="#dc2626" label="배정 종료 임박"
              count={s?.endingIn10 ?? 0} countColor="#dc2626" countBg="#fef2f2"
              onCountClick={() => setPopup(p => p === "assign_ending" ? null : "assign_ending")}
              showPopup={popup === "assign_ending"}
              popupItems={d?.assignmentAlerts ?? []}
              onPopupItemClick={() => router.push("/admin/coaches")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span><b>{item.userName}</b> · {item.siteName}</span>
                  <span style={{ color: (item.daysLeft ?? 99) <= 3 ? "#dc2626" : "#d97706", fontSize: 12, fontWeight: 700 }}>D-{item.daysLeft}</span>
                </div>
              )}
            />
            <ActionRow
              icon="▲" iconColor="#6b7280" label="계약서 미등록"
              count={0} countColor="#6b7280" countBg="#f9fafb"
              onCountClick={() => {}} showPopup={false} popupItems={[]}
              onPopupItemClick={() => {}} onPopupClose={() => {}} renderPopupItem={() => null}
            />
            <ActionRow
              icon="⊙" iconColor="#6b7280" label="직무지도원 미배정 Site"
              count={s?.unassignedSiteCount ?? 0} countColor="#6b7280" countBg="#f9fafb"
              onCountClick={() => router.push("/admin/sites")}
              showPopup={false} popupItems={[]}
              onPopupItemClick={() => {}} onPopupClose={() => {}} renderPopupItem={() => null}
            />
            <div style={{ marginTop: 8, padding: "8px 0 0", borderTop: "1px solid #f0f0f0" }}>
              <button onClick={() => router.push("/admin/coaches")}
                style={{ fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                → 직무지도원 운영 바로가기
              </button>
            </div>
          </Section>
        </div>

        {/* 우측 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* 운영 리스크 알림 */}
          <Section title="◆ 운영 리스크 알림" onMore={() => {}}>
            {!d?.riskAlerts.length ? <EmptyRow text="리스크 알림 없음" /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {d.riskAlerts.map((alert, i) => (
                  <div key={i} style={{ padding: "7px 10px", background: SEVERITY_BG[alert.severity], borderRadius: 6, borderLeft: `3px solid ${SEVERITY_COLOR[alert.severity]}` }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: SEVERITY_COLOR[alert.severity], marginRight: 4 }}>{alert.label}</span>
                    <span style={{ fontSize: 12, color: "#374151" }}>{alert.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 공지사항 */}
          <Section title="◆ 공지사항" onMore={() => {}}>
            {["[공지] 관리자 시스템 기능 매뉴얼", "[안내] 직무지도원앱(APP) 서비스 기능 연계 안내", "[안내] 기능 고도화 일정 안나", "[안내] 직무지도원 보고서 장애인고용공단 전송 기능 안내"].map((notice, i) => (
              <div key={i} style={{ padding: "7px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13, color: "#374151" }}>{notice}</div>
            ))}
          </Section>

          {/* 오늘 출근 현황 */}
          <Section title="◆ 오늘 출근 현황" sub={`근무 ${s?.todayWorking ?? 0}명 / 종료 ${s?.todayDone ?? 0}명`} onMore={() => router.push("/admin/attendances")}>
            {!d?.todayList.length ? <EmptyRow text="오늘 출근 기록 없음" /> : (
              <div>
                {d.todayList.slice(0, 6).map(row => (
                  <div key={row.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: "#111827" }}>
                      {row.userName}
                      {row.hasIssue && <span style={{ marginLeft: 4, fontSize: 10, background: "#fef2f2", color: "#dc2626", borderRadius: 4, padding: "1px 5px" }}>이슈</span>}
                    </span>
                    <span style={{ color: "#9ca3af", fontSize: 12 }}>{row.clockIn || "-"} ~ {row.clockOut || "-"}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: LOG_COLOR[row.logStatus] || "#9ca3af" }}>{row.logStatus}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── ActionRow 컴포넌트 ────────────────────────────────────────────
function ActionRow({ icon, iconColor, label, count, countColor, countBg, onCountClick, showPopup, popupItems, onPopupItemClick, onPopupClose, renderPopupItem }: {
  icon: string; iconColor: string; label: string;
  count: number; countColor: string; countBg: string;
  onCountClick: () => void; showPopup: boolean;
  popupItems: any[]; onPopupItemClick: (item: any) => void;
  onPopupClose: () => void; renderPopupItem: (item: any) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPopup) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onPopupClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPopup, onPopupClose]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #f3f4f6" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: iconColor, fontSize: 12, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 13, color: "#374151" }}>{label}</span>
      </div>
      <div ref={ref} style={{ position: "relative" }}>
        <span
          onClick={count > 0 ? onCountClick : undefined}
          style={{
            fontSize: 14, fontWeight: 800, color: countColor,
            background: countBg, padding: "3px 12px", borderRadius: 20,
            border: `1px solid ${countColor}30`,
            cursor: count > 0 ? "pointer" : "default",
            display: "inline-block",
          }}
        >
          {count}건
        </span>
        {showPopup && count > 0 && (
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0,
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 100,
            width: 340, maxHeight: 280, overflowY: "auto",
          }}>
            <div style={{ padding: "8px 14px", borderBottom: "1px solid #f0f0f0", fontSize: 11, color: "#9ca3af", fontWeight: 600 }}>
              총 {popupItems.length}건 · 클릭하면 상세 화면으로 이동
            </div>
            {popupItems.map((item, i) => (
              <div key={i} onClick={() => { onPopupItemClick(item); onPopupClose(); }}
                style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f9", cursor: "pointer", fontSize: 13, color: "#374151" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#f9fafb"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "#fff"}
              >
                {renderPopupItem(item)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 섹션 래퍼 ─────────────────────────────────────────────────────
function Section({ title, sub, count, onMore, children }: {
  title: string; sub?: string; count?: number;
  onMore?: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#111827" }}>
            {title}
            {count !== undefined && count > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, background: "#dc2626", color: "#fff", borderRadius: 10, padding: "1px 7px" }}>{count}</span>
            )}
          </h2>
          {sub && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{sub}</p>}
        </div>
        {onMore && (
          <button onClick={onMore} style={{ background: "none", border: "none", fontSize: 12, color: "#2563eb", cursor: "pointer", fontWeight: 600, padding: 0 }}>
            더 보기 +
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p style={{ margin: 0, fontSize: 13, color: "#d1d5db", textAlign: "center", padding: "16px 0" }}>{text}</p>;
}
