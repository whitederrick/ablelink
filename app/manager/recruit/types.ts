// 직무지도 모집 공고 — 목록/상세 공용 타입 (목록 GET /api/admin/recruit-posts 응답 형태)
export interface Post {
  id: string;
  title: string;
  companyName: string;
  profession: string;
  taskName: string | null;
  address: string | null;
  detailAddress: string | null;
  region: string | null;
  workHours: string | null;
  workDays: string | null;
  payInfo: string | null;
  serviceStart: string | null;
  serviceEnd: string | null;
  headcount: number;
  description: string | null;
  status: string;
  contactName: string | null;
  contactPhone: string | null;
  applicationCount?: number;
  createdAt: string;
}
