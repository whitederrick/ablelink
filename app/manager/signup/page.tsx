import { Suspense } from "react";
import SignupClient from "./SignupClient";

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading...</div>}>
      <SignupClient />
    </Suspense>
  );
}
