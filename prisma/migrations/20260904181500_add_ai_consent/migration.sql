ALTER TABLE "UserSetting"
ADD COLUMN "aiConsentVersion" INTEGER,
ADD COLUMN "aiConsentedAt" TIMESTAMPTZ(3);
