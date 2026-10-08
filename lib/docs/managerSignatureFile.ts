// lib/docs/managerSignatureFile.ts
// 매니저 서명 이미지 파일의 삭제 안전 판정.
//
// 배경(2026-10-08 감사 P1): DocumentRun.managerSignatureUrl 은 매니저가 서명하는 순간 Manager.signatureUrl 의
//  '저장소 경로 문자열'을 그대로 복사한다(이미지 복사 아님). 그런데 매니저가 서명을 재등록/삭제할 때 옛 파일을
//  무조건 지워서, 이미 서명된 문서들이 삭제된 파일을 가리키게 됐다 → 렌더 시 서명 칸이 조용히 빈 채로
//  나가고, 발송 게이트는 URL 문자열 존재만 봐서 통과시켰다.
//  따라서 옛 파일은 어떤 문서(run)도 참조하지 않을 때만 지운다.

import { prisma } from "@/lib/prisma";

/** 이 서명 파일 URL을 참조하는 DocumentRun이 있거나 조회가 실패하면 true(= 지우지 말 것, fail-safe). */
export async function isManagerSignatureInUse(url: string): Promise<boolean> {
  try {
    const n = await prisma.documentRun.count({
      where: { OR: [{ managerSignatureUrl: url }, { agencySignatureUrl: url }] },
    });
    return n > 0;
  } catch (e) {
    console.warn("[managerSignatureFile] 참조 조회 실패 — 안전을 위해 삭제 보류:", e);
    return true;
  }
}
