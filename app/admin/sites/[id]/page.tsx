"use client";
// app/admin/sites/[id]/page.tsx — 현장 상세 딥링크 페이지(공용 SiteDetail 본문 사용)

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import PageHeader from "../../_components/PageHeader";
import SiteDetail from "../SiteDetail";

export default function AdminSiteDetailPage() {
  const params = useParams<{ id: string }>();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { setId(params.id); }, [params.id]);

  return (
    <div className="max-w-2xl">
      <PageHeader title="현장(사업체) 상세" />
      {id && <SiteDetail id={id} />}
    </div>
  );
}
