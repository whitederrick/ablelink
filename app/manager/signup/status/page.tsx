import { Suspense } from "react";
import StatusClient from "./StatusClient";

export default function StatusPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading...</div>}>
      <StatusClient />
    </Suspense>
  );
}
