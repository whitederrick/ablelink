// app/api/site/update/route.ts
// 직무지도 현장 수정 API 엔드포인트

export const runtime = "nodejs";

import { assertValidGps } from "../_utils";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ✅ (추가) 요청자 역할 해석
// - 최종적으로는 인증/세션에서 role을 판별해야 안전함
// - 현재는 테스트/운영 호환을 위해 header 또는 body에서 읽음
// - 값이 없으면 기존 앱 호환을 위해 COACH 간주(주소/사업체명 잠금 유지)
function resolveActorRole(request: Request, body: any) {
  const headerRole =
    request.headers.get("x-actor-role") ||
    request.headers.get("X-Actor-Role") ||
    request.headers.get("x-actorrole") ||
    request.headers.get("X-ActorRole");

  const roleRaw = (headerRole || body?.actorRole || body?.actorType || "COACH")
    .toString()
    .trim()
    .toUpperCase();

  // 허용 값 정규화
  if (
    roleRaw === "WORKER" ||
    roleRaw === "COACH" ||
    roleRaw === "AGENCY" ||
    roleRaw === "GOV" ||
    roleRaw === "ADMIN"
  ) {
    return roleRaw;
  }

  // 알 수 없는 값은 보수적으로 COACH 처리(잠금 유지)
  return "COACH";
}

