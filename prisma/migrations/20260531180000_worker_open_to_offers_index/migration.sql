-- 인력풀 검색(talent) 가속: openToOffers + status 인덱스
CREATE INDEX "workers_open_to_offers_status_idx" ON "workers"("open_to_offers", "status");
