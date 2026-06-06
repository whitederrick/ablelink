// lib/worker/aiContext.ts
// AI 일지(단일·일괄) 프롬프트에 주입할 현장·수행과제·계약(근무조건) 맥락 라인 생성.
// 막연하고 밋밋한 출력 방지 — 실제 현장/과제/계약 기반으로 구체화.

type CtxAssignment = {
  startDate?: Date | null;
  endDate?: Date | null;
  workType?: string | null;
  customWorkStart?: string | null;
  customWorkEnd?: string | null;
  site?: { companyName?: string | null; neededActivities?: string[] | null } | null;
} | null;

const WT_LABEL: Record<string, string> = { AM: "오전", PM: "오후", FULL_DAY: "종일", CUSTOM: "직접설정" };
const WT_TIME: Record<string, string> = { AM: "09:00~13:00", PM: "13:00~17:00", FULL_DAY: "09:00~18:00" };

export function buildContextLines(a: CtxAssignment, recentTasks: { taskName: string }[]): string[] {
  const lines: string[] = [];
  if (a?.site?.companyName) lines.push(`현장: ${a.site.companyName}`);
  if (a?.site?.neededActivities?.length) lines.push(`현장 주요 활동: ${a.site.neededActivities.join(", ")}`);
  if (recentTasks.length) lines.push(`자주 수행한 과제: ${recentTasks.map(t => t.taskName).join(", ")}`);
  if (a?.workType) {
    const t = (a.customWorkStart && a.customWorkEnd) ? `${a.customWorkStart}~${a.customWorkEnd}` : (WT_TIME[a.workType] ?? "");
    lines.push(`근무형태(계약): ${WT_LABEL[a.workType] ?? a.workType}${t ? ` ${t}` : ""}`);
  }
  if (a?.startDate) {
    const s = new Date(a.startDate).toISOString().slice(0, 10);
    const e = a.endDate ? new Date(a.endDate).toISOString().slice(0, 10) : "진행중";
    lines.push(`계약기간: ${s}~${e}`);
  }
  return lines;
}
