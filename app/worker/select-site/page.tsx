import { redirect } from "next/navigation";
import { getWorkerSession } from "../_lib/session";
import { getTodayActiveAssignments } from "@/lib/worker/activeAssignments";
import SelectSiteClient from "./SelectSiteClient";

export const dynamic = "force-dynamic";

// 멀티 현장 워커의 "오늘 근무 현장" 선택 화면. 홈 게이트가 (유효 선택 없고 활성 2개+) 일 때 여기로 보낸다.
export default async function SelectSitePage() {
  const session = await getWorkerSession();
  if (!session) redirect("/worker/login");
  if (session.isTemporary) redirect("/worker/onboarding");

  const items = await getTodayActiveAssignments(BigInt(session.workerId));
  // 선택할 게 없거나 1개뿐이면 선택 불필요 → 홈으로.
  if (items.length < 2) redirect("/worker/home");

  return <SelectSiteClient items={items} />;
}
