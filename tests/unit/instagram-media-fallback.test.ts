import { describe, expect, it, vi } from "vitest";
import type {
  LocalMediaItem,
  MediaRecipeExtractor,
  MediaRetriever,
  TemporaryMediaStore,
} from "../../src/application/analysis/types.js";
import { ProductionInstagramMediaRecipeFallback } from "../../src/infrastructure/instagram/instagram-media-recipe-fallback.js";

const source = {
  sourceType: "instagram" as const,
  resolvedUrl: "https://www.instagram.com/p/example/",
  imageUrl: null,
  textForAi: "DESCRIPTION\nパスタ",
};

const extraction = {
  recipe: {
    title: "パスタ",
    servings: null,
    cookingTimeMinutes: null,
    genre: "麺",
    ingredients: [{ name: "パスタ", amount: "100g" }],
    steps: ["茹でる"],
  },
  provider: "zai" as const,
  providerRequestId: "media-request",
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 30,
};

const items = [
  {
    index: 1,
    kind: "image" as const,
    filePath: "/tmp/1.jpg",
    sizeBytes: 100,
    contentType: "image/jpeg",
  },
  {
    index: 2,
    kind: "video" as const,
    filePath: "/tmp/2.mp4",
    sizeBytes: 200,
    contentType: "video/mp4",
  },
];

describe("ProductionInstagramMediaRecipeFallback", () => {
  it("publishes every item in post order, analyzes the full collection, and cleans up", async () => {
    const disposeDownload = vi.fn(async () => {});
    const disposePublished = [vi.fn(async () => {}), vi.fn(async () => {})];
    const mediaRetriever: MediaRetriever = {
      retrieve: vi.fn(async () => ({
        items,
        attempts: 1,
        dispose: disposeDownload,
      })),
    };
    const mediaStore: TemporaryMediaStore = {
      publish: vi.fn(async (item: LocalMediaItem) => ({
        url: `https://storage.example/${item.index}`,
        kind: item.kind,
        contentType: item.contentType,
        dispose: disposePublished[item.index - 1]!,
      })),
    };
    const extractMedia = vi.fn(async () => extraction);
    const recipeExtractor: MediaRecipeExtractor = { extractMedia };
    const fallback = new ProductionInstagramMediaRecipeFallback(
      mediaRetriever,
      mediaStore,
      recipeExtractor,
    );

    await expect(fallback.extract(source)).resolves.toEqual(extraction);
    expect(mediaStore.publish).toHaveBeenNthCalledWith(1, items[0]);
    expect(mediaStore.publish).toHaveBeenNthCalledWith(2, items[1]);
    expect(extractMedia).toHaveBeenCalledWith(source, [
      expect.objectContaining({ index: 1, kind: "image" }),
      expect.objectContaining({ index: 2, kind: "video" }),
    ]);
    expect(disposePublished[0]).toHaveBeenCalledOnce();
    expect(disposePublished[1]).toHaveBeenCalledOnce();
    expect(disposeDownload).toHaveBeenCalledOnce();
  });

  it("cleans already-published objects and local media when a later publish fails", async () => {
    const disposeDownload = vi.fn(async () => {});
    const disposePublished = vi.fn(async () => {});
    const publish = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://storage.example/1",
        kind: "image",
        contentType: "image/jpeg",
        dispose: disposePublished,
      })
      .mockRejectedValueOnce(new Error("publish failed"));
    const fallback = new ProductionInstagramMediaRecipeFallback(
      {
        retrieve: async () => ({ items, attempts: 1, dispose: disposeDownload }),
      },
      { publish },
      { extractMedia: vi.fn() },
    );

    await expect(fallback.extract(source)).rejects.toThrow("publish failed");
    expect(disposePublished).toHaveBeenCalledOnce();
    expect(disposeDownload).toHaveBeenCalledOnce();
  });

  it("cleans every copy when multimodal AI analysis fails", async () => {
    const disposeDownload = vi.fn(async () => {});
    const disposePublished = vi.fn(async () => {});
    const fallback = new ProductionInstagramMediaRecipeFallback(
      {
        retrieve: async () => ({
          items: [items[0]!],
          attempts: 1,
          dispose: disposeDownload,
        }),
      },
      {
        publish: async () => ({
          url: "https://storage.example/1",
          kind: "image",
          contentType: "image/jpeg",
          dispose: disposePublished,
        }),
      },
      {
        extractMedia: async () => {
          throw new Error("provider failed");
        },
      },
    );

    await expect(fallback.extract(source)).rejects.toThrow("provider failed");
    expect(disposePublished).toHaveBeenCalledOnce();
    expect(disposeDownload).toHaveBeenCalledOnce();
  });

  it("rejects a collection with a missing index instead of partially analyzing it", async () => {
    const disposeDownload = vi.fn(async () => {});
    const fallback = new ProductionInstagramMediaRecipeFallback(
      {
        retrieve: async () => ({
          items: [{ ...items[1]!, index: 2 }],
          attempts: 1,
          dispose: disposeDownload,
        }),
      },
      { publish: vi.fn() },
      { extractMedia: vi.fn() },
    );

    await expect(fallback.extract(source)).rejects.toMatchObject({
      code: "INSTAGRAM_MEDIA_COLLECTION_INVALID",
      retryable: false,
    });
    expect(disposeDownload).toHaveBeenCalledOnce();
  });
});
