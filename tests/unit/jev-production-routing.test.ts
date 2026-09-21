import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  JevRecipeRouter,
  normalizeJevInput,
  type JevRoutingThresholds,
} from "../../src/application/analysis/jev-routing.js";
import {
  RecipeContentClassifierError,
  type RecipeContentClassification,
  type RecipeContentClassifier,
  type SourceContent,
} from "../../src/application/analysis/types.js";

const thresholds: JevRoutingThresholds = {
  generalWebNonRecipe: 0.8,
  youtubeRecipe: 0.99,
  instagramRecipe: 0.99,
  tiktokVideoRecipe: 0.99,
  tiktokPhotoRecipe: 0.99,
  aiChatNonRecipe: 0.99,
};

const classification = (
  recipeProbability: number,
  nonRecipeProbability: number,
): RecipeContentClassification => ({
  model: "jev-1.13.0",
  choice: recipeProbability >= nonRecipeProbability ? "recipe" : "non_recipe",
  recipeProbability,
  nonRecipeProbability,
  latencyMs: 25,
});

const source = (
  sourceType: SourceContent["sourceType"],
  textForAi: string | null,
  extra: Partial<SourceContent> = {},
): SourceContent => ({
  sourceType,
  resolvedUrl: "https://example.com/source",
  imageUrl: null,
  textForAi,
  ...extra,
});

function routerFor(result: RecipeContentClassification) {
  const classify = vi.fn(async () => result);
  const classifier: RecipeContentClassifier = {
    model: "jev-1.13.0",
    classify,
  };
  return { router: new JevRecipeRouter(classifier, thresholds), classify };
}

describe("JevRecipeRouter", () => {
  it("hard-rejects general Web only at the configured non-recipe threshold", async () => {
    const rejected = routerFor(classification(0.2, 0.8));
    await expect(
      rejected.router.route(
        source("web", "A food story without recipe keywords"),
      ),
    ).resolves.toMatchObject({ selectedRoute: "not_recipe" });
    expect(rejected.classify).toHaveBeenCalledOnce();

    const accepted = routerFor(classification(0.21, 0.79));
    await expect(
      accepted.router.route(
        source("web", "A food story without recipe keywords"),
      ),
    ).resolves.toMatchObject({ selectedRoute: "text" });
  });

  it("does not reject AI chat when recipe probability is around 0.77", async () => {
    const { router } = routerFor(classification(0.77, 0.23));
    await expect(
      router.route(source("chatgpt", "serialized shared conversation")),
    ).resolves.toMatchObject({ selectedRoute: "text" });
  });

  it("hard-rejects AI chat only when non-recipe reaches 0.99", async () => {
    const { router } = routerFor(classification(0.01, 0.99));
    await expect(
      router.route(source("gemini", "serialized shared conversation")),
    ).resolves.toMatchObject({ selectedRoute: "not_recipe" });
  });

  it("bypasses Jev for insufficient YouTube descriptions", async () => {
    const { router, classify } = routerFor(classification(1, 0));
    const decision = await router.route(
      source("youtube", "TITLE\nShort clip", {
        youtubeDescription: "概要だけ",
      }),
    );
    expect(decision).toEqual({
      selectedRoute: "youtube_video",
      snapshot: null,
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it("routes sufficient YouTube descriptions by recipe probability", async () => {
    const description =
      "材料\n豚肉 200g\n白菜 1/4個\n作り方\n1. 白菜を切る\n2. 豚肉を炒める";
    const fast = routerFor(classification(0.99, 0.01));
    await expect(
      fast.router.route(
        source("youtube", `TITLE\n豚バラ白菜\n\nDESCRIPTION\n${description}`, {
          youtubeDescription: description,
        }),
      ),
    ).resolves.toMatchObject({ selectedRoute: "text" });

    const media = routerFor(classification(0.98, 0.02));
    await expect(
      media.router.route(
        source("youtube", `TITLE\n豚バラ白菜\n\nDESCRIPTION\n${description}`, {
          youtubeDescription: description,
        }),
      ),
    ).resolves.toMatchObject({ selectedRoute: "youtube_video" });
  });

  it("routes Instagram text by probability and bypasses Jev only for empty text", async () => {
    const fast = routerFor(classification(0.99, 0.01));
    await expect(
      fast.router.route(source("instagram", "caption without recipe keywords")),
    ).resolves.toMatchObject({ selectedRoute: "text" });

    const media = routerFor(classification(0.98, 0.02));
    await expect(
      media.router.route(
        source("instagram", "caption without recipe keywords"),
      ),
    ).resolves.toMatchObject({ selectedRoute: "instagram_media" });

    const empty = routerFor(classification(1, 0));
    await expect(
      empty.router.route(source("instagram", "   ")),
    ).resolves.toEqual({
      selectedRoute: "instagram_media",
      snapshot: null,
    });
    expect(empty.classify).not.toHaveBeenCalled();
  });

  it.each([
    ["video", 0.99, "text"],
    ["video", 0.98, "tiktok_video"],
    ["photo", 0.99, "text"],
    ["photo", 0.98, "tiktok_photo_media"],
  ] as const)(
    "routes TikTok %s with recipe probability %s to %s",
    async (mediaKind, recipeProbability, selectedRoute) => {
      const { router } = routerFor(
        classification(recipeProbability, 1 - recipeProbability),
      );
      await expect(
        router.route(
          source("tiktok", "caption text", { tiktokMediaKind: mediaKind }),
        ),
      ).resolves.toMatchObject({ selectedRoute });
    },
  );

  it("fails open without retrying and logs a hash of the exact normalized input", async () => {
    const classify = vi.fn(async () => {
      throw new RecipeContentClassifierError("timeout", 3001, "timed out");
    });
    const classifier: RecipeContentClassifier = {
      model: "jev-1.13.0",
      classify,
    };
    const router = new JevRecipeRouter(classifier, thresholds);
    const raw = "  line one\r\nline two  ";
    const normalized = normalizeJevInput(raw);

    const decision = await router.route(source("web", raw));

    expect(classify).toHaveBeenCalledOnce();
    expect(classify).toHaveBeenCalledWith({
      sourceType: "web",
      text: normalized,
    });
    expect(decision).toMatchObject({
      selectedRoute: "fail_open",
      snapshot: {
        jevSucceeded: false,
        jevFailureClass: "timeout",
        inputChars: normalized.length,
        inputSha256: createHash("sha256")
          .update(normalized, "utf8")
          .digest("hex"),
      },
    });
  });
});