// ✅ (추가) 날짜 비교 유틸 (입력 string/Date/undefined/null 모두 처리)
function toTimeOrNull(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // ✅ payload 패턴 확인용(민감정보 제외): 어떤 키가 들어오는지 + 타입만 기록
    try {
      const keys = Object.keys(body || {}).sort();
      console.info("[SITE_UPDATE_PAYLOAD_KEYS]", {
        actorRole: (body?.actorRole || body?.actorType || request.headers.get("x-actor-role") || "N/A"),
        keys,
        types: {
          noPreTraining: typeof body?.noPreTraining,
          noFieldTraining: typeof body?.noFieldTraining,
          preTrainingStart: typeof body?.preTrainingStart,
          preTrainingEnd: typeof body?.preTrainingEnd,
          fieldTrainingStart: typeof body?.fieldTrainingStart,
          fieldTrainingEnd: typeof body?.fieldTrainingEnd,
          trainees: Array.isArray(body?.trainees) ? "array" : typeof body?.trainees,
        },
        traineesLen: Array.isArray(body?.trainees) ? body.trainees.length : null,
        emptyStrings: {
          preTrainingStart: body?.preTrainingStart === "",
          preTrainingEnd: body?.preTrainingEnd === "",
          fieldTrainingStart: body?.fieldTrainingStart === "",
          fieldTrainingEnd: body?.fieldTrainingEnd === "",
          workType: body?.workType === "",
        },
      });
    } catch (e) {
      console.warn("[SITE_UPDATE_PAYLOAD_KEYS_LOG_FAIL]", e);
    }


    const actorRole = resolveActorRole(request, body);
    const isCoach = actorRole === "COACH" || actorRole === "WORKER";

    const {
      siteId,
      userId, // 현재는 사용하지 않지만, 추후 권한 체크에 활용 가능
      companyName,
      address,
      detailAddress,
      gpsLat,
      gpsLon,
      agencyName,
      managerName,
      managerEmail,
      managerPhone,
      noPreTraining,
      noFieldTraining,
      preTrainingStart,
      preTrainingEnd,
      fieldTrainingStart,
      fieldTrainingEnd,
      trainees,
    } = body;

    // 1) 필수값 검증
    if (!siteId) {
      return NextResponse.json(
        { success: false, message: "siteId가 누락되었습니다." },
        { status: 400 }
      );
    }
    if (!companyName || !address || !managerName || !managerEmail) {
      return NextResponse.json(
        {
          success: false,
          message:
            "필수 항목(companyName, address, managerName, managerEmail)이 누락되었습니다.",
        },
        { status: 400 }
      );
    }
    if (
      gpsLat === undefined ||
      gpsLon === undefined ||
      gpsLat === null ||
      gpsLon === null
    ) {
      return NextResponse.json(
        { success: false, message: "좌표(gpsLat, gpsLon)가 누락되었습니다." },
        { status: 400 }
      );
    }

    const latNum = Number(gpsLat);
    const lonNum = Number(gpsLon);
    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
      return NextResponse.json(
        { success: false, message: "좌표(gpsLat, gpsLon)가 숫자가 아닙니다." },
        { status: 400 }
      );
    }

    // ✅ 0값 금지 + 범위 검증 추가 (기존 로직 유지, 검증만 보강)
    if (latNum === 0 || lonNum === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "좌표(gpsLat, gpsLon)가 0으로 설정되었습니다. 올바른 위치를 다시 선택해주세요.",
        },
        { status: 400 }
      );
    }
    if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      return NextResponse.json(
        { success: false, message: "좌표(gpsLat, gpsLon) 범위가 올바르지 않습니다." },
        { status: 400 }
      );
    }

    // ✅ Decimal 변환 + 최종 방어 (null/NaN/범위)
    const { gpsLat: gpsLatDec, gpsLon: gpsLonDec } = assertValidGps(
      latNum,
      lonNum
    );

    const siteIdBig = BigInt(siteId);

    const updatedSite = await prisma.$transaction(async (tx) => {
      // 2) 기존 site 확인
      const existingSite = await tx.site.findUnique({
        where: { id: siteIdBig },
        include: {
          agency: true,
          agencyManager: true,
          // ✅ (추가) 훈련생 등록 여부 판단용 (DB 변경 없음, 조회만 확장)
          trainees: { select: { id: true } },
        },
      });

      if (!existingSite) {
        throw new Error("존재하지 않는 현장(siteId)입니다.");
      }

      // ✅ (기존 계산 유지) 변경 여부 감지 (주소/사업체명/상세주소/좌표)
      const attemptedCompanyChanged =
        companyName !== undefined && companyName !== existingSite.companyName;
      const attemptedAddressChanged =
        address !== undefined && address !== existingSite.address;
      const attemptedDetailAddressChanged =
        detailAddress !== undefined &&
        (detailAddress ?? null) !== (existingSite.detailAddress ?? null);

      const prevLatStr =
        existingSite.gpsLat?.toString?.() ?? String(existingSite.gpsLat);
      const prevLonStr =
        existingSite.gpsLon?.toString?.() ?? String(existingSite.gpsLon);
      const nextLatStr = gpsLatDec.toString();
      const nextLonStr = gpsLonDec.toString();
      const attemptedGpsChanged =
        prevLatStr !== nextLatStr || prevLonStr !== nextLonStr;

      // ✅ (유지) 잠금은 COACH/WORKER에게만 적용 (1번/2번 + 좌표)
      if (
        isCoach &&
        (attemptedCompanyChanged ||
          attemptedAddressChanged ||
          attemptedDetailAddressChanged ||
          attemptedGpsChanged)
      ) {
        console.warn("[SITE_UPDATE_BLOCKED_FIELDS_COACH_OR_WORKER_ONLY]", {
          siteId: String(siteIdBig),
          userId: userId ? String(userId) : null,
          actorRole,
          blocked: {
            companyName: attemptedCompanyChanged,
            address: attemptedAddressChanged,
            detailAddress: attemptedDetailAddressChanged,
            gpsLat: attemptedGpsChanged,
            gpsLon: attemptedGpsChanged,
          },
        });
      }

      // =========================================================
      // ✅ Step 2 (A안): COACH/WORKER의 3/4/5 수정 범위를 “미등록”으로 제한
      // - DB 변경 없이, existingSite의 현재 값으로 등록 여부를 판정
      // - 등록되어 있으면: COACH의 변경 시도는 "기존값 유지"로 무력화
      // =========================================================

      // 3) 훈련기간(등록 여부)
      const trainingRegistered =
        existingSite.noPreTraining === true ||
        existingSite.noFieldTraining === true ||
        existingSite.preTrainingStart != null ||
        existingSite.preTrainingEnd != null ||
        existingSite.fieldTrainingStart != null ||
        existingSite.fieldTrainingEnd != null;

      // 5) 훈련생(등록 여부)
      const traineesRegistered =
        Array.isArray(existingSite.trainees) && existingSite.trainees.length > 0;

      // 다음 값(정규화) 계산: "변경 시도" 여부를 판단하기 위함
      const nextNoPre = noPreTraining === true || noPreTraining === "true";
      const nextNoField = noFieldTraining === true || noFieldTraining === "true";

      const nextPreStartT = nextNoPre ? null : toTimeOrNull(preTrainingStart);
      const nextPreEndT = nextNoPre ? null : toTimeOrNull(preTrainingEnd);
      const nextFieldStartT = nextNoField ? null : toTimeOrNull(fieldTrainingStart);
      const nextFieldEndT = nextNoField ? null : toTimeOrNull(fieldTrainingEnd);

      const prevNoPre = Boolean(existingSite.noPreTraining);
      const prevNoField = Boolean(existingSite.noFieldTraining);

      const prevPreStartT = toTimeOrNull(existingSite.preTrainingStart);
      const prevPreEndT = toTimeOrNull(existingSite.preTrainingEnd);
      const prevFieldStartT = toTimeOrNull(existingSite.fieldTrainingStart);
      const prevFieldEndT = toTimeOrNull(existingSite.fieldTrainingEnd);

      const trainingChanged =
        prevNoPre !== nextNoPre ||
        prevNoField !== nextNoField ||
        prevPreStartT !== nextPreStartT ||
        prevPreEndT !== nextPreEndT ||
        prevFieldStartT !== nextFieldStartT ||
        prevFieldEndT !== nextFieldEndT;

      // trainees는 구조상 deleteMany+create이므로,
      // COACH가 등록된 훈련생을 "실수로" 재생성(삭제 후 재생성)하는 것을 원천 차단하기 위해
      // 등록된 상태에서는 아예 trainees 업데이트를 건드리지 않도록 함(무력화).
      const coachShouldFreezeTraining = isCoach && trainingRegistered && trainingChanged;
      const coachShouldFreezeTrainees = isCoach && traineesRegistered;

      if (
        isCoach &&
        ((trainingRegistered && trainingChanged) ||
          traineesRegistered)
      ) {
        // 변경 시도(또는 훈련생 등록됨) 로그
        console.warn("[SITE_UPDATE_COACH_SECTION_LIMITS]", {
          siteId: String(siteIdBig),
          userId: userId ? String(userId) : null,
          actorRole,
          registered: {
            training: trainingRegistered,
            trainees: traineesRegistered,
          },
          attemptedChange: {
            training: trainingChanged,
            trainees: Array.isArray(trainees) ? true : false,
          },
          action: "FREEZE_TO_EXISTING_WHEN_REGISTERED",
        });
      }

      // 3) Agency upsert
      const agency = await tx.agency.upsert({
        where: { name: agencyName || "미지정 기관" },
        update: {},
        create: { name: agencyName || "미지정 기관" },
      });

      // 4) AgencyManager: 기존 managerId가 있으면 update, 없으면 create
      let managerId = existingSite.managerId;

      if (managerId) {
        await tx.agencyManager.update({
          where: { id: managerId },
          data: {
            agencyId: agency.id,
            name: managerName,
            email: managerEmail,
            phoneNumber: managerPhone,
          },
        });
      } else {
        const newManager = await tx.agencyManager.create({
          data: {
            agencyId: agency.id,
            name: managerName,
            email: managerEmail,
            phoneNumber: managerPhone,
          },
        });
        managerId = newManager.id;
      }

      const noPre = nextNoPre;
      const noField = nextNoField;

      // 5) Site 업데이트 + ✅ trainees 관계 기준 전체 교체
      const updated = await tx.site.update({
        where: { id: siteIdBig },
        data: {
          // ✅ (유지) COACH/WORKER만 잠금, 그 외 역할은 요청값 반영
          companyName: isCoach ? existingSite.companyName : companyName,
          address: isCoach ? existingSite.address : address,
          detailAddress: isCoach
            ? existingSite.detailAddress ?? null
            : detailAddress ?? null,

          // ✅ (유지) COACH/WORKER만 좌표 잠금, 그 외 역할은 요청값 반영(Decimal)
          // - COACH의 좌표 변경은 basepoint/propose 승인 로직에서만 반영되어야 함
          gpsLat: isCoach ? existingSite.gpsLat : gpsLatDec,
          gpsLon: isCoach ? existingSite.gpsLon : gpsLonDec,

          agencyId: agency.id,
          managerId: managerId,

          // ✅ Step 2 적용: 3) 훈련기간은 "등록되어 있으면 COACH 변경 무력화"
          noPreTraining: coachShouldFreezeTraining
            ? existingSite.noPreTraining
            : noPre,
          noFieldTraining: coachShouldFreezeTraining
            ? existingSite.noFieldTraining
            : noField,

          preTrainingStart: coachShouldFreezeTraining
            ? existingSite.preTrainingStart
            : noPre
            ? null
            : preTrainingStart
            ? new Date(preTrainingStart)
            : null,
          preTrainingEnd: coachShouldFreezeTraining
            ? existingSite.preTrainingEnd
            : noPre
            ? null
            : preTrainingEnd
            ? new Date(preTrainingEnd)
            : null,
          fieldTrainingStart: coachShouldFreezeTraining
            ? existingSite.fieldTrainingStart
            : noField
            ? null
            : fieldTrainingStart
            ? new Date(fieldTrainingStart)
            : null,
          fieldTrainingEnd: coachShouldFreezeTraining
            ? existingSite.fieldTrainingEnd
            : noField
            ? null
            : fieldTrainingEnd
            ? new Date(fieldTrainingEnd)
            : null,

          // ✅ 기준점 메타 갱신 로직 유지
          // - COACH는 좌표가 여기서 바뀌지 않으므로 updatedAt 유지
          // - AGENCY/GOV/ADMIN이 좌표를 변경하면 updatedAt 갱신
          basePointConfirmed:
            body.basePointConfirmed ?? existingSite.basePointConfirmed,
          basePointSource: body.basePointSource ?? existingSite.basePointSource,
          basePointAccuracyM:
            body.basePointAccuracyM ?? existingSite.basePointAccuracyM,
          basePointUpdatedAt: isCoach
            ? existingSite.basePointUpdatedAt
            : attemptedGpsChanged
            ? new Date()
            : existingSite.basePointUpdatedAt,
          basePointMemo: body.basePointMemo ?? existingSite.basePointMemo,

          // ✅ Step 2 적용: 5) 훈련생은 "등록되어 있으면 COACH가 절대 건드리지 않음"
          // - 등록(미등록 상태)일 때만 COACH가 입력 가능
          // - 등록된 상태에서 COACH 요청이 와도 trainees 업데이트 자체를 생략(무력화)
          trainees: coachShouldFreezeTrainees
            ? undefined
            : {
                deleteMany: {},
                create: Array.isArray(trainees)
                  ? trainees.map((t: any) => ({
                      name: t.name,
                      gender:
                        t.gender === "남"
                          ? "M"
                          : t.gender === "여"
                          ? "F"
                          : t.gender, // ✅ 이미 'M'/'F'로 오면 그대로 저장
                      birthDate: t.birthDate, // YYYYMMDD
                      phoneNumber: t.phoneNumber,
                      guardianPhoneNumber: t.guardianPhoneNumber ?? null,
                      disabilityType: t.disabilityType || "미지정",
                      severity: t.severity || "중증",
                      status: t.status || "TRAINING",
                    }))
                  : [],
              },
        },
      });

      return updated;
    });

    return NextResponse.json({
      success: true,
      message: "현장 정보가 수정되었습니다.",
      siteId: updatedSite.id.toString(),
    });
  } catch (error: any) {
    console.error("현장 수정 실패 상세:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "서버 에러" },
      { status: 500 }
    );
  }
}
