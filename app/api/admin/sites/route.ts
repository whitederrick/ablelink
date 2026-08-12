// app/api/admin/sites/route.ts
// 관리자 사이트 목록 조회/검색/페이지네이션 및 등록 API
// (schema.prisma: Site는 agencyId/managerId relation 기반)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAdminOrManagerSession, resolveScopeAgencyId } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";
import { checkQuota } from "@/lib/planGuard";
import { audit } from "@/lib/audit";

const PROFESSIONS = ["JOB_COACH", "CAREGIVER", "ACTIVITY_ASSISTANT"] as const;

function parseIntSafe(v: string | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

function toRow(r: any) {
  return {
    id: String(r.id),
    companyName: r.companyName,
    address: r.address,
    detailAddress: r.detailAddress ?? null,
    gpsLat: r.gpsLat?.toString?.() ?? String(r.gpsLat),
    gpsLon: r.gpsLon?.toString?.() ?? String(r.gpsLon),

    agencyId: r.agencyId != null ? String(r.agencyId) : null,
    agencyName: r.agency?.name ?? null,

    // ✅ 담당 관리자(Manager 로그인). null = 미지정(공용)
    ownerManagerId: r.ownerManagerId != null ? String(r.ownerManagerId) : null,
    ownerManagerName: r.ownerManager?.displayName ?? r.ownerManager?.loginId ?? null,

    // ✅ 사업체 담당자(현장 연락 담당자)
    businessContactName: r.businessContactName ?? null,
    businessContactPhone: r.businessContactPhone ?? null,
    businessContactEmail: r.businessContactEmail ?? null,

    requiredProfession: r.requiredProfession ?? null,

    amCapacity: r.amCapacity ?? 0,
    pmCapacity: r.pmCapacity ?? 0,
    fullDayCapacity: r.fullDayCapacity ?? 0,
    customCapacity: r.customCapacity ?? 0,

    basePointConfirmed: r.basePointConfirmed,
    basePointAuthority: r.basePointAuthority,
    basePointApprovalStatus: r.basePointApprovalStatus,
    basePointUpdatedAt: r.basePointUpdatedAt ? r.basePointUpdatedAt.toISOString() : null,

    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const { searchParams } = new URL(req.url);

    const q = (searchParams.get("q") || "").trim();
    const page = parseIntSafe(searchParams.get("page"), 1);
    const pageSize = Math.min(parseIntSafe(searchParams.get("pageSize"), 20), 100);

    // isActive: 미지정→활성만(기존 동작 유지), "all"→전체, "true/false"→해당 상태만
    const isActiveParam = searchParams.get("isActive");
    const isActive: boolean | undefined =
      isActiveParam === "all" ? undefined
      : isActiveParam == null ? true
      : isActiveParam === "true" || isActiveParam === "1";

    // manager: 본인 agency 강제 / admin(운영자): ?agencyId 선택(없으면 전체)
    let agencyId: bigint | undefined;
    if (session.kind === "manager") agencyId = session.agencyId;
    else {
      const a = searchParams.get("agencyId");
      agencyId = a ? (parseBigInt(a) ?? undefined) : undefined;
    }

    const and: Prisma.SiteWhereInput[] = [];
    if (typeof isActive === "boolean") and.push({ isActive });
    if (agencyId) and.push({ agencyId });
    // 미배정(활성 배정 0) 필터 — 대시보드 '직무지도원 미배정 Site' 전체 보기. assignedCount(ASSIGNED/CONFIRMED/ACTIVE)와 동일 기준.
    if (searchParams.get("unassigned") === "1") {
      and.push({ assignments: { none: { status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } } } });
    }

    // ✅ 같은 위탁기관 관리자는 기관의 모든 현장을 공유한다(agency 단위 스코프).
    //    ownerManagerId는 가시성 게이트가 아니라 '담당자 표시'용으로만 사용. (운영자(admin)는 전체)

    if (q) {
      and.push({
        OR: [
          { companyName: { contains: q, mode: "insensitive" } },
          { address: { contains: q, mode: "insensitive" } },
          { businessContactName: { contains: q, mode: "insensitive" } },
          { businessContactPhone: { contains: q, mode: "insensitive" } },
          { ownerManager: { is: { displayName: { contains: q, mode: "insensitive" } } } },
          { ownerManager: { is: { loginId: { contains: q, mode: "insensitive" } } } },
          { agency: { is: { name: { contains: q, mode: "insensitive" } } } },
        ],
      });
    }

    const where: Prisma.SiteWhereInput = and.length ? { AND: and } : {};

    const [total, rows] = await Promise.all([
      prisma.site.count({ where }),
      prisma.site.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          companyName: true,
          address: true,
          detailAddress: true,
          gpsLat: true,
          gpsLon: true,

          agencyId: true,
          ownerManagerId: true,
          businessContactName: true,
          businessContactPhone: true,
          businessContactEmail: true,
          requiredProfession: true,

          agency: { select: { id: true, name: true } },
          ownerManager: { select: { id: true, displayName: true, loginId: true } },

          amCapacity: true,
          pmCapacity: true,
          fullDayCapacity: true,
          customCapacity: true,

          basePointConfirmed: true,
          basePointAuthority: true,
          basePointApprovalStatus: true,
          basePointUpdatedAt: true,

          isActive: true,
          createdAt: true,
        },
      }),
    ]);

    // 각 현장의 현재 배정 중(ASSIGNED/CONFIRMED/ACTIVE) 인원 수 — 배정 요청 화면의 [미배정/배정중] 필터용
    const siteIds = rows.map((r) => r.id);
    const grouped = siteIds.length
      ? await prisma.siteAssignment.groupBy({
          by: ["siteId"],
          where: { siteId: { in: siteIds }, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
          _count: { _all: true },
        })
      : [];
    const countMap = new Map(grouped.map((g) => [String(g.siteId), g._count._all]));

    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total,
      items: rows.map((r) => ({ ...toRow(r), assignedCount: countMap.get(String(r.id)) ?? 0 })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    const st = errToStatus(msg);
    return NextResponse.json({ success: false, message: st === 500 ? "서버 오류" : msg }, { status: st });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);

    const body = await req.json();

    const companyName = String(body.companyName || "").trim();
    const address = String(body.address || "").trim();
    const detailAddress = body.detailAddress == null ? null : String(body.detailAddress).trim();

    const gpsLatRaw = body.gpsLat;
    const gpsLonRaw = body.gpsLon;

    // 직종(카테고리) — 선택
    const requiredProfession = PROFESSIONS.includes(body.requiredProfession) ? body.requiredProfession : null;

    // 근무형태별 필요 정원(0~99)
    const parseCap = (v: any) => Math.max(0, Math.min(99, Math.floor(Number(v)) || 0));
    const amCapacity = parseCap(body.amCapacity);
    const pmCapacity = parseCap(body.pmCapacity);
    const fullDayCapacity = parseCap(body.fullDayCapacity);
    const customCapacity = parseCap(body.customCapacity);

    // ✅ 사업체 담당자(현장 연락 담당자) — 이름·연락처 필수, 이메일 선택
    const businessContactName = String(body.businessContactName ?? "").trim();
    const businessContactPhone = String(body.businessContactPhone ?? "").trim();
    const businessContactEmail = String(body.businessContactEmail ?? "").trim() || null;

    // ✅ 추가 사업체 담당자(SiteContact[]) — 대표 외 추가 연락 담당자. 이름 있는 항목만 저장.
    const additionalContacts = Array.isArray(body.additionalContacts)
      ? body.additionalContacts
          .map((c: any) => ({
            name: String(c?.name ?? "").trim(),
            phoneNumber: String(c?.phone ?? c?.phoneNumber ?? "").trim() || null,
            email: String(c?.email ?? "").trim() || null,
            role: String(c?.role ?? "").trim() || null,
          }))
          .filter((c: { name: string }) => c.name)
      : [];

    if (!companyName) throw new Error("VALIDATION:companyName");
    if (!address) throw new Error("VALIDATION:address");
    if (!businessContactName) throw new Error("VALIDATION:businessContactName");
    if (!businessContactPhone) throw new Error("VALIDATION:businessContactPhone");

    const latStr = String(gpsLatRaw ?? "").trim();
    const lonStr = String(gpsLonRaw ?? "").trim();
    if (!latStr || !lonStr) throw new Error("VALIDATION:gpsLatLon");

    // GPS 허용 범위(선택) — 미지정 시 스키마 기본값
    const allowanceRange = body.allowanceRange == null ? undefined : Number(body.allowanceRange);
    if (allowanceRange !== undefined && (isNaN(allowanceRange) || allowanceRange < 50 || allowanceRange > 1000)) {
      throw new Error("VALIDATION:allowanceRange (50~1000m)");
    }

    // 지각 인정 기준(분, 선택). null/빈값 = 위탁기관 기본값 상속.
    const lateThresholdMin = body.lateThresholdMin == null || body.lateThresholdMin === "" ? null : Number(body.lateThresholdMin);
    if (lateThresholdMin !== null && (!Number.isInteger(lateThresholdMin) || lateThresholdMin < 0 || lateThresholdMin > 180)) {
      throw new Error("VALIDATION:lateThresholdMin (0~180)");
    }

    // manager: 본인 agency / admin(운영자): body.agencyId 지정 필수
    const agencyId = resolveScopeAgencyId(session, body.agencyId);

    // ─────────────────────────────────────────────────────────────────────────
    // ★[PILOT] 파일럿 전용 입력 — 회차 종료 시 **이 블록 + create 데이터의 `[PILOT]` 스프레드 1줄**
    //  을 지우면 원복된다. 기존 생성 로직·정원 검사는 무변경.
    //  ★비파일럿 비용 0 — `body.pilotSessionId`가 없으면 조회 없이 통과한다.
    // ─────────────────────────────────────────────────────────────────────────
    // ★파일럿 회차에서 만든 현장이면 생성 출처를 남긴다(폐기 시 "이 회차가 만든 것"만 지우기 위해).
    //  운영자 전용이며, 회차 기관과 일치하고 셋업 가능한 상태여야 한다 — 아니면 귀속이 어긋난다.
    let createdByPilotSessionId: bigint | null = null;
    if (body.pilotSessionId != null && String(body.pilotSessionId).trim() !== "") {
      if (session.kind !== "admin") {
        return NextResponse.json({ success: false, message: "파일럿 현장은 시스템 운영자만 만들 수 있습니다." }, { status: 403 });
      }
      const psid = parseBigInt(body.pilotSessionId);
      if (!psid) throw new Error("VALIDATION:pilotSessionId");
      const ps = await prisma.pilotSession.findUnique({
        where: { id: psid },
        select: { agencyId: true, status: true },
      });
      if (!ps) return NextResponse.json({ success: false, message: "파일럿 회차를 찾을 수 없습니다." }, { status: 404 });
      if (ps.agencyId !== agencyId) {
        return NextResponse.json({ success: false, message: "회차의 위탁기관과 일치하지 않습니다.", reason: "AGENCY_MISMATCH" }, { status: 409 });
      }
      if (ps.status !== "DRAFT" && ps.status !== "READY") {
        return NextResponse.json({ success: false, message: "이 회차는 설정을 추가할 수 있는 상태가 아닙니다.", reason: "SESSION_LOCKED" }, { status: 409 });
      }
      createdByPilotSessionId = psid;
    }
    // ★[PILOT] 끝

    const quotaCheck = await checkQuota(agencyId, "sites");
    if (!quotaCheck.allowed) {
      return NextResponse.json({
        success: false,
        message: `사업장 한도(${quotaCheck.max}개)에 도달했습니다. 플랜을 업그레이드해주세요.`,
        reason: "QUOTA_EXCEEDED",
      }, { status: 403 });
    }

    // ✅ 위탁기관 담당자 지정.
    //  - body.ownerManagerId 미전송(undefined): 매니저는 생성자 본인(기존 동작), 운영자는 미지정.
    //  - 빈 문자열: 명시적 미지정.
    //  - 값 있음: 같은 위탁기관 관리자로 지정.
    let ownerManagerId: bigint | null = null;
    if (body.ownerManagerId === undefined) {
      ownerManagerId = session.kind === "manager" ? session.managerId : null;
    } else if (String(body.ownerManagerId).trim() === "") {
      ownerManagerId = null;
    } else {
      const oid = parseBigInt(body.ownerManagerId);
      if (!oid) throw new Error("VALIDATION:ownerManagerId");
      const m = await prisma.manager.findUnique({ where: { id: oid }, select: { agencyId: true } });
      if (!m || m.agencyId !== agencyId) throw new Error("VALIDATION:ownerManagerId");
      ownerManagerId = oid;
    }

    const created = await prisma.site.create({
      data: {
        companyName,
        address,
        detailAddress,
        gpsLat: new Prisma.Decimal(latStr),
        gpsLon: new Prisma.Decimal(lonStr),
        agencyId,
        ownerManagerId,
        businessContactName,
        businessContactPhone,
        businessContactEmail,
        requiredProfession,
        amCapacity,
        pmCapacity,
        fullDayCapacity,
        customCapacity,
        ...(allowanceRange !== undefined ? { allowanceRange } : {}),
        ...(lateThresholdMin !== null ? { lateThresholdMin } : {}),
        ...(additionalContacts.length ? { contacts: { create: additionalContacts } } : {}),
        // ★[PILOT] 파일럿 회차가 만든 현장 — 정식 검증 대상이 아니므로 isVerified도 함께 내린다.
        //  회차 종료 시 이 한 줄 삭제(위 [PILOT] 블록과 한 쌍).
        ...(createdByPilotSessionId ? { createdByPilotSessionId, isVerified: false } : {}),
      },
      select: {
        id: true,
        companyName: true,
        address: true,
        detailAddress: true,
        gpsLat: true,
        gpsLon: true,
        agencyId: true,
        ownerManagerId: true,
        businessContactName: true,
        businessContactPhone: true,
        businessContactEmail: true,
        requiredProfession: true,
        agency: { select: { id: true, name: true } },
        ownerManager: { select: { id: true, displayName: true, loginId: true } },
        basePointConfirmed: true,
        basePointAuthority: true,
        basePointApprovalStatus: true,
        basePointUpdatedAt: true,
        isActive: true,
        createdAt: true,
      },
    });

    await audit(session, { entityType: "Site", entityId: created.id, action: "create", after: { companyName, address, businessContactName, businessContactPhone } });
    return NextResponse.json({ success: true, item: toRow(created) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    const st = errToStatus(msg);
    return NextResponse.json({ success: false, message: st === 500 ? "서버 오류" : msg }, { status: st });
  }
}
