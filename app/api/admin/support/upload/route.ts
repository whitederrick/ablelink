// app/api/admin/support/upload/route.ts
// 운영자 문의 첨부파일 업로드 — 매니저/운영자 인증 필요. 업로드 후 메타데이터 반환.
// 클라이언트는 반환된 메타데이터를 모아 문의 POST의 attachments로 전달한다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { uploadSupportAttachment } from "@/lib/supportStorage";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);
    // 스토리지 경로 스코프: 매니저는 자기 기관, 운영자는 'admin' 폴더.
    const scopeKey = session.kind === "manager" ? String(session.agencyId) : "admin";

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ success: false, message: "file 필드가 필요합니다." }, { status: 400 });
    }
    const originalName = String(formData.get("name") || (file as any).name || "첨부파일");

    const result = await uploadSupportAttachment(scopeKey, file, originalName);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true, attachment: result.attachment });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/support/upload]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
