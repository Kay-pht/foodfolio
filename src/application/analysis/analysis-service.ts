import type { PrismaClient } from "../../generated/prisma/client.js";
import { genreFromLabel } from "../../domain/recipe/genre.js";
import {
  AnalysisError,
  type NotificationSender,
  type RecipeExtractor,
  type SourceContentExtractor,
} from "./types.js";

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
    const reclaimInterruptedProcessing = attempt > 1;
    const claimed = await this.deps.prisma.recipe.updateMany({
      where: {
        id: recipeId,
        analysisStatus: reclaimInterruptedProcessing
          ? { in: ["pending", "processing"] }
          : "pending",
      },
      data: { analysisStatus: "processing", updatedAt: new Date() },
    });
    if (claimed.count === 0) {
      log(
        { recipeId, analysisAttempt: attempt },
        "recipe analysis is already processing",
      );
      return { retry: true };
    }
    if (recipe.analysisStatus === "processing")
      log(
        { recipeId, analysisAttempt: attempt },
        "reclaiming interrupted recipe analysis",
      );
    try {
      const source = await this.deps.sourceExtractor.extract(
        new URL(recipe.originalUrl),
      );
      const result = await this.deps.recipeExtractor.extract(source);
      const title = result.recipe.title?.trim() || "タイトル未取得のレシピ";
      await this.deps.prisma.$transaction(async (tx) => {
        const stillExists = await tx.recipe.findUnique({
          where: { id: recipeId },
          select: { id: true },
        });
        if (!stillExists) return;
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
            updatedAt: new Date(),
          },
        });
      });
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
      await this.deps.prisma.recipe.updateMany({
        where: { id: recipeId },
        data: {
          analysisStatus: final ? "failed" : "pending",
          ...(final ? { title } : {}),
          updatedAt: new Date(),
        },
      });
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
