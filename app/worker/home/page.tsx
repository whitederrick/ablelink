// app/worker/home/page.tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getWorkerSession, WK_ACTIVE_ASSIGNMENT_COOKIE } from "../_lib/session";
import HomeClient from "./HomeClient";
import { buildHomeSummary, type HomeSummary } from "@/lib/worker/homeSummary";

export const dynamic = "force-dynamic";

export default async function WorkerHomePage() {
  const session = await getWorkerSession();
  if (!session) redirect("/worker/login");
  if (session.isTemporary) redirect("/worker/onboarding");

  const cookieStore = await cookies();
  const selRaw = cookieStore.get(WK_ACTIVE_ASSIGNMENT_COOKIE)?.value;
  let selected: bigint | null = null;
  try { selected = selRaw ? BigInt(selRaw) : null; } catch { selected = null; }

  // 서버에서 홈 데이터 프리페치 → 클라이언트 워터폴 제거(첫 페인트에 데이터 포함)
  let initialData: HomeSummary | null = null;
  try {
    initialData = await buildHomeSummary(BigInt(session.workerId), selected);
  } catch {
    initialData = null; // 실패 시 클라이언트가 폴백 조회
  }

  // 멀티 현장 게이트: 오늘 활성 배정이 2개+인데 유효한 선택이 없으면 현장 선택 화면으로.
  const active = initialData?.activeAssignments ?? [];
  const selValid = selRaw != null && active.some((a) => a.assignmentId === selRaw);
  if (!selValid && active.length >= 2) redirect("/worker/select-site");

  return <HomeClient session={session} initialData={initialData} />;
}
