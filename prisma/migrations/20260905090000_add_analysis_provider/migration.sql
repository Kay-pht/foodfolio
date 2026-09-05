CREATE TYPE "AiProvider" AS ENUM ('zai', 'gemini');

ALTER TABLE "Recipe" ADD COLUMN "analysisProvider" "AiProvider";
