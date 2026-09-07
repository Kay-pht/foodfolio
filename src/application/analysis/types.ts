import type { SourceType } from "../../generated/prisma/client.js";

export interface SourceContent {
  sourceType: SourceType;
  resolvedUrl: string;
  imageUrl: string | null;
  textForAi: string | null;
  youtubeTitle?: string | null;
  youtubeDescription?: string | null;
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
export interface RecipeExtractionResult {
  recipe: ExtractedRecipe;
  provider: "zai" | "gemini";
  providerRequestId: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}
export interface RecipeExtractor {
  extract(input: SourceContent): Promise<RecipeExtractionResult>;
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
}

export class AnalysisError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message: string,
    public readonly provider?: "zai" | "gemini",
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}
