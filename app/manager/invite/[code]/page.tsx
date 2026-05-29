import { Suspense } from "react";
import InviteClient from "./InviteClient";

type Props = { params: Promise<{ code: string }> };

export default async function InvitePage({ params }: Props) {
  const { code } = await params;
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading...</div>}>
      <InviteClient code={code} />
    </Suspense>
  );
}
