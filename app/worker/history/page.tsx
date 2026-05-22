"use client";
// app/worker/history/page.tsx
// 직무지도원 — 근무 히스토리 + 급여명세 탭

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "history" | "payroll";

// ── 히스토리 타입 ────────────────────────────────────────
interface HistoryItem {
  id: string; workDate: string; siteName: string;
  serviceStep: string | null;
  startTime: string | null; endTime: string | null;
  workedMinutes: number;
  isFinalClosed: boolean; isGpsModified: boolean;
  logStatus: "NONE" | "DRAFT" | "DONE";
  hasIssue: boolean; issueTypes: string[];
}
interface HistoryStats { total: number; workedDays: number; totalMinutes: number; issueCount: number; }

// ── 급여 타입 ──────────────────────────────────────────
interface PayrollItem {
  id: string; runId: string; yearMonth: string; agencyName: string;
  finalizedAt: string | null;
  grossPay: number; totalDeduction: number; netPay: number;
  workedDays: number; workedMinutes: number; breakdown: any;
}

// ── 유틸 ───────────────────────────────────────────────
function pad2(n: number) { return String(n).padStart(2, "0"); }
function defaultYM() {
  const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function fmtTime(iso: string | null) {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtMin(m: number) {
  if (!m) return "-";
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
function comma(n: number) { return Math.round(n).toLocaleString("ko-KR"); }

const stepLabel: Record<string, string> = {
  PRE_TRAINING: "사전훈련", FIELD_TRAINING: "현장훈련", ADAPTATION: "적응지도",
};
const logBadge: Record<string, { bg: string; color: string; label: string }> = {
  NONE:  { bg: "#f3f4f6", color: "#9ca3af", label: "미작성" },
  DRAFT: { bg: "#fffbeb", color: "#d97706", label: "임시저장" },
  DONE:  { bg: "#f0fdf4", color: "#16a34a", label: "완료" },
};
const payTypeLabel: Record<string, string> = { MONTHLY: "월급", DAILY: "일급", HOURLY: "시급" };

export default function HistoryPage() {
  const router = useRouter();
  const [tab, setTab]             = useState<Tab>("history");

  // ── 히스토리 상태
  const [yearMonth, setYearMonth] = useState(defaultYM());
  const [items,     setItems]     = useState<HistoryItem[]>([]);
  const [stats,     setStats]     = useState<HistoryStats | null>(null);
  const [loading,   setLoading]   = useState(false);

  // ── 급여 상태
  const [payItems,    setPayItems]    = useState<PayrollItem[]>([]);
  const [loadingPay,  setLoadingPay]  = useState(false);
  const [selectedPay, setSelectedPay] = useState<PayrollItem | null>(null);

  // ── 히스토리 로드
  async function loadHistory() {
    setLoading(true);
    try {
      const res = await fetch(`/api/worker/history?yearMonth=${yearMonth}`);
      const d = await res.json();
      if (d.success) { setItems(d.items); setStats(d.stats); }
    } finally { setLoading(false); }
  }

  // ── 급여명세 로드
  async function loadPayroll() {
    setLoadingPay(true);
    try {
      const res = await fetch("/api/worker/payroll");
      const d = await res.json();
      if (d.success) setPayItems(d.items);
    } finally { setLoadingPay(false); }
  }

  useEffect(() => {
    if (tab === "history") loadHistory();
    else loadPayroll();
  }, [tab]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [yearMonth]);

  // ── 급여명세 상세 뷰
  if (selectedPay) {
    const b = selectedPay.breakdown as any;
    return (
      <div style={s.page}>
        <div style={s.header}>
          <button onClick={() => setSelectedPay(null)} style={s.backBtn}>←</button>
          <h1 style={s.title}>{selectedPay.yearMonth} 급여명세</h1>
          <div style={{ width: 36 }} />
        </div>
        <div style={{ padding: "20px 16px" }}>
          {/* 에이전시 */}
          <div style={s.infoCard}>
            <div style={s.infoRow}>
              <span style={s.infoLabel}>소속 에이전시</span>
              <span style={s.infoValue}>{selectedPay.agencyName}</span>
            </div>
            <div style={s.infoRow}>
              <span style={s.infoLabel}>지급 기간</span>
              <span style={s.infoValue}>{selectedPay.yearMonth}</span>
            </div>
            <div style={s.infoRow}>
              <span style={s.infoLabel}>확정일</span>
              <span style={s.infoValue}>{selectedPay.finalizedAt ? new Date(selectedPay.finalizedAt).toLocaleDateString("ko-KR") : "-"}</span>
            </div>
          </div>

          {/* 근무 요약 */}
          <div style={s.sectionTitle}>근무 현황</div>
          <div style={s.infoCard}>
            <div style={s.infoRow}>
              <span style={s.infoLabel}>근무 일수</span>
              <span style={s.infoValue}>{selectedPay.workedDays}일</span>
            </div>
            <div style={s.infoRow}>
              <span style={s.infoLabel}>총 근무 시간</span>
              <span style={s.infoValue}>{fmtMin(selectedPay.workedMinutes)}</span>
            </div>
            {b?.payType && (
              <div style={s.infoRow}>
                <span style={s.infoLabel}>급여 유형</span>
                <span style={s.infoValue}>{payTypeLabel[b.payType] || b.payType}</span>
              </div>
            )}
            {b?.hourlyRate && (
              <div style={s.infoRow}>
                <span style={s.infoLabel}>시급</span>
                <span style={s.infoValue}>{comma(b.hourlyRate)}원</span>
              </div>
            )}
            {b?.dailyRate && (
              <div style={s.infoRow}>
                <span style={s.infoLabel}>일급</span>
                <span style={s.infoValue}>{comma(b.dailyRate)}원</span>
              </div>
            )}
          </div>

          {/* 지급 내역 */}
          <div style={s.sectionTitle}>지급 내역</div>
          <div style={s.payCard}>
            <div style={s.payRow}>
              <span style={s.payLabel}>지급액</span>
              <span style={{ ...s.payValue, color: "#2563eb" }}>{comma(selectedPay.grossPay)}원</span>
            </div>
            <div style={{ height: 1, background: "#f0f0f0", margin: "10px 0" }} />
            <div style={s.payRow}>
              <span style={s.payLabel}>공제액 (사업소득세 3.3%)</span>
              <span style={{ ...s.payValue, color: "#dc2626" }}>-{comma(selectedPay.totalDeduction)}원</span>
            </div>
            <div style={{ height: 1, background: "#111827", margin: "10px 0" }} />
            <div style={s.payRow}>
              <span style={{ ...s.payLabel, fontWeight: 700, color: "#111827", fontSize: 15 }}>실지급액</span>
              <span style={{ ...s.payValue, color: "#16a34a", fontSize: 20, fontWeight: 800 }}>{comma(selectedPay.netPay)}원</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 메인 뷰
  return (
    <div style={s.page}>
      {/* 헤더 */}
      <div style={s.header}>
        <button onClick={() => router.back()} style={s.backBtn}>←</button>
        <h1 style={s.title}>히스토리</h1>
        <div style={{ width: 36 }} />
      </div>

      {/* 탭 */}
      <div style={s.tabRow}>
        <button onClick={() => setTab("history")}
          style={{ ...s.tabBtn, ...(tab === "history" ? s.tabActive : {}) }}>근무 히스토리</button>
        <button onClick={() => setTab("payroll")}
          style={{ ...s.tabBtn, ...(tab === "payroll" ? s.tabActive : {}) }}>급여명세</button>
      </div>

      {/* ── 히스토리 탭 ─────────────────────────────────── */}
      {tab === "history" && (
        <div style={{ padding: "16px 16px 80px" }}>
          {/* 월 선택 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input type="month" value={yearMonth} onChange={e => setYearMonth(e.target.value)}
              style={{ flex: 1, height: 42, border: "1px solid #e5e7eb", borderRadius: 10, padding: "0 12px", fontSize: 14, outline: "none", background: "#fff" }} />
            <button onClick={loadHistory} style={s.refreshBtn}>새로고침</button>
          </div>

          {/* 통계 카드 */}
          {stats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 16 }}>
              {[
                { label: "근무 일수", value: `${stats.workedDays}일`, color: "#2563eb" },
                { label: "총 근무 시간", value: fmtMin(stats.totalMinutes), color: "#16a34a" },
                { label: "전체 기록", value: `${stats.total}건`, color: "#374151" },
                { label: "이슈", value: `${stats.issueCount}건`, color: stats.issueCount > 0 ? "#dc2626" : "#9ca3af" },
              ].map((c, i) => (
                <div key={i} style={s.statCard}>
                  <p style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800, color: c.color }}>{c.value}</p>
                  <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>{c.label}</p>
                </div>
              ))}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: "center", padding: 32, color: "#9ca3af" }}>로딩 중...</div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <p style={{ color: "#9ca3af", fontSize: 14 }}>해당 월에 근무 기록이 없습니다.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map(item => (
                <div key={item.id} style={s.historyCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <span style={{ fontWeight: 700, color: "#111827", fontSize: 15 }}>{item.workDate}</span>
                      {item.serviceStep && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: "#6b7280", background: "#f3f4f6", borderRadius: 4, padding: "1px 6px" }}>
                          {stepLabel[item.serviceStep] ?? item.serviceStep}
                        </span>
                      )}
                    </div>
                    <span style={{ ...logBadge[item.logStatus], ...s.badge }}>
                      {logBadge[item.logStatus].label}
                    </span>
                  </div>

                  <p style={{ margin: "0 0 6px", fontSize: 13, color: "#6b7280" }}>📍 {item.siteName}</p>

                  <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#374151" }}>
                    <span>출근 <b>{fmtTime(item.startTime)}</b></span>
                    <span>퇴근 <b>{fmtTime(item.endTime)}</b></span>
                    {item.workedMinutes > 0 && (
                      <span style={{ color: "#6b7280" }}>{fmtMin(item.workedMinutes)}</span>
                    )}
                  </div>

                  {(item.isGpsModified || item.hasIssue) && (
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {item.isGpsModified && (
                        <span style={{ fontSize: 11, color: "#ea580c", background: "#fff7ed", borderRadius: 4, padding: "2px 7px" }}>⚠ GPS 이탈</span>
                      )}
                      {item.hasIssue && (
                        <span style={{ fontSize: 11, color: "#dc2626", background: "#fef2f2", borderRadius: 4, padding: "2px 7px" }}>근태 이슈</span>
                      )}
                    </div>
                  )}

                  {!item.isFinalClosed && item.startTime && (
                    <p style={{ margin: "6px 0 0", fontSize: 11, color: "#d97706" }}>⏳ 미확정</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 급여명세 탭 ──────────────────────────────────── */}
      {tab === "payroll" && (
        <div style={{ padding: "16px 16px 80px" }}>
          {loadingPay ? (
            <div style={{ textAlign: "center", padding: 32, color: "#9ca3af" }}>로딩 중...</div>
          ) : payItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <p style={{ color: "#9ca3af", fontSize: 14 }}>확정된 급여명세가 없습니다.</p>
              <p style={{ color: "#d1d5db", fontSize: 12, marginTop: 4 }}>에이전시에서 급여를 확정하면 여기서 확인할 수 있어요.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {payItems.map(item => (
                <button key={item.id} onClick={() => setSelectedPay(item)}
                  style={{ ...s.payListCard, textAlign: "left", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: 15, color: "#111827" }}>{item.yearMonth}</p>
                      <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>{item.agencyName} · {item.workedDays}일 근무</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ margin: "0 0 2px", fontWeight: 800, fontSize: 18, color: "#16a34a" }}>{comma(item.netPay)}원</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>실지급</p>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 12, fontSize: 12, color: "#6b7280" }}>
                    <span>지급액 {comma(item.grossPay)}원</span>
                    <span>공제 -{comma(item.totalDeduction)}원</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", background: "#f7f8fa", fontFamily: "-apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", background: "#fff", borderBottom: "1px solid #f0f0f0", position: "sticky", top: 0, zIndex: 10 },
  backBtn: { background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#333", width: 36 },
  title: { fontSize: 17, fontWeight: 700, color: "#111827", margin: 0 },
  tabRow: { display: "flex", background: "#fff", borderBottom: "1px solid #f0f0f0" },
  tabBtn: { flex: 1, padding: "13px 0", border: "none", background: "none", fontSize: 14, fontWeight: 500, color: "#9ca3af", cursor: "pointer", borderBottom: "2px solid transparent" },
  tabActive: { color: "#111827", fontWeight: 700, borderBottom: "2px solid #111827" },
  refreshBtn: { padding: "0 14px", height: 42, background: "#f3f4f6", border: "none", borderRadius: 10, fontSize: 13, cursor: "pointer", color: "#374151", whiteSpace: "nowrap" as const },
  statCard: { background: "#fff", borderRadius: 12, padding: "14px 16px", textAlign: "center" as const, border: "1px solid #f0f0f0" },
  historyCard: { background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #f0f0f0" },
  badge: { display: "inline-flex", alignItems: "center", padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600 },
  payListCard: { background: "#fff", borderRadius: 12, padding: "16px", border: "1px solid #f0f0f0", width: "100%" },
  infoCard: { background: "#f9fafb", borderRadius: 12, padding: "16px", marginBottom: 16, border: "1px solid #f0f0f0" },
  infoRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f0f0f0" },
  infoLabel: { fontSize: 13, color: "#6b7280" },
  infoValue: { fontSize: 13, color: "#111827", fontWeight: 600 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: "#374151", margin: "0 0 8px" },
  payCard: { background: "#fff", borderRadius: 12, padding: "18px 20px", marginBottom: 16, border: "1px solid #f0f0f0" },
  payRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" },
  payLabel: { fontSize: 14, color: "#6b7280" },
  payValue: { fontSize: 16, fontWeight: 700 },
};
