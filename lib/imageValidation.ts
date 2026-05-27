// lib/imageValidation.ts
// 서명 이미지 업로드 시 파일 내용 기반 MIME 타입 검증
// Content-Type 헤더는 클라이언트가 위조 가능하므로 magic bytes로 직접 확인

const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];

function detectMime(header: Uint8Array): AllowedMime | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
    return "image/jpeg";
  }
  // WebP: RIFF????WEBP
  if (
    header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
    header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export async function validateSignatureImage(blob: Blob): Promise<{ valid: boolean; mime?: AllowedMime; error?: string }> {
  if (!blob || blob.size === 0) return { valid: false, error: "서명 이미지가 없습니다." };
  if (blob.size > 500 * 1024) return { valid: false, error: "서명 이미지가 너무 큽니다. (최대 500KB)" };

  const headerBytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const mime = detectMime(headerBytes);
  if (!mime) return { valid: false, error: "지원하지 않는 이미지 형식입니다. (PNG, JPEG, WebP만 허용)" };

  return { valid: true, mime };
}
