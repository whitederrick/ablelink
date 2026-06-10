// app/api/worker/passbook/route.ts
// 직무지도원 통장사본 업로드(POST, multipart) / 조회용 signed URL(GET). 본인 것만.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { uploadPassbook, resolvePassbookUrl } from "@/lib/passbookStorage";
import { checkRateLimit } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
  const worker = await prisma.worker.findUnique({
    where: { id: BigInt(session.workerId) },
    select: { passbookImageUrl: true },
  });
  const url = await resolvePassbookUrl(worker?.passbookImageUrl ?? null);
  return NextResponse.json({ success: true, url, hasFile: !!worker?.passbookImageUrl });
}

export async function POST(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

  const rl = await checkRateLimit(`passbook-upload:${session.workerId}`);
  if (!rl.allowed) return NextResponse.json({ success: false, message: "요청이 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ success: false, message: "file 필드가 필요합니다." }, { status: 400 });
  }

  const result = await uploadPassbook(session.workerId, file);
  if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: result.status });

  await prisma.worker.update({ where: { id: BigInt(session.workerId) }, data: { passbookImageUrl: result.path } });
  const url = await resolvePassbookUrl(result.path);
  return NextResponse.json({ success: true, url, message: "통장사본이 저장되었습니다." });
}
