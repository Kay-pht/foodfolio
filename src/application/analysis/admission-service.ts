import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const ANALYSIS_ADMISSION_LIMITS = {
  userOutstanding: 10,
  userDaily: 30,
  globalOutstanding: 100,
  globalDaily: 500,
} as const;

export type AnalysisAdmissionLimitType =
  | "user_outstanding"
  | "user_daily"
  | "global_outstanding"
  | "global_daily";

export class AnalysisAdmissionLimitError extends Error {
  constructor(
    public readonly limitType: AnalysisAdmissionLimitType,
    public readonly limit: number,
    public readonly retryAt?: Date,
  ) {
    super("Analysis request limit reached");
    this.name = "AnalysisAdmissionLimitError";
  }
}

export interface RecipeAnalysisAdmissionInput {
  userId: string;
  originalUrl: string;
  normalizedUrl: string;
  sourceType: Prisma.RecipeUncheckedCreateInput["sourceType"];
}

export function jstDayRange(now: Date): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  const startMs =
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ) - JST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

export async function admitRecipeAnalysis(
  prisma: PrismaClient,
  input: RecipeAnalysisAdmissionInput,
): Promise<string> {
  return prisma.$transaction(
    async (tx) => {
      // Serialize the small admission critical section across all API instances.
      // Select only a supported scalar because pg_advisory_xact_lock itself returns void.
      await tx.$queryRaw<
        Array<{ acquired: number }>
      >`SELECT 1::int AS acquired FROM pg_advisory_xact_lock(20260908, 1)`;

      const [clock] = await tx.$queryRaw<
        Array<{ now: Date }>
      >`SELECT clock_timestamp() AS now`;
      const now = clock?.now ?? new Date();
      const { start, end } = jstDayRange(now);

      const userOutstanding = await tx.analysisAdmission.count({
        where: { userId: input.userId, finishedAt: null },
      });
      if (userOutstanding >= ANALYSIS_ADMISSION_LIMITS.userOutstanding)
        throw new AnalysisAdmissionLimitError(
          "user_outstanding",
          ANALYSIS_ADMISSION_LIMITS.userOutstanding,
        );

      const userDaily = await tx.analysisAdmission.count({
        where: {
          userId: input.userId,
          acceptedAt: { gte: start, lt: end },
        },
      });
      if (userDaily >= ANALYSIS_ADMISSION_LIMITS.userDaily)
        throw new AnalysisAdmissionLimitError(
          "user_daily",
          ANALYSIS_ADMISSION_LIMITS.userDaily,
          end,
        );

      const globalOutstanding = await tx.analysisAdmission.count({
        where: { finishedAt: null },
      });
      if (globalOutstanding >= ANALYSIS_ADMISSION_LIMITS.globalOutstanding)
        throw new AnalysisAdmissionLimitError(
          "global_outstanding",
          ANALYSIS_ADMISSION_LIMITS.globalOutstanding,
        );

      const globalDaily = await tx.analysisAdmission.count({
        where: { acceptedAt: { gte: start, lt: end } },
      });
      if (globalDaily >= ANALYSIS_ADMISSION_LIMITS.globalDaily)
        throw new AnalysisAdmissionLimitError(
          "global_daily",
          ANALYSIS_ADMISSION_LIMITS.globalDaily,
          end,
        );

      const recipe = await tx.recipe.create({
        data: {
          userId: input.userId,
          originalUrl: input.originalUrl,
          normalizedUrl: input.normalizedUrl,
          sourceType: input.sourceType,
        },
        select: { id: true },
      });
      await tx.analysisAdmission.create({
        data: {
          userId: input.userId,
          recipeId: recipe.id,
          acceptedAt: now,
        },
      });
      return recipe.id;
    },
    { timeout: 15_000 },
  );
}

export async function finishAnalysisAdmission(
  prisma: PrismaClient | Prisma.TransactionClient,
  recipeId: string,
): Promise<void> {
  await prisma.analysisAdmission.updateMany({
    where: { recipeId, finishedAt: null },
    data: { finishedAt: new Date() },
  });
}
