"use client";
import { useEffect, useState } from "react";
import { sharedStyles } from "../_styles";

type WorkType = "AM" | "PM" | "FULL_DAY" | "CUSTOM";

interface Assignment {
  id: string;
  workType: WorkType;
  commuteGuidanceIncluded: boolean;
  customWorkStart: string | null;
  customWorkEnd: string | null;
  startDate: string | null;
  endDate: string | null;
}

interface Coach {
  id: string;
  userName: string;
  phoneNumber: string;
  loginId: string;
  planType: string;
  status: string;
  createdAt: string;
  activeAssignment: { siteName: string; agencyName: string; startDate: string; assignmentId?: string } | null;
}

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  ACTIVE:   { label: "활성",   color: "#16a34a", bg: "#f0fdf4" },
  RESIGNED: { label: "퇴사",   color: "#6b7280", bg: "#f9fafb" },
  PAUSED:   { label: "일시정지", color: "#d97706", bg: "#fffbeb" },
};
const PLAN: Record<string, { label: string; color: string; bg: string }> = {
  FREE:     { label: "무료",   color: "#6b7280", bg: "#f9fafb" },
  PREMIUM:  { label: "프리미엄", color: "#7c3aed", bg: "#f5f3ff" },
};

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  AM:        "오전 (09:00~12:00)",
  PM:        "오후 (13:00~17:00)",
  FULL_DAY:  "전일 (09:00~18:00)",
  CUSTOM:    "직접 입력",
};

