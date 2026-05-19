// app/admin/layout.tsx
// This is the layout component for the admin panel, wrapping all admin pages with the AdminShellClient.
// It ensures consistent layout and navigation across the admin interface.

import AdminShellClient from "./shell/AdminShellClient";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShellClient>{children}</AdminShellClient>;
}
