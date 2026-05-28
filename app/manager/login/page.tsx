// app/admin/login/page.tsx
// This is the server component for the admin login page.
// It uses React's Suspense to load the client component for the login form.

import { Suspense } from "react";
import LoginClient from "./LoginClient";

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading...</div>}>
      <LoginClient />
    </Suspense>
  );
}