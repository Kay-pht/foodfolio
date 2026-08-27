CREATE TYPE "SourceType" AS ENUM ('youtube', 'instagram', 'tiktok', 'kurashiru', 'cookpad', 'web');
CREATE TYPE "AnalysisStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE "Genre" AS ENUM ('主菜', '副菜', '主食', '麺', 'スープ・汁物', 'サラダ', 'デザート', 'その他');

CREATE TABLE "User" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "firebaseUid" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "UserSetting" (
  "userId" UUID NOT NULL,
  "recipeAnalysisNotificationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "UserSetting_pkey" PRIMARY KEY ("userId")
);
CREATE TABLE "Recipe" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "originalUrl" TEXT NOT NULL,
  "normalizedUrl" TEXT NOT NULL,
  "sourceType" "SourceType" NOT NULL,
  "title" TEXT NOT NULL DEFAULT '解析中のレシピ',
  "imageUrl" TEXT,
  "servingsValue" DOUBLE PRECISION,
  "servingsRaw" TEXT,
  "cookingTimeMinutes" INTEGER,
  "genre" "Genre",
  "analysisStatus" "AnalysisStatus" NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Ingredient" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recipeId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "amount" TEXT,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "RecipeStep" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recipeId" UUID NOT NULL,
  "text" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "RecipeStep_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Tag" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "RecipeTag" (
  "recipeId" UUID NOT NULL,
  "tagId" UUID NOT NULL,
  CONSTRAINT "RecipeTag_pkey" PRIMARY KEY ("recipeId", "tagId")
);
CREATE TABLE "DeviceToken" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "fcmToken" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid");
CREATE UNIQUE INDEX "Recipe_userId_normalizedUrl_key" ON "Recipe"("userId", "normalizedUrl");
CREATE INDEX "Recipe_userId_createdAt_idx" ON "Recipe"("userId", "createdAt" DESC);
CREATE INDEX "Recipe_userId_genre_idx" ON "Recipe"("userId", "genre");
CREATE INDEX "Recipe_userId_analysisStatus_idx" ON "Recipe"("userId", "analysisStatus");
CREATE INDEX "Recipe_userId_updatedAt_idx" ON "Recipe"("userId", "updatedAt");
CREATE UNIQUE INDEX "Ingredient_recipeId_sortOrder_key" ON "Ingredient"("recipeId", "sortOrder");
CREATE UNIQUE INDEX "RecipeStep_recipeId_sortOrder_key" ON "RecipeStep"("recipeId", "sortOrder");
CREATE UNIQUE INDEX "Tag_userId_normalizedName_key" ON "Tag"("userId", "normalizedName");
CREATE INDEX "Tag_userId_createdAt_idx" ON "Tag"("userId", "createdAt");
CREATE UNIQUE INDEX "DeviceToken_fcmToken_key" ON "DeviceToken"("fcmToken");
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

ALTER TABLE "UserSetting" ADD CONSTRAINT "UserSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipeStep" ADD CONSTRAINT "RecipeStep_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipeTag" ADD CONSTRAINT "RecipeTag_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipeTag" ADD CONSTRAINT "RecipeTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
