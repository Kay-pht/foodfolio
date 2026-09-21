import { createHash } from "node:crypto";
import { assessYoutubeDescription } from "../../domain/recipe/youtube-description-sufficiency.js";
import {
  RecipeContentClassifierError,
  type RecipeContentClassifier,
  type SourceContent,
} from "./types.js";

export interface JevRoutingThresholds {
  generalWebNonRecipe: number;
  youtubeRecipe: number;
  instagramRecipe: number;
  tiktokVideoRecipe: number;
  tiktokPhotoRecipe: number;
  aiChatNonRecipe: number;
}

export type JevSelectedRoute =
  | "not_recipe"
  | "text"
  | "youtube_video"
  | "instagram_media"
  | "tiktok_video"
  | "tiktok_photo_media"
  | "fail_open";

export interface JevRoutingSnapshot {
  sourceType: SourceContent["sourceType"];
  mediaKind: SourceContent["tiktokMediaKind"] | null;
  jevModel: string;
  recipeProbability: number | null;
  nonRecipeProbability: number | null;
  thresholdName: string;
  thresholdValue: number;
  thresholdMatched: boolean | null;
  selectedRoute: JevSelectedRoute;
  jevSucceeded: boolean;
  jevLatencyMs: number;
  jevFailureClass: string | null;
  inputChars: number;
  inputSha256: string;
}

export interface JevRoutingDecision {
  selectedRoute: JevSelectedRoute;
  snapshot: JevRoutingSnapshot | null;
}

export interface JevRoutingProvider {
  route(source: SourceContent): Promise<JevRoutingDecision>;
}

interface ThresholdRule {
  name: string;
  value: number;
  probability: "recipe" | "non_recipe";
}

export class JevRecipeRouter implements JevRoutingProvider {
  constructor(
    private readonly classifier: RecipeContentClassifier,
    private readonly thresholds: JevRoutingThresholds,
  ) {}

  async route(source: SourceContent): Promise<JevRoutingDecision> {
    if (source.sourceType === "youtube") {
      const assessment = assessYoutubeDescription(
        source.youtubeDescription ?? "",
      );
      if (!assessment.sufficient)
        return { selectedRoute: "youtube_video", snapshot: null };
    }

    const emptyTextRoute = routeForMissingText(source);
    const normalizedInput = normalizeJevInput(source.textForAi ?? "");
    if (!normalizedInput) {
      return {
        selectedRoute: emptyTextRoute ?? "fail_open",
        snapshot: null,
      };
    }

    const rule = thresholdRule(source, this.thresholds);
    const inputSha256 = createHash("sha256")
      .update(normalizedInput, "utf8")
      .digest("hex");

    try {
      const classification = await this.classifier.classify({
        sourceType: source.sourceType,
        text: normalizedInput,
      });
      const probability =
        rule.probability === "recipe"
          ? classification.recipeProbability
          : classification.nonRecipeProbability;
      const thresholdMatched = probability >= rule.value;
      const selectedRoute = routeForClassification(source, thresholdMatched);
      return {
        selectedRoute,
        snapshot: {
          sourceType: source.sourceType,
          mediaKind: source.tiktokMediaKind ?? null,
          jevModel: classification.model,
          recipeProbability: classification.recipeProbability,
          nonRecipeProbability: classification.nonRecipeProbability,
          thresholdName: rule.name,
          thresholdValue: rule.value,
          thresholdMatched,
          selectedRoute,
          jevSucceeded: true,
          jevLatencyMs: classification.latencyMs,
          jevFailureClass: null,
          inputChars: normalizedInput.length,
          inputSha256,
        },
      };
    } catch (error) {
      const classifierError =
        error instanceof RecipeContentClassifierError ? error : null;
      return {
        selectedRoute: "fail_open",
        snapshot: {
          sourceType: source.sourceType,
          mediaKind: source.tiktokMediaKind ?? null,
          jevModel: this.classifier.model,
          recipeProbability: null,
          nonRecipeProbability: null,
          thresholdName: rule.name,
          thresholdValue: rule.value,
          thresholdMatched: null,
          selectedRoute: "fail_open",
          jevSucceeded: false,
          jevLatencyMs: classifierError?.latencyMs ?? 0,
          jevFailureClass: classifierError?.failureClass ?? "unexpected",
          inputChars: normalizedInput.length,
          inputSha256,
        },
      };
    }
  }
}

export function normalizeJevInput(text: string): string {
  return text.replace(/\r\n?/gu, "\n").trim();
}

function routeForMissingText(source: SourceContent): JevSelectedRoute | null {
  if (source.sourceType === "instagram") return "instagram_media";
  if (source.sourceType !== "tiktok") return null;
  return source.tiktokMediaKind === "photo"
    ? "tiktok_photo_media"
    : "tiktok_video";
}

function thresholdRule(
  source: SourceContent,
  thresholds: JevRoutingThresholds,
): ThresholdRule {
  switch (source.sourceType) {
    case "youtube":
      return {
        name: "JEV_YOUTUBE_RECIPE_THRESHOLD",
        value: thresholds.youtubeRecipe,
        probability: "recipe",
      };
    case "instagram":
      return {
        name: "JEV_INSTAGRAM_RECIPE_THRESHOLD",
        value: thresholds.instagramRecipe,
        probability: "recipe",
      };
    case "tiktok":
      return source.tiktokMediaKind === "photo"
        ? {
            name: "JEV_TIKTOK_PHOTO_RECIPE_THRESHOLD",
            value: thresholds.tiktokPhotoRecipe,
            probability: "recipe",
          }
        : {
            name: "JEV_TIKTOK_VIDEO_RECIPE_THRESHOLD",
            value: thresholds.tiktokVideoRecipe,
            probability: "recipe",
          };
    case "chatgpt":
    case "gemini":
      return {
        name: "JEV_AI_CHAT_NON_RECIPE_THRESHOLD",
        value: thresholds.aiChatNonRecipe,
        probability: "non_recipe",
      };
    case "web":
    case "kurashiru":
    case "cookpad":
      return {
        name: "JEV_GENERAL_WEB_NON_RECIPE_THRESHOLD",
        value: thresholds.generalWebNonRecipe,
        probability: "non_recipe",
      };
  }
}

function routeForClassification(
  source: SourceContent,
  thresholdMatched: boolean,
): JevSelectedRoute {
  switch (source.sourceType) {
    case "web":
    case "kurashiru":
    case "cookpad":
    case "chatgpt":
    case "gemini":
      return thresholdMatched ? "not_recipe" : "text";
    case "youtube":
      return thresholdMatched ? "text" : "youtube_video";
    case "instagram":
      return thresholdMatched ? "text" : "instagram_media";
    case "tiktok":
      if (thresholdMatched) return "text";
      return source.tiktokMediaKind === "photo"
        ? "tiktok_photo_media"
        : "tiktok_video";
  }
}
