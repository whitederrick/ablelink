-- CreateIndex
CREATE INDEX IF NOT EXISTS "trainees_current_site_id_status_idx" ON "trainees"("current_site_id", "status");
