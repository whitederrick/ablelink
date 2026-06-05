// app/worker/home/page.tsx
import { redirect } from "next/navigation";
import { getWorkerSession } from "../_lib/session";
import HomeClient from "./HomeClient";
import { buildHomeSummary, type HomeSummary } from "@/lib/worker/homeSummary";

export const dynamic = "force-dynamic";

export default async function WorkerHomePage() {
  const session = await getWorkerSession();
  if (!session) redirect("/worker/login");
  if (session.isTemporary) redirect("/worker/onboarding");

  // 서버에서 홈 데이터 프리페치 → 클라이언트 워터폴 제거(첫 페인트에 데이터 포함)
  let initialData: HomeSummary | null = null;
  try {
    initialData = await buildHomeSummary(BigInt(session.workerId));
  } catch {
    initialData = null; // 실패 시 클라이언트가 폴백 조회
  }

  return <HomeClient session={session} initialData={initialData} />;
}