function WorkScheduleModal({
  coach,
  assignmentId,
  initial,
  onClose,
  onSaved,
}: {
  coach: Coach;
  assignmentId: string;
  initial: Assignment;
  onClose: () => void;
  onSaved: (updated: Assignment) => void;
}) {
  const [workType, setWorkType] = useState<WorkType>(initial.workType ?? "FULL_DAY");
  const [commuteGuidanceIncluded, setCommuteGuidanceIncluded] = useState(initial.commuteGuidanceIncluded ?? true);
  const [customStart, setCustomStart] = useState(initial.customWorkStart ?? "09:00");
  const [customEnd, setCustomEnd] = useState(initial.customWorkEnd ?? "18:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isFullDay = workType === "FULL_DAY";

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workType,
          commuteGuidanceIncluded: isFullDay ? false : commuteGuidanceIncluded,
          customWorkStart: workType === "CUSTOM" ? customStart : null,
          customWorkEnd:   workType === "CUSTOM" ? customEnd   : null,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      onSaved({
        ...initial,
        workType,
        commuteGuidanceIncluded: isFullDay ? false : commuteGuidanceIncluded,
        customWorkStart: workType === "CUSTOM" ? customStart : null,
        customWorkEnd:   workType === "CUSTOM" ? customEnd   : null,
      });
      onClose();
    } catch (e: any) {
      setError(e.message || "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 420, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>근무형태 설정</h2>
        <p style={{ fontSize: 13, color: "#9ca3af", margin: "0 0 20px" }}>{coach.userName} · {coach.activeAssignment?.siteName}</p>

        {/* 근무형태 선택 */}
        <div style={{ marginBottom: 16 }}>
          <label style={ls.label}>근무형태</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {(["AM", "PM", "FULL_DAY", "CUSTOM"] as WorkType[]).map(wt => (
              <button
                key={wt}
                type="button"
                onClick={() => setWorkType(wt)}
                style={{
                  ...ls.typeBtn,
                  ...(workType === wt ? ls.typeBtnActive : {}),
                }}
              >
                {WORK_TYPE_LABELS[wt]}
              </button>
            ))}
          </div>
        </div>

        {/* CUSTOM 시간 입력 */}
        {workType === "CUSTOM" && (
          <div style={{ marginBottom: 16 }}>
            <label style={ls.label}>근무 시간</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="time" value={customStart} onChange={e => setCustomStart(e.target.value)} style={ls.timeInput} />
              <span style={{ color: "#9ca3af" }}>~</span>
              <input type="time" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={ls.timeInput} />
            </div>
          </div>
        )}

        {/* 출퇴근 지도 토글 — FULL_DAY는 법적 제한으로 비활성 */}
        <div style={{ marginBottom: 20 }}>
          <label style={ls.label}>출퇴근 지도 포함</label>
          {isFullDay ? (
            <div style={{ fontSize: 13, color: "#dc2626", padding: "10px 12px", background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
              전일 8시간 근무는 법적 한도로 출퇴근 지도를 포함할 수 없습니다.
            </div>
          ) : (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "10px 12px", background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                <input
                  type="checkbox"
                  checked={commuteGuidanceIncluded}
                  onChange={e => setCommuteGuidanceIncluded(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: "#2563eb" }}
                />
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>출퇴근 지도 포함 (+60분)</span>
                  <p style={{ fontSize: 12, color: "#9ca3af", margin: "2px 0 0" }}>출근 30분 + 퇴근 30분 · 기본값: 포함</p>
                </div>
              </label>
              {(workType === "AM" || workType === "PM") && (
                <div style={{ marginTop: 8, padding: "8px 12px", background: "#f0f9ff", borderRadius: 8, border: "1px solid #bae6fd", fontSize: 12, color: "#0369a1" }}>
                  휴게시간 지도(30분)는 4시간 근무 시 항상 포함됩니다.
                </div>
              )}
            </>
          )}
        </div>

        {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={ls.cancelBtn}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{ ...ls.saveBtn, opacity: saving ? 0.7 : 1 }}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ls: Record<string, React.CSSProperties> = {
  label: { fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 8, letterSpacing: "0.2px" },
  typeBtn: { padding: "10px 8px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 12, color: "#374151", textAlign: "center" },
  typeBtnActive: { border: "1.5px solid #2563eb", background: "#eff6ff", color: "#1d4ed8", fontWeight: 700 },
  timeInput: { flex: 1, height: 40, border: "1px solid #e5e7eb", borderRadius: 8, padding: "0 10px", fontSize: 14 },
  cancelBtn: { padding: "9px 18px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 14, color: "#374151" },
  saveBtn: { padding: "9px 24px", border: "none", borderRadius: 8, background: "#2563eb", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#fff" },
};

export default function CoachesPage() {
  const T = sharedStyles();
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);

  // 근무형태 편집 모달
  const [editTarget, setEditTarget] = useState<{ coach: Coach; assignment: Assignment } | null>(null);

  // 코치별 배정 캐시 (assignmentId → Assignment)
  const [assignmentMap, setAssignmentMap] = useState<Record<string, Assignment>>({});

  useEffect(() => {
    fetch("/api/admin/coaches")
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.data)) { setCoaches(d.data); setTotal(d.total ?? d.data.length); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function openEdit(coach: Coach) {
    const assignmentId = coach.activeAssignment?.assignmentId;
    if (!assignmentId) return alert("배정된 현장이 없습니다.");

    // 캐시에 없으면 API에서 조회
    if (!assignmentMap[assignmentId]) {
      try {
        const res = await fetch(`/api/admin/assignments?userId=${coach.id}`);
        const data = await res.json();
        if (data.success && data.items?.length > 0) {
          const item = data.items.find((i: any) => i.id === assignmentId) ?? data.items[0];
          const asgn: Assignment = {
            id: item.id,
            workType: (item.workType as WorkType) ?? "FULL_DAY",
            commuteGuidanceIncluded: item.commuteGuidanceIncluded ?? true,
            customWorkStart: item.customWorkStart ?? null,
            customWorkEnd: item.customWorkEnd ?? null,
            startDate: item.startDate ?? null,
            endDate: item.endDate ?? null,
          };
          setAssignmentMap(prev => ({ ...prev, [assignmentId]: asgn }));
          setEditTarget({ coach, assignment: asgn });
        }
      } catch {
        alert("배정 정보 조회에 실패했습니다.");
      }
    } else {
      setEditTarget({ coach, assignment: assignmentMap[assignmentId] });
    }
  }

  const filtered = coaches.filter(c =>
    c.userName.includes(search) ||
    c.phoneNumber.includes(search) ||
    c.activeAssignment?.siteName.includes(search) ||
    c.loginId.includes(search)
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={T.pageTitle}>직무지도원 관리</h1>
          <p style={T.pageSub}>총 {total}명 · 행 클릭 시 근무형태 설정</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="이름 / 전화번호 / 현장명 / 아이디 검색" style={T.input} />
      </div>

      <div style={T.tableWrap}>
        <table style={T.table}>
          <thead>
            <tr>
              {["이름", "전화번호", "아이디", "현장", "기관", "근무형태", "배정일", "플랜", "상태"].map(h => (
                <th key={h} style={T.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={T.tdCenter}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} style={T.tdCenter}>직무지도원이 없습니다.</td></tr>
            ) : filtered.map(c => {
              const status = STATUS[c.status] || { label: c.status, color: "#6b7280", bg: "#f9fafb" };
              const plan = PLAN[c.planType] || { label: c.planType, color: "#6b7280", bg: "#f9fafb" };
              const assignmentId = c.activeAssignment?.assignmentId;
              const cachedAsgn = assignmentId ? assignmentMap[assignmentId] : null;
              const workTypeLabel = cachedAsgn ? WORK_TYPE_LABELS[cachedAsgn.workType] : (c.activeAssignment ? "미설정" : "-");
              return (
                <tr
                  key={c.id}
                  style={{ ...T.tr, cursor: c.activeAssignment ? "pointer" : "default" }}
                  onClick={() => c.activeAssignment && openEdit(c)}
                >
                  <td style={T.td}><strong style={{ color: "#111827" }}>{c.userName}</strong></td>
                  <td style={{ ...T.td, color: "#6b7280" }}>{c.phoneNumber}</td>
                  <td style={{ ...T.td, color: "#9ca3af", fontSize: 12 }}>{c.loginId}</td>
                  <td style={T.td}>
                    {c.activeAssignment?.siteName
                      ? <span style={{ color: "#374151" }}>{c.activeAssignment.siteName}</span>
                      : <span style={{ color: "#d1d5db", fontStyle: "italic" }}>미배정</span>}
                  </td>
                  <td style={{ ...T.td, color: "#6b7280" }}>{c.activeAssignment?.agencyName || "-"}</td>
                  <td style={T.td}>
                    {c.activeAssignment ? (
                      <span style={{ fontSize: 12, color: cachedAsgn ? "#1d4ed8" : "#9ca3af", fontWeight: cachedAsgn ? 600 : 400 }}>
                        {workTypeLabel}
                      </span>
                    ) : <span style={{ color: "#d1d5db" }}>-</span>}
                  </td>
                  <td style={{ ...T.td, color: "#9ca3af", fontSize: 12 }}>{c.activeAssignment?.startDate?.slice(0, 10) || "-"}</td>
                  <td style={T.td}>
                    <span style={{ ...T.badge, background: plan.bg, color: plan.color }}>{plan.label}</span>
                  </td>
                  <td style={T.td}>
                    <span style={{ ...T.badge, background: status.bg, color: status.color }}>{status.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editTarget && (
        <WorkScheduleModal
          coach={editTarget.coach}
          assignmentId={editTarget.assignment.id}
          initial={editTarget.assignment}
          onClose={() => setEditTarget(null)}
          onSaved={updated => {
            setAssignmentMap(prev => ({ ...prev, [updated.id]: updated }));
          }}
        />
      )}
    </div>
  );
}
