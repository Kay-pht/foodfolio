import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { genreFromLabel } from "../../domain/recipe/genre.js";
import {
  AnalysisError,
  type NotificationSender,
  type RecipeExtractor,
  type SourceContentExtractor,
} from "./types.js";

const PROCESSING_LEASE_MS = 210_000;

export interface AnalysisDependencies {
  prisma: PrismaClient;
  sourceExtractor: SourceContentExtractor;
  recipeExtractor: RecipeExtractor;
  notifications: NotificationSender;
  maxAttempts: number;
}

export class RecipeAnalysisService {
  constructor(private readonly deps: AnalysisDependencies) {}

  async process(
    recipeId: string,
    attempt: number,
    log: (fields: Record<string, unknown>, message: string) => void,
  ): Promise<{ retry: boolean }> {
    const recipe = await this.deps.prisma.recipe.findUnique({
      where: { id: recipeId },
    });
    if (
      !recipe ||
      recipe.analysisStatus === "completed" ||
      recipe.analysisStatus === "failed"
    )
      return { retry: false };

    const runId = randomUUID();
    const claimed = await this.claim(recipeId, runId);
    if (!claimed) {
      log(
        { recipeId, analysisAttempt: attempt },
        "recipe analysis is already processing",
      );
      return { retry: true };
    }
    if (recipe.analysisStatus === "processing")
      log(
        { recipeId, analysisAttempt: attempt, processingRunId: runId },
        "reclaiming stale recipe analysis lease",
      );

    try {
      const source = await this.deps.sourceExtractor.extract(
        new URL(recipe.originalUrl),
      );
      const result = await this.deps.recipeExtractor.extract(source);
      const title = result.recipe.title?.trim() || "タイトル未取得のレシピ";
      const committed = await this.deps.prisma.$transaction(async (tx) => {
        const owned = await tx.recipe.findFirst({
          where: {
            id: recipeId,
            analysisStatus: "processing",
            processingRunId: runId,
          },
          select: { id: true },
        });
        if (!owned) return false;
        await tx.ingredient.deleteMany({ where: { recipeId } });
        await tx.recipeStep.deleteMany({ where: { recipeId } });
        if (result.recipe.ingredients.length)
          await tx.ingredient.createMany({
            data: result.recipe.ingredients.map((item, sortOrder) => ({
              recipeId,
              name: item.name,
              amount: item.amount,
              sortOrder,
            })),
          });
        if (result.recipe.steps.length)
          await tx.recipeStep.createMany({
            data: result.recipe.steps.map((text, sortOrder) => ({
              recipeId,
              text,
              sortOrder,
            })),
          });
        await tx.recipe.update({
          where: { id: recipeId },
          data: {
            sourceType: source.sourceType,
            imageUrl: source.imageUrl,
            title,
            servingsValue: result.recipe.servings?.value ?? null,
            servingsRaw: result.recipe.servings?.raw ?? null,
            cookingTimeMinutes: result.recipe.cookingTimeMinutes,
            genre: genreFromLabel(result.recipe.genre),
            analysisStatus: "completed",
            processingRunId: null,
            processingLeaseExpiresAt: null,
            updatedAt: new Date(),
          },
        });
        return true;
      });
      if (!committed) return this.resultAfterLostOwnership(recipeId);
      log(
        {
          recipeId,
          analysisStatus: "completed",
          analysisAttempt: attempt,
          provider: "zai",
          providerRequestId: result.providerRequestId,
          latencyMs: result.latencyMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
        "recipe analysis completed",
      );
      await this.notify(recipe.userId, recipeId, title, "completed", log);
      return { retry: false };
    } catch (error) {
      const analysisError =
        error instanceof AnalysisError
          ? error
          : new AnalysisError(
              "INTERNAL_ANALYSIS_ERROR",
              true,
              "Unexpected analysis error",
            );
      const final =
        !analysisError.retryable || attempt >= this.deps.maxAttempts;
      const title = "解析に失敗したレシピ";
      const changed = await this.deps.prisma.recipe.updateMany({
        where: {
          id: recipeId,
          analysisStatus: "processing",
          processingRunId: runId,
        },
        data: {
          analysisStatus: final ? "failed" : "pending",
          processingRunId: null,
          processingLeaseExpiresAt: null,
          ...(final ? { title } : {}),
          updatedAt: new Date(),
        },
      });
      if (changed.count === 0) return this.resultAfterLostOwnership(recipeId);
      log(
        {
          recipeId,
          analysisStatus: final ? "failed" : "pending",
          analysisAttempt: attempt,
          errorCode: analysisError.code,
        },
        "recipe analysis failed",
      );
      if (final)
        await this.notify(recipe.userId, recipeId, title, "failed", log);
      return { retry: !final };
    }
  }

  private async claim(recipeId: string, runId: string): Promise<boolean> {
    return this.deps.prisma.$transaction(async (tx) => {
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT clock_timestamp() AS now
      `;
      const now = clock?.now ?? new Date();
      const leaseExpiresAt = new Date(now.getTime() + PROCESSING_LEASE_MS);
      const claimed = await tx.recipe.updateMany({
        where: {
          id: recipeId,
          OR: [
            { analysisStatus: "pending" },
            {
              analysisStatus: "processing",
              processingLeaseExpiresAt: { lte: now },
            },
          ],
        },
        data: {
          analysisStatus: "processing",
          processingRunId: runId,
          processingLeaseExpiresAt: leaseExpiresAt,
          updatedAt: now,
        },
      });
      return claimed.count === 1;
    });
  }

  private async resultAfterLostOwnership(
    recipeId: string,
  ): Promise<{ retry: boolean }> {
    const current = await this.deps.prisma.recipe.findUnique({
      where: { id: recipeId },
      select: { analysisStatus: true },
    });
    return {
      retry:
        !!current &&
        current.analysisStatus !== "completed" &&
        current.analysisStatus !== "failed",
    };
  }

  private async notify(
    userId: string,
    recipeId: string,
    title: string,
    result: "completed" | "failed",
    log: (fields: Record<string, unknown>, message: string) => void,
  ): Promise<void> {
    const setting = await this.deps.prisma.userSetting.findUnique({
      where: { userId },
    });
    if (!setting?.recipeAnalysisNotificationEnabled) return;
    const tokenRows = await this.deps.prisma.deviceToken.findMany({
      where: { userId },
    });
    try {
      const tokens = tokenRows.map(({ fcmToken }) => fcmToken);
      const invalid =
        result === "completed"
          ? await this.deps.notifications.sendRecipeAnalysisCompleted(
              tokens,
              recipeId,
              title,
            )
          : await this.deps.notifications.sendRecipeAnalysisFailed(
              tokens,
              recipeId,
              title,
            );
      if (invalid.length)
        await this.deps.prisma.deviceToken.deleteMany({
          where: { fcmToken: { in: invalid } },
        });
    } catch (error) {
      log(
        { recipeId, errorCode: "NOTIFICATION_SEND_FAILED", err: error },
        "notification send failed",
      );
    }
  }
}
