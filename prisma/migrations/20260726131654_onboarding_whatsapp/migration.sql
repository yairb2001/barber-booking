-- AlterTable: add WhatsApp-driven onboarding fields to businesses
-- Additive only (new nullable / defaulted columns) — safe against existing rows.
-- NOT applied to any database by this commit. Review, then apply with
-- `prisma migrate deploy` against the target environment.
ALTER TABLE "businesses"
  ADD COLUMN "business_kind" TEXT NOT NULL DEFAULT 'men_barbershop',
  ADD COLUMN "onboarding_started_at" TIMESTAMP(3),
  ADD COLUMN "onboarding_nudge_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "onboarding_last_nudge_at" TIMESTAMP(3),
  ADD COLUMN "onboarding_stuck_at" TIMESTAMP(3);
