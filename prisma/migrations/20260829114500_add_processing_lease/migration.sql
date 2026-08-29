ALTER TABLE "Recipe"
ADD COLUMN "processingRunId" UUID,
ADD COLUMN "processingLeaseExpiresAt" TIMESTAMPTZ(3);
