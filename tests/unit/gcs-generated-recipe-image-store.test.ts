import type { Storage } from "@google-cloud/storage";
import { describe, expect, it, vi } from "vitest";
import { GcsGeneratedRecipeImageStore } from "../../src/infrastructure/media/gcs-generated-recipe-image-store.js";

describe("GcsGeneratedRecipeImageStore", () => {
  it("stores a generated image under the recipe prefix and returns a public object URL", async () => {
    const save = vi.fn(async () => {});
    const deleteObject = vi.fn(async () => {});
    const file = vi.fn(() => ({ save, delete: deleteObject }));
    const deleteFiles = vi.fn(async () => {});
    const storage = {
      bucket: vi.fn(() => ({ file, deleteFiles })),
    } as unknown as Storage;
    const store = new GcsGeneratedRecipeImageStore(
      "foodfolio-generated-images",
      storage,
    );

    const url = await store.publish("recipe-id", {
      data: new Uint8Array([1, 2, 3]),
      contentType: "image/webp",
      extension: "webp",
    });

    expect(file).toHaveBeenCalledWith(
      expect.stringMatching(/^recipe-images\/recipe-id\/.+\.webp$/),
    );
    expect(save).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        metadata: {
          contentType: "image/webp",
          cacheControl: "public, no-store, max-age=0",
        },
        resumable: false,
        validation: "crc32c",
      }),
    );
    expect(url).toMatch(
      /^https:\/\/storage\.googleapis\.com\/foodfolio-generated-images\/recipe-images\/recipe-id\/.+\.webp$/,
    );
    expect(store.owns(url)).toBe(true);
    expect(store.owns("https://example.com/other.webp")).toBe(false);
  });

  it("deletes every generated object under one recipe prefix", async () => {
    const deleteFiles = vi.fn(async () => {});
    const storage = {
      bucket: vi.fn(() => ({
        file: vi.fn(),
        deleteFiles,
      })),
    } as unknown as Storage;
    const store = new GcsGeneratedRecipeImageStore(
      "foodfolio-generated-images",
      storage,
    );

    await store.deleteForRecipe("recipe-id");

    expect(deleteFiles).toHaveBeenCalledWith({
      prefix: "recipe-images/recipe-id/",
      force: true,
    });
  });

  it("cleans up a partially written object after upload failure", async () => {
    const save = vi.fn(async () => {
      throw new Error("upload failed");
    });
    const deleteObject = vi.fn(async () => {});
    const storage = {
      bucket: vi.fn(() => ({
        file: vi.fn(() => ({ save, delete: deleteObject })),
      })),
    } as unknown as Storage;
    const store = new GcsGeneratedRecipeImageStore(
      "foodfolio-generated-images",
      storage,
    );

    await expect(
      store.publish("recipe-id", {
        data: new Uint8Array([1]),
        contentType: "image/webp",
        extension: "webp",
      }),
    ).rejects.toThrow("Generated recipe image upload failed");
    expect(deleteObject).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});
