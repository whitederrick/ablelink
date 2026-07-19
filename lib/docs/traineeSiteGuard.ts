// lib/docs/traineeSiteGuard.ts
// 문서(일지/평가/출근부) 생성 시 traineeId 소속 검증(IDOR 방지).
//
// 기존 검증은 "기관(agencyId) 소속"까지만 확인했다. 같은 기관의 다른 현장 훈련생 ID를
// 주입하면 이름/평가/일지가 다른 현장 문서에 섞일 여지가 있었다.
// → assignment.siteId + 문서 기간에 겹치는 TraineePlacement 기준으로 강화한다.
//   (TraineePlacement 는 출근부 1:多 집계에서도 현장+기간 재적 판정에 쓰는 단일 사실 출처)

import { prisma } from "@/lib/prisma";

/**
 * traineeId 가 해당 현장(siteId)에 문서 기간([start, end])과 겹치는
 * 재적 이력(TraineePlacement)을 가진 훈련생인지 검증한다.
 *
 * 기간 겹침: placement.startDate ≤ end AND (placement.endDate = null OR endDate ≥ start)
 * 이탈 훈련생은 endDate 로 표현되므로 과거 기간 문서 재생성 시에도 그때 재적이던 인원이 잡힌다.
 *
 * @returns 검증 통과 시 { id, name }, 미재적/타현장/조작이면 null
 */
export async function findTraineeAtSiteInPeriod(
  traineeId: bigint,
  siteId: bigint,
  start: string, // yyyy-mm-dd (KST)
  end: string,   // yyyy-mm-dd (KST)
): Promise<{ id: bigint; name: string } | null> {
  // ★심층방어(기관 스코프): 현재 불변식상 한 Site.id는 한 기관 소속이고 훈련생은 자기 기관 현장에만 귀속되므로,
  //  siteId로만 조회해도 크로스테넌트가 불가하다(호출부 siteId는 요청자 본인 배정 현장). 그럼에도 새 배정 경로가
  //  불변식을 깨더라도 타 기관 훈련생 성명(장애인 PII)이 문서에 새지 않도록, 훈련생의 소속 현장(currentSiteId) 기관이
  //  이 현장(siteId)의 기관과 일치하는 경우로 한정한다. site.agencyId가 null(귀속 없는 현장)이면 훈련생 자체가
  //  존재할 수 없어(생성 시 site.agencyId===agencyId 강제) 필터를 생략해도 동일 결과(무회귀).
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { agencyId: true } });
  const placement = await prisma.traineePlacement.findFirst({
    where: {
      traineeId,
      siteId,
      startDate: { lte: new Date(end + "T23:59:59+09:00") },
      OR: [{ endDate: null }, { endDate: { gte: new Date(start + "T00:00:00+09:00") } }],
      ...(site?.agencyId != null ? { trainee: { site: { agencyId: site.agencyId } } } : {}),
    },
    select: { trainee: { select: { id: true, name: true } } },
  });
  return placement?.trainee ?? null;
}

// 훈련생별 공식문서 종류(현장·기간 재적 훈련생 필수).
export const TRAINEE_DOC_TYPES = ["TRAINING_DAILY_LOG", "TRAINEE_FINAL_EVAL", "ADAPTATION_DAILY_LOG", "ADAPTATION_FINAL_EVAL"];

/**
 * 문서 종류에 맞춰 훈련생을 resolve(admin docs generate/preview/sign 공용 가드).
 *  · 비훈련생 문서 → { required:false, trainee:null } (검증 불요).
 *  · 훈련생 문서 → traineeId 파싱 + 현장·기간 재적 검증(findTraineeAtSiteInPeriod).
 *    미선택/비숫자/미재적이면 trainee:null → 호출측이 400 처리(응답 문구는 라우트 유지).
 */
export async function resolveDocTrainee(
  docType: string,
  traineeIdRaw: unknown,
  siteId: bigint,
  start: string,
  end: string,
): Promise<{ required: boolean; trainee: { id: bigint; name: string } | null }> {
  if (!TRAINEE_DOC_TYPES.includes(docType)) return { required: false, trainee: null };
  const tid = traineeIdRaw && /^[0-9]+$/.test(String(traineeIdRaw)) ? BigInt(String(traineeIdRaw)) : null;
  const trainee = tid ? await findTraineeAtSiteInPeriod(tid, siteId, start, end) : null;
  return { required: true, trainee };
}
