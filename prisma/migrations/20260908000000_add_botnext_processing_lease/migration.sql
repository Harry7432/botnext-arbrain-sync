-- AlterTable
ALTER TABLE "botnext_webhook_events" ADD COLUMN     "processing_token" UUID,
ADD COLUMN     "processing_worker" TEXT,
ADD COLUMN     "processing_lease_until" TIMESTAMP(3),
ADD COLUMN     "processing_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "enqueue_token" UUID,
ADD COLUMN     "enqueue_lease_until" TIMESTAMP(3),
ADD COLUMN     "enqueued_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "botnext_webhook_events_status_processing_lease_until_idx" ON "botnext_webhook_events"("status", "processing_lease_until");

-- CreateIndex
CREATE INDEX "botnext_webhook_events_status_enqueue_lease_until_idx" ON "botnext_webhook_events"("status", "enqueue_lease_until");
