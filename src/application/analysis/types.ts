import type { SourceType } from "../../generated/prisma/client.js";

export interface SourceContent {
  sourceType: SourceType;
  resolvedUrl: string;
  imageUrl: string | null;
  textForAi: string | null;
  youtubeTitle?: string | null;
  youtubeDescription?: string | null;
  tiktokMediaKind?: "photo" | "video";
  tiktokPhotoImageUrls?: string[];
}
export interface ExtractedRecipe {
  title: string | null;
  servings: { value: number | null; raw: string | null } | null;
  cookingTimeMinutes: number | null;
  genre: string | null;
  ingredients: Array<{ name: string; amount: string | null }>;
  steps: string[];
}

export interface SourceContentExtractor {
  extract(url: URL): Promise<SourceContent>;
}

export interface RecipeContentClassification {
  model: string;
  choice: "recipe" | "non_recipe";
  recipeProbability: number;
  nonRecipeProbability: number;
  latencyMs: number;
}

export type RecipeContentClassifierFailureClass =
  | "timeout"
  | "network"
  | "http_429"
  | "http_529"
  | "http_error"
  | "body_read"
  | "invalid_response";

export class RecipeContentClassifierError extends Error {
  constructor(
    public readonly failureClass: RecipeContentClassifierFailureClass,
    public readonly latencyMs: number,
    message: string,
  ) {
    super(message);
    this.name = "RecipeContentClassifierError";
  }
}

export interface RecipeContentClassifier {
  readonly model: string;
  classify(input: {
    sourceType: SourceType;
    text: string;
  }): Promise<RecipeContentClassification>;
}
export interface RepresentativeImageResolver {
  resolveImageUrl(url: URL): Promise<string | null>;
}
export interface RecipeExtractionResult {
  recipe: ExtractedRecipe;
  provider: "zai" | "gemini";
  providerRequestId: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export type AiFailureStage =
  | "request_timeout"
  | "request_network"
  | "http_rate_limited"
  | "http_provider_error"
  | "http_rejected"
  | "response_envelope_invalid_json"
  | "content_missing"
  | "content_invalid_json"
  | "schema_invalid";

export type SourceFailureOperation =
  "source_fetch" | "tiktok_short_url" | "tiktok_oembed";
export type SourceFailureStage =
  | "request"
  | "redirect"
  | "response_status"
  | "response_body"
  | "response_size";
export type SourceFailureClass =
  | "timeout"
  | "network"
  | "redirect_missing_location"
  | "redirect_invalid_location"
  | "redirect_limit"
  | "http_error"
  | "response_too_large";

export type MediaFailureStage =
  | "metadata_probe"
  | "single_video_download"
  | "asset_download"
  | "asset_validate"
  | "publish"
  | "local_cleanup"
  | "published_cleanup";
export type MediaFailureClass =
  | "timeout"
  | "network"
  | "tool_error"
  | "invalid_response"
  | "http_error"
  | "body_missing"
  | "body_read"
  | "unsupported_content_type"
  | "too_large"
  | "empty_body"
  | "filesystem"
  | "storage"
  | "unknown";

export interface AnalysisFailureDiagnostics {
  aiFailureStage?: AiFailureStage;
  model?: string;
  latencyMs?: number;
  providerRequestId?: string;
  providerHttpStatus?: number;
  providerFinishReason?: string;
  responseContentChars?: number;
  inputTokens?: number;
  outputTokens?: number;
  maxOutputTokens?: number;
  schemaErrorCount?: number;
  schemaErrorKeywords?: string[];
  schemaErrorPaths?: string[];

  sourceOperation?: SourceFailureOperation;
  sourceFailureStage?: SourceFailureStage;
  sourceFailureClass?: SourceFailureClass;
  sourceHttpStatus?: number;
  sourceRedirectCount?: number;

