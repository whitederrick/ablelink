-- 같은 기관 다시급: PayContract 현장별 금액 override용 nullable siteId + 인덱스.
ALTER TABLE "pay_contracts" ADD COLUMN     "site_id" BIGINT;
CREATE INDEX "pay_contracts_agency_id_worker_id_site_id_effective_from_idx" ON "pay_contracts"("agency_id", "worker_id", "site_id", "effective_from");
-- FK (site 삭제 시 계약은 유지하되 참조만 정리하지 않음 — Site는 비활성화 정책이라 물리삭제 드묾)
ALTER TABLE "pay_contracts" ADD CONSTRAINT "pay_contracts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
