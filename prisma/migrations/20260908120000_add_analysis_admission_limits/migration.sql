CREATE TABLE "AnalysisAdmission" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "recipeId" UUID NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(3),
  CONSTRAINT "AnalysisAdmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalysisAdmission_recipeId_key" ON "AnalysisAdmission"("recipeId");
CREATE INDEX "AnalysisAdmission_userId_finishedAt_idx" ON "AnalysisAdmission"("userId", "finishedAt");
CREATE INDEX "AnalysisAdmission_finishedAt_idx" ON "AnalysisAdmission"("finishedAt");
CREATE INDEX "AnalysisAdmission_userId_acceptedAt_idx" ON "AnalysisAdmission"("userId", "acceptedAt");
CREATE INDEX "AnalysisAdmission_acceptedAt_idx" ON "AnalysisAdmission"("acceptedAt");

ALTER TABLE "AnalysisAdmission" ADD CONSTRAINT "AnalysisAdmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