  mediaFailureStage?: MediaFailureStage;
  mediaFailureClass?: MediaFailureClass;
  mediaHttpStatus?: number;
  mediaIndex?: number;
  mediaKind?: "image" | "video";
  mediaAttempt?: number;
  mediaMaxAttempts?: number;
}
export interface RecipeExtractor {
  extract(input: SourceContent): Promise<RecipeExtractionResult>;
}
export interface GeneratedRecipeImage {
  data: Uint8Array;
  contentType: string;
  extension: string;
}
export interface PublishedGeneratedRecipeImage {
  url: string;
  delete(): Promise<void>;
}
export interface RecipeThumbnailGenerator {
  generate(recipe: ExtractedRecipe): Promise<GeneratedRecipeImage>;
}
export interface GeneratedRecipeImageStore {
  publish(
    recipeId: string,
    image: GeneratedRecipeImage,
  ): Promise<PublishedGeneratedRecipeImage>;
  owns(imageUrl: string | null): boolean;
  deleteForRecipe(recipeId: string): Promise<void>;
}
export interface VideoRecipeExtractor {
  extractVideo(
    input: SourceContent,
    videoUrl: string,
  ): Promise<RecipeExtractionResult>;
}
export interface TikTokVideoRecipeFallback {
  extract(input: SourceContent): Promise<RecipeExtractionResult>;
}
export interface TikTokPhotoRecipeAnalysis {
  extract(input: SourceContent): Promise<RecipeExtractionResult>;
}
export interface InstagramVideoRecipeFallback {
  extract(input: SourceContent): Promise<RecipeExtractionResult>;
}
export interface InstagramMediaRecipeFallback {
  extract(input: SourceContent): Promise<RecipeExtractionResult>;
}

export type MediaKind = "image" | "video";

export interface MediaOperationErrorSpec {
  code: string;
  retryable: boolean;
  message: string;
}

export interface LocalMediaItem {
  index: number;
  kind: MediaKind;
  filePath: string;
  sizeBytes: number;
  contentType: string;
}

export interface MediaCollection {
  items: LocalMediaItem[];
  attempts: number;
  dispose(): Promise<void>;
}

export interface MediaRetriever {
  retrieve(url: URL): Promise<MediaCollection>;
}

export interface PublishedMedia {
  url: string;
  kind: MediaKind;
  contentType: string;
  dispose(): Promise<void>;
}

export interface OrderedPublishedMedia extends PublishedMedia {
  index: number;
}

export interface PublishedMediaCollection {
  items: OrderedPublishedMedia[];
  attempts: number;
  dispose(): Promise<void>;
}

export interface PublishedMediaRetriever {
  retrieve(url: URL): Promise<PublishedMediaCollection>;
}

export interface MediaRecipeExtractor {
  extractMedia(
    input: SourceContent,
    media: OrderedPublishedMedia[],
  ): Promise<RecipeExtractionResult>;
}

export interface TemporaryMediaStore {
  publish(media: LocalMediaItem): Promise<PublishedMedia>;
}

export interface DownloadedVideo {
  filePath: string;
  sizeBytes: number;
  attempts: number;
  dispose(): Promise<void>;
}
export interface TikTokVideoDownloader {
  download(url: URL): Promise<DownloadedVideo>;
}
export interface PublishedVideo {
  url: string;
  dispose(): Promise<void>;
}
export interface TemporaryVideoStore {
  publish(filePath: string): Promise<PublishedVideo>;
}
export const NOT_RECIPE_MESSAGE = "レシピとして判定できませんでした";

export interface NotificationSender {
  sendRecipeAnalysisCompleted(
    tokens: string[],
    recipeId: string,
    title: string,
  ): Promise<string[]>;
  sendRecipeAnalysisFailed(
    tokens: string[],
    recipeId: string,
    title: string,
  ): Promise<string[]>;
  sendRecipeAnalysisNotRecipe(
    tokens: string[],
    recipeId: string,
  ): Promise<string[]>;
}

export class AnalysisError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message: string,
    public readonly provider?: "zai" | "gemini",
    public readonly diagnostics?: AnalysisFailureDiagnostics,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}
