"use client";

import { useParams } from "next/navigation";
import AgencyDetail from "../AgencyDetail";

export default function AgencyDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <AgencyDetail id={id} />;
}
