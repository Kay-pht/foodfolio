import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { genreFromLabel } from "../../domain/recipe/genre.js";
import {
  generateAiSharedRecipeThumbnail,
  hasRequiredRecipeContent,
  type AiSharedRecipeThumbnailResult,
} from "./recipe-thumbnail.js";
import type {
  JevRoutingDecision,
  JevRoutingProvider,
  JevSelectedRoute,
} from "./jev-routing.js";
import {
  AnalysisError,
  NOT_RECIPE_MESSAGE,
  type GeneratedRecipeImageStore,
  type InstagramMediaRecipeFallback,
  type InstagramVideoRecipeFallback,
  type NotificationSender,
  type PublishedGeneratedRecipeImage,
  type RecipeExtractionResult,
  type RecipeExtractor,
  type RecipeThumbnailGenerator,
  type SourceContent,
  type SourceContentExtractor,
  type TikTokPhotoRecipeAnalysis,
  type TikTokVideoRecipeFallback,
} from "./types.js";
import { describeAnalysisFailure } from "./operational-failure.js";

const PROCESSING_LEASE_MS = 660_000;

function sourceUrlForLogging(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export interface AnalysisDependencies {
  prisma: PrismaClient;
  sourceExtractor: SourceContentExtractor;
  recipeExtractor: RecipeExtractor;
  jevRouter?: JevRoutingProvider;
  textRecipeExtractor?: RecipeExtractor;
  youtubeVideoFallback?: RecipeExtractor;
  tiktokVideoFallback?: TikTokVideoRecipeFallback;
  tiktokPhotoAnalysis?: TikTokPhotoRecipeAnalysis;
  instagramMediaFallback?: InstagramMediaRecipeFallback;
  instagramVideoFallback?: InstagramVideoRecipeFallback;
  recipeThumbnailGenerator?: RecipeThumbnailGenerator;
  generatedImageStore?: GeneratedRecipeImageStore;
  notifications: NotificationSender;
  maxAttempts: number;
}

interface FallbackOptions {
  disabledCode: string;
  disabledMessage: string;
  incompleteMessage: string;
}

interface RouteExecutionTrace {
  finalRoute: JevSelectedRoute;
  textExtractionComplete: boolean;
  mediaFallbackUsed: boolean;
}

export interface NotRecipeTransitionDependencies {
  prisma: PrismaClient;
  notifications: NotificationSender;
}

export async function completeNotRecipeAnalysis(
  deps: NotRecipeTransitionDependencies,
  recipeId: string,
  runId: string,
  attempt: number,
  log: (fields: Record<string, unknown>, message: string) => void,
): Promise<boolean> {
  const userId = await deps.prisma.$transaction(async (tx) => {
    const changed = await tx.recipe.updateMany({
      where: {
        id: recipeId,
        analysisStatus: "processing",
        processingRunId: runId,
      },
      data: {
        analysisStatus: "not_recipe",
        title: NOT_RECIPE_MESSAGE,
        imageUrl: null,
        servingsValue: null,
        servingsRaw: null,
        cookingTimeMinutes: null,
        genre: null,
        analysisProvider: null,
        processingRunId: null,
        processingLeaseExpiresAt: null,
        updatedAt: new Date(),
      },
    });
    if (changed.count !== 1) return null;

    await tx.ingredient.deleteMany({ where: { recipeId } });
    await tx.recipeStep.deleteMany({ where: { recipeId } });
    const updated = await tx.recipe.findUniqueOrThrow({
      where: { id: recipeId },
      select: { userId: true },
    });
    return updated.userId;
  });

  if (!userId) return false;

  log(
    {
      recipeId,
      analysisStatus: "not_recipe",
      analysisAttempt: attempt,
    },
    "recipe classified as not recipe",
  );

  const setting = await deps.prisma.userSetting.findUnique({
    where: { userId },
  });
  if (!setting?.recipeAnalysisNotificationEnabled) return true;

  const tokenRows = await deps.prisma.deviceToken.findMany({
    where: { userId },
  });
  try {
    const invalid = await deps.notifications.sendRecipeAnalysisNotRecipe(
      tokenRows.map(({ fcmToken }) => fcmToken),
      recipeId,
    );
    if (invalid.length) {
      await deps.prisma.deviceToken.deleteMany({
        where: { fcmToken: { in: invalid } },
      });
    }
  } catch (error) {
    log(
      { recipeId, errorCode: "NOTIFICATION_SEND_FAILED", err: error },
      "notification send failed",
    );
  }
  return true;
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
      recipe.analysisStatus === "failed" ||
      recipe.analysisStatus === "not_recipe"
    )
      return { retry: false };

    const runId = randomUUID();
    const claimed = await this.claim(recipeId, runId, attempt);
    if (!claimed) {
      const current = await this.resultAfterLostOwnership(recipeId);
      log(
        { recipeId, analysisAttempt: attempt },
        current.retry
          ? "recipe analysis is already processing"
          : "recipe analysis no longer requires processing",
      );
      return current;
    }
    if (recipe.analysisStatus === "processing")
      log(
        { recipeId, analysisAttempt: attempt, processingRunId: runId },
        "reclaiming stale recipe analysis lease",
      );

    let routingDecision: JevRoutingDecision | null = null;
    let routingTrace: RouteExecutionTrace | null = null;
    const sourceUrl = sourceUrlForLogging(recipe.originalUrl);

    try {
      const source = await this.deps.sourceExtractor.extract(
        new URL(recipe.originalUrl),
      );
      routingDecision = this.deps.jevRouter
        ? await this.deps.jevRouter.route(source)
        : null;
      if (routingDecision?.snapshot)
        this.logJevDecision(recipeId, attempt, routingDecision, log);

      if (routingDecision?.selectedRoute === "not_recipe") {
        routingTrace = this.initialRouteTrace("not_recipe");
        const completed = await completeNotRecipeAnalysis(
          this.deps,
          recipeId,
          runId,
          attempt,
          log,
        );
        if (!completed) return this.resultAfterLostOwnership(recipeId);
        this.logJevOutcome(
          recipeId,
          attempt,
          routingDecision,
          routingTrace,
          "not_recipe",
          log,
        );
        return { retry: false };
      }

      if (routingDecision)
        routingTrace = this.initialRouteTrace(routingDecision.selectedRoute);
      const { result, videoFallbackUsed } = await this.extractRecipe(
        source,
        routingDecision,
        routingTrace,
      );
      const title = result.recipe.title?.trim() || "タイトル未取得のレシピ";
      const staged = await this.deps.prisma.$transaction(async (tx) => {
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
            analysisProvider: result.provider,
            updatedAt: new Date(),
          },
        });
        return true;
      });
      if (!staged) return this.resultAfterLostOwnership(recipeId);

      const thumbnail = await generateAiSharedRecipeThumbnail({
        recipeId,
        source,
        result,
        generator: this.deps.recipeThumbnailGenerator,
        store: this.deps.generatedImageStore,
        log,
      });
      const completed = await this.completeAnalysis(
        recipeId,
        runId,
        thumbnail,
        log,
      );
      if (!completed) return this.resultAfterLostOwnership(recipeId);

      log(
        {
          recipeId,
          analysisStatus: "completed",
          analysisAttempt: attempt,
          provider: result.provider,
          providerRequestId: result.providerRequestId,
          latencyMs: result.latencyMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          videoFallbackUsed,
        },
        "recipe analysis completed",
      );
      if (routingDecision)
        this.logJevOutcome(
          recipeId,
          attempt,
          routingDecision,
          routingTrace,
          "completed",
          log,
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
          ...(analysisError.provider
            ? { analysisProvider: analysisError.provider }
            : {}),
          processingRunId: null,
          processingLeaseExpiresAt: null,
          ...(final ? { title } : {}),
          updatedAt: new Date(),
        },
      });
      if (changed.count === 0) return this.resultAfterLostOwnership(recipeId);
      const operationalFailure = final
        ? describeAnalysisFailure({
            errorCode: analysisError.code,
            provider: analysisError.provider,
            attempt,
          })
        : null;
      log(
        {
          ...(analysisError.diagnostics ?? {}),
          recipeId,
          ...(sourceUrl ? { sourceUrl } : {}),
          analysisStatus: final ? "failed" : "pending",
          analysisAttempt: attempt,
          ...(final ? { analysisAttemptLabel: String(attempt) } : {}),
          ...(final ? { severity: "ERROR" } : {}),
          errorCode: analysisError.code,
          provider: analysisError.provider,
          ...(operationalFailure ?? {}),
        },
        "recipe analysis failed",
      );
      if (routingDecision)
        this.logJevOutcome(
          recipeId,
          attempt,
          routingDecision,
          routingTrace,
          final ? "failed" : "pending",
          log,
        );
      if (final)
        await this.notify(recipe.userId, recipeId, title, "failed", log);
      return { retry: !final };
    }
  }

  private initialRouteTrace(
    selectedRoute: JevSelectedRoute,
  ): RouteExecutionTrace {
    return {
      finalRoute: selectedRoute,
      textExtractionComplete: false,
      mediaFallbackUsed: false,
    };
  }

  private async extractRecipe(
    source: SourceContent,
    routingDecision: JevRoutingDecision | null,
    trace: RouteExecutionTrace | null,
  ): Promise<{ result: RecipeExtractionResult; videoFallbackUsed: boolean }> {
    if (!routingDecision || routingDecision.selectedRoute === "fail_open")
      return this.extractLegacyRecipe(source);

    switch (routingDecision.selectedRoute) {
      case "text":
        return this.extractRoutedText(source, trace);
      case "youtube_video":
        return this.extractYoutubeVideo(source, trace);
      case "instagram_media":
        return this.extractInstagramMedia(source, trace);
      case "tiktok_video":
        return this.extractTikTokVideo(source, trace);
      case "tiktok_photo_media":
        return this.extractTikTokPhoto(source, trace);
      case "not_recipe":
        throw new AnalysisError(
          "INTERNAL_ANALYSIS_ERROR",
          false,
          "not_recipe routing must be completed before extraction",
        );
    }
  }

  private async extractRoutedText(
    source: SourceContent,
    trace: RouteExecutionTrace | null,
  ): Promise<{ result: RecipeExtractionResult; videoFallbackUsed: boolean }> {
    const textExtractor =
      this.deps.textRecipeExtractor ?? this.deps.recipeExtractor;
    const textResult = await textExtractor.extract(source);
    const complete = hasRequiredRecipeContent(textResult);
    if (trace) {
      trace.finalRoute = "text";
      trace.textExtractionComplete = complete;
    }

    if (source.sourceType === "youtube") {
      if (complete) return { result: textResult, videoFallbackUsed: false };
      return this.extractYoutubeVideo(source, trace, textResult);
    }

    if (source.sourceType === "instagram") {
      if (complete) return { result: textResult, videoFallbackUsed: false };
      return this.extractInstagramMedia(source, trace, textResult);
    }

    if (source.sourceType === "tiktok") {
      if (complete) return { result: textResult, videoFallbackUsed: false };
      return source.tiktokMediaKind === "photo"
        ? this.extractTikTokPhoto(source, trace, textResult)
        : this.extractTikTokVideo(source, trace, textResult);
    }

    return { result: textResult, videoFallbackUsed: false };
  }

  private async extractYoutubeVideo(
    source: SourceContent,
    trace: RouteExecutionTrace | null,
    textResult?: RecipeExtractionResult,
  ): Promise<{ result: RecipeExtractionResult; videoFallbackUsed: boolean }> {
    if (trace) {
      trace.finalRoute = "youtube_video";
      trace.mediaFallbackUsed = !!textResult;
    }
    if (!this.deps.youtubeVideoFallback)
      throw new AnalysisError(
        "YOUTUBE_GEMINI_FALLBACK_DISABLED",
        false,
        "YouTube Gemini video analysis is disabled",
      );
    const mediaResult = await this.deps.youtubeVideoFallback.extract(source);
    if (!hasRequiredRecipeContent(mediaResult))
      throw new AnalysisError(
        "SOURCE_CONTENT_UNAVAILABLE",
        false,
        "YouTube video did not contain enough recipe information",
      );
    return {
      result: textResult
        ? combineExtractionResults(textResult, mediaResult)
        : mediaResult,
      videoFallbackUsed: true,
    };
  }

  private async extractInstagramMedia(
    source: SourceContent,
    trace: RouteExecutionTrace | null,
    textResult?: RecipeExtractionResult,
  ): Promise<{ result: RecipeExtractionResult; videoFallbackUsed: boolean }> {
    if (trace) {
      trace.finalRoute = "instagram_media";
      trace.mediaFallbackUsed = !!textResult;
    }
    const fallback =
      this.deps.instagramMediaFallback ?? this.deps.instagramVideoFallback;
    if (!fallback)
      throw new AnalysisError(
        "INSTAGRAM_MEDIA_FALLBACK_DISABLED",
        false,
        "Instagram media analysis is disabled",
      );
    const mediaResult = await fallback.extract(source);
    if (!hasRequiredRecipeContent(mediaResult))
      throw new AnalysisError(
        "SOURCE_CONTENT_UNAVAILABLE",
        false,
        "Instagram media did not contain enough recipe information",
      );
    return {
      result: textResult
        ? combineExtractionResults(textResult, mediaResult)
        : mediaResult,
      videoFallbackUsed: true,
    };
  }

  private async extractTikTokVideo(
    source: SourceContent,
    trace: RouteExecutionTrace | null,
    textResult?: RecipeExtractionResult,
  ): Promise<{ result: RecipeExtractionResult; videoFallbackUsed: boolean }> {
    if (trace) {
      trace.finalRoute = "tiktok_video";
      trace.mediaFallbackUsed = !!textResult;
    }
    if (!this.deps.tiktokVideoFallback)
      throw new AnalysisError(
        "TIKTOK_MEDIA_ANALYSIS_DISABLED",
        false,
        "TikTok video analysis is disabled",
      );
    const mediaResult = await this.deps.tiktokVideoFallback.extract(source);
    if (!hasRequiredRecipeContent(mediaResult))
      throw new AnalysisError(
        "SOURCE_CONTENT_UNAVAILABLE",
        false,
        "TikTok video did not contain enough recipe information",
      );
    return {
      result: textResult
        ? combineExtractionResults(textResult, mediaResult)
        : mediaResult,
      videoFallbackUsed: true,
    };
  }

  private async extractTikTokPhoto(
    source: SourceContent,
    trace: RouteExecutionTrace | null,
    textResult?: RecipeExtractionResult,
  ): Promise<{ result: RecipeExtractionResult; videoFallbackUsed: boolean }> {
    if (trace) {
      trace.finalRoute = "tiktok_photo_media";
      trace.mediaFallbackUsed = !!textResult;
    }
    if (!this.deps.tiktokPhotoAnalysis)
      throw new AnalysisError(
        "TIKTOK_MEDIA_ANALYSIS_DISABLED",
        false,
        "TikTok photo analysis is disabled",
      );
    const mediaResult = await this.deps.tiktokPhotoAnalysis.extract(source);
    if (!hasRequiredRecipeContent(mediaResult))
      throw new AnalysisError(
        "SOURCE_CONTENT_UNAVAILABLE",
        false,
        "TikTok photos did not contain enough recipe information",
      );
    return {
      result: textResult
        ? combineExtractionResults(textResult, mediaResult)
        : mediaResult,
      videoFallbackUsed: true,
    };
  }

  private async extractLegacyRecipe(
    source: SourceContent,
  ): Promise<{ result: RecipeExtractionResult; videoFallbackUsed: boolean }> {
    if (source.sourceType === "tiktok" && source.tiktokMediaKind === "photo") {
      return this.extractTikTokPhoto(source, null);
    }

    if (source.sourceType === "tiktok")
      return this.extractWithFallback(source, this.deps.tiktokVideoFallback, {
        disabledCode: "TIKTOK_MEDIA_ANALYSIS_DISABLED",
        disabledMessage:
          "TikTok title did not contain enough recipe information and video fallback is disabled",
        incompleteMessage:
          "TikTok video did not contain enough recipe information",
      });

    if (source.sourceType === "instagram")
      return this.extractWithFallback(
        source,
        this.deps.instagramMediaFallback ?? this.deps.instagramVideoFallback,
        {
          disabledCode: "INSTAGRAM_MEDIA_FALLBACK_DISABLED",
          disabledMessage:
            "Instagram metadata did not contain enough recipe information and media fallback is disabled",
          incompleteMessage:
            "Instagram media did not contain enough recipe information",
        },
      );

    const result = await this.deps.recipeExtractor.extract(source);
    return {
      result,
      videoFallbackUsed:
        source.sourceType === "youtube" && result.provider === "gemini",
    };
  }

  private async extractWithFallback(
    source: SourceContent,
    fallback:
      | TikTokVideoRecipeFallback
      | InstagramMediaRecipeFallback
      | InstagramVideoRecipeFallback
      | undefined,
    options: FallbackOptions,
  ): Promise<{ result: RecipeExtractionResult; videoFallbackUsed: boolean }> {
    const textResult = source.textForAi
      ? await this.deps.recipeExtractor.extract(source)
      : null;
    if (textResult && hasRequiredRecipeContent(textResult))
      return { result: textResult, videoFallbackUsed: false };

    if (!fallback)
      throw new AnalysisError(
        options.disabledCode,
        false,
        options.disabledMessage,
      );

    const mediaResult = await fallback.extract(source);
    if (!hasRequiredRecipeContent(mediaResult))
      throw new AnalysisError(
        "SOURCE_CONTENT_UNAVAILABLE",
        false,
        options.incompleteMessage,
      );
    return {
      result: textResult
        ? combineExtractionResults(textResult, mediaResult)
        : mediaResult,
      videoFallbackUsed: true,
    };
  }

  private logJevDecision(
    recipeId: string,
    attempt: number,
    decision: JevRoutingDecision,
    log: (fields: Record<string, unknown>, message: string) => void,
  ): void {
    const snapshot = decision.snapshot;
    if (!snapshot) return;
    log(
      {
        event: "jev_routing_decision",
        recipeId,
        analysisAttempt: attempt,
        ...snapshot,
      },
      "Jev routing decision",
    );
  }

  private logJevOutcome(
    recipeId: string,
    attempt: number,
    decision: JevRoutingDecision,
    trace: RouteExecutionTrace | null,
    finalAnalysisStatus: "completed" | "not_recipe" | "pending" | "failed",
    log: (fields: Record<string, unknown>, message: string) => void,
  ): void {
    const snapshot = decision.snapshot;
    if (!snapshot?.jevSucceeded) return;
    log(
      {
        event: "jev_routing_outcome",
        recipeId,
        analysisAttempt: attempt,
        sourceType: snapshot.sourceType,
        mediaKind: snapshot.mediaKind,
        jevModel: snapshot.jevModel,
        recipeProbability: snapshot.recipeProbability,
        nonRecipeProbability: snapshot.nonRecipeProbability,
        thresholdName: snapshot.thresholdName,
        thresholdValue: snapshot.thresholdValue,
        selectedRoute: snapshot.selectedRoute,
        finalRoute: trace?.finalRoute ?? decision.selectedRoute,
        textExtractionComplete: trace?.textExtractionComplete ?? false,
        mediaFallbackUsed: trace?.mediaFallbackUsed ?? false,
        finalAnalysisStatus,
      },
      "Jev routing outcome",
    );
  }

  private async completeAnalysis(
    recipeId: string,
    runId: string,
    thumbnail: AiSharedRecipeThumbnailResult,
    log: (fields: Record<string, unknown>, message: string) => void,
  ): Promise<boolean> {
    try {
      const updated = await this.deps.prisma.recipe.updateMany({
        where: {
          id: recipeId,
          analysisStatus: "processing",
          processingRunId: runId,
        },
        data: {
          imageUrl: thumbnail.imageUrl,
          analysisStatus: "completed",
          processingRunId: null,
          processingLeaseExpiresAt: null,
          updatedAt: new Date(),
        },
      });
      if (updated.count === 1) {
        if (thumbnail.publishedImage)
          log({ recipeId }, "AI shared recipe thumbnail generated");
        return true;
      }
      if (thumbnail.publishedImage)
        await this.cleanupPublishedImage(
          recipeId,
          thumbnail.publishedImage,
          log,
        );
      return false;
    } catch (error) {
      if (thumbnail.publishedImage)
        await this.cleanupPublishedImage(
          recipeId,
          thumbnail.publishedImage,
          log,
        );
      throw error;
    }
  }

  private async cleanupPublishedImage(
    recipeId: string,
    image: PublishedGeneratedRecipeImage,
    log: (fields: Record<string, unknown>, message: string) => void,
  ): Promise<void> {
    try {
      await image.delete();
    } catch (error) {
      log(
        {
          recipeId,
          imageUrl: image.url,
          errorCode: "AI_SHARED_THUMBNAIL_CLEANUP_FAILED",
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "AI shared recipe thumbnail cleanup failed",
      );
    }
  }

  private async claim(
    recipeId: string,
    runId: string,
    attempt: number,
  ): Promise<boolean> {
    return this.deps.prisma.$transaction(async (tx) => {
      const [clock] = await tx.$queryRaw<
        Array<{ now: Date }>
      >`SELECT clock_timestamp() AS now`;
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
            ...(attempt > 1
              ? [
                  {
                    analysisStatus: "processing" as const,
                    processingLeaseExpiresAt: null,
                  },
                ]
              : []),
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
        current.analysisStatus !== "failed" &&
        current.analysisStatus !== "not_recipe",
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

function combineExtractionResults(
  textResult: RecipeExtractionResult,
  mediaResult: RecipeExtractionResult,
): RecipeExtractionResult {
  return {
    ...mediaResult,
    inputTokens: textResult.inputTokens + mediaResult.inputTokens,
    outputTokens: textResult.outputTokens + mediaResult.outputTokens,
    latencyMs: textResult.latencyMs + mediaResult.latencyMs,
  };
}
