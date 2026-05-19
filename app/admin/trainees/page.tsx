"use client";
// app/admin/trainees/page.tsx
// 훈련생 현황 (읽기 전용) — 에이전시는 현황 파악만

import { useEffect, useState } from "react";

interface TraineeSummary {
  siteId: string;
  siteName: string;
  coachName: string;
  trainees: Array<{
    id: string;
    name: string;
    gender: string;
    disabilityType: string;
    severity: string;
    status: string;
    logCount: number;
    lastLogDate: string | null;
  }>;
}

const STATUS_LABELS: Record<string, string> = {
  TRAINING: "훈련중", EMPLOYED: "취업", DROPOUT: "중도포기", GRADUATED: "수료",
};
const STATUS_COLORS: Record<string, string> = {
  TRAINING: "#5865F2", EMPLOYED: "#2e7d32", DROPOUT: "#e53935", GRADUATED: "#888",
};

export default function TraineesPage() {
  const [sites, setSites] = useState<TraineeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/admin/trainees/summary")
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.data)) {
          setSites(d.data);
          // 기본적으로 모두 펼치기
          const init: Record<string, boolean> = {};
          d.data.forEach((s: TraineeSummary) => { init[s.siteId] = true; });
          setExpanded(init);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalTrainees = sites.reduce((s, site) => s + site.trainees.length, 0);
  const trainingCount = sites.reduce((s, site) =>
    s + site.trainees.filter(t => t.status === "TRAINING").length, 0);
  const employedCount = sites.reduce((s, site) =>
    s + site.trainees.filter(t => t.status === "EMPLOYED").length, 0);

  const filteredSites = sites.filter(s =>
    s.siteName.includes(search) ||
    s.coachName.includes(search) ||
    s.trainees.some(t => t.name.includes(search))
  );

  function toggleSite(siteId: string) {
    setExpanded(prev => ({ ...prev, [siteId]: !prev[siteId] }));
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>훈련생 현황</h1>
          <p style={s.subtitle}>
            ※ 훈련생 등록/수정은 한국장애인고용공단에서 관리합니다. 에이전시는 현황만 조회할 수 있습니다.
          </p>
        </div>
      </div>

      {/* 요약 */}
      <div style={s.summaryGrid}>
        {[
          { label: "전체 훈련생", value: totalTrainees, color: "#333" },
          { label: "훈련중", value: trainingCount, color: "#5865F2" },
          { label: "취업", value: employedCount, color: "#2e7d32" },
          { label: "담당 Site", value: sites.length, color: "#888" },
        ].map((item, i) => (
          <div key={i} style={s.summaryCard}>
            <p style={{ ...s.summaryNum, color: item.color }}>{item.value}</p>
            <p style={s.summaryLabel}>{item.label}</p>
          </div>
        ))}
      </div>

      {/* 검색 */}
      <div style={s.searchRow}>
        <input
          style={s.searchInput}
          placeholder="현장명 / 직무지도원 / 훈련생 이름 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Site별 훈련생 목록 */}
      {loading ? (
        <p style={s.empty}>로딩 중...</p>
      ) : filteredSites.length === 0 ? (
        <p style={s.empty}>훈련생 정보가 없습니다.</p>
      ) : (
        <div style={s.siteList}>
          {filteredSites.map(site => (
            <div key={site.siteId} style={s.siteCard}>
              {/* Site 헤더 */}
              <button
                style={s.siteHeader}
                onClick={() => toggleSite(site.siteId)}
              >
                <div style={s.siteInfo}>
                  <span style={s.siteName}>📍 {site.siteName}</span>
                  <span style={s.coachName}>직무지도원: {site.coachName}</span>
                </div>
                <div style={s.siteRight}>
                  <span style={s.traineeCount}>{site.trainees.length}명</span>
                  <span style={s.chevron}>{expanded[site.siteId] ? "▲" : "▼"}</span>
                </div>
              </button>

              {/* 훈련생 목록 */}
              {expanded[site.siteId] && (
                <div style={s.traineeList}>
                  <div style={s.tableHeader}>
                    <span style={{ flex: 1.5 }}>이름</span>
                    <span style={{ flex: 0.5 }}>성별</span>
                    <span style={{ flex: 1.5 }}>장애유형</span>
                    <span style={{ flex: 1 }}>중증도</span>
                    <span style={{ flex: 1 }}>일지 수</span>
                    <span style={{ flex: 1.5 }}>최근 일지</span>
                    <span style={{ flex: 1, textAlign: "center" }}>상태</span>
                  </div>
                  {site.trainees.map(t => (
                    <div key={t.id} style={s.traineeRow}>
                      <span style={{ flex: 1.5, fontWeight: 600 }}>{t.name}</span>
                      <span style={{ flex: 0.5, color: "#888" }}>{t.gender === "M" ? "남" : "여"}</span>
                      <span style={{ flex: 1.5, color: "#666" }}>{t.disabilityType || "-"}</span>
                      <span style={{ flex: 1, color: "#666" }}>{t.severity || "-"}</span>
                      <span style={{ flex: 1, color: "#5865F2", fontWeight: 600 }}>{t.logCount}건</span>
                      <span style={{ flex: 1.5, color: "#888", fontSize: 13 }}>
                        {t.lastLogDate || "-"}
                      </span>
                      <span style={{ flex: 1, textAlign: "center" }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700,
                          color: STATUS_COLORS[t.status] || "#888",
                          backgroundColor: (STATUS_COLORS[t.status] || "#888") + "18",
                          padding: "3px 8px", borderRadius: 20,
                        }}>
                          {STATUS_LABELS[t.status] || t.status}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: 24 },
  header: { marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 800, color: "#111", margin: "0 0 4px" },
  subtitle: { fontSize: 13, color: "#888", margin: 0 },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 },
  summaryCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, textAlign: "center", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  summaryNum: { fontSize: 28, fontWeight: 800, margin: "0 0 4px" },
  summaryLabel: { fontSize: 13, color: "#888", margin: 0 },
  searchRow: { marginBottom: 16 },
  searchInput: { width: "100%", maxWidth: 400, height: 40, border: "1px solid #ddd", borderRadius: 8, padding: "0 14px", fontSize: 14, outline: "none" },
  siteList: { display: "flex", flexDirection: "column", gap: 12 },
  siteCard: { backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  siteHeader: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", border: "none", backgroundColor: "#f8f9ff", cursor: "pointer", textAlign: "left" as const },
  siteInfo: { display: "flex", flexDirection: "column", gap: 2 },
  siteName: { fontSize: 15, fontWeight: 700, color: "#333" },
  coachName: { fontSize: 13, color: "#888" },
  siteRight: { display: "flex", alignItems: "center", gap: 12 },
  traineeCount: { fontSize: 14, fontWeight: 700, color: "#5865F2" },
  chevron: { color: "#888", fontSize: 12 },
  traineeList: { padding: "0 20px 12px" },
  tableHeader: { display: "flex", padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#888", borderBottom: "1px solid #eee", marginBottom: 4 },
  traineeRow: { display: "flex", alignItems: "center", padding: "10px 12px", fontSize: 14, color: "#333", borderBottom: "1px solid #f5f5f5" },
  empty: { textAlign: "center", color: "#aaa", padding: "40px 0" },
};
