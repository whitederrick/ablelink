// app/worker/home/page.tsx
import { redirect } from "next/navigation";
import { getWorkerSession } from "../_lib/session";
import HomeClient from "./HomeClient";

export default async function WorkerHomePage() {
  const session = await getWorkerSession();
  if (!session) redirect("/worker/login");
  if (session.isTemporary) redirect("/worker/onboarding");
  return <HomeClient session={session} />;
}
