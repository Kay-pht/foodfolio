import { stat, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { YtDlpMediaRetriever } from "../../src/infrastructure/media/yt-dlp-media-retriever.js";

const baseConfig = {
  binaryPath: "/usr/local/bin/yt-dlp",
  maxAttempts: 3,
  attemptTimeoutMs: 45_000,
  retryBaseSeconds: 2,
  maxRetrySeconds: 10,
  maxBytes: 1024,
  maxFileSizeArgument: "1K",
  workDirectoryPrefix: "foodfolio-media-test-",
  outputFileName: "asset.jpg",
  kind: "image" as const,
  contentType: "image/jpeg",
  formatSelector: "best",
  validateUrl: (url: URL) => url.hostname === "example.com",
  invalidUrlError: {
    code: "MEDIA_URL_INVALID",
    retryable: false,
    message: "invalid media URL",
  },
  downloadFailedError: {
    code: "MEDIA_DOWNLOAD_FAILED",
    retryable: false,
    message: "media download failed",
  },
};

describe("YtDlpMediaRetriever", () => {
  it("returns a common media collection and preserves configured media kind", async () => {
    const retriever = new YtDlpMediaRetriever(
      baseConfig,
      async (_binary, sourceUrl, outputPath, timeoutMs, options) => {
        expect(sourceUrl).toBe("https://example.com/post/1");
        expect(timeoutMs).toBe(45_000);
        expect(options).toEqual({
          formatSelector: "best",
          maxFileSizeArgument: "1K",
        });
        await writeFile(outputPath, "image-data");
      },
    );

    const result = await retriever.retrieve(
      new URL("https://example.com/post/1"),
    );

    expect(result.attempts).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        index: 1,
        kind: "image",
        sizeBytes: 10,
        contentType: "image/jpeg",
      }),
    ]);
    await expect(stat(result.items[0]!.filePath)).resolves.toBeDefined();
    await result.dispose();
    await expect(stat(result.items[0]!.filePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("retries whole attempts and returns the configured failure after the cap", async () => {
    const delays: number[] = [];
    const runAttempt = vi.fn(async () => {
      throw new Error("failed");
    });
    const retriever = new YtDlpMediaRetriever(
      baseConfig,
      runAttempt,
      async (milliseconds) => {
        delays.push(milliseconds);
      },
    );

    await expect(
      retriever.retrieve(new URL("https://example.com/post/1")),
    ).rejects.toMatchObject({
      code: "MEDIA_DOWNLOAD_FAILED",
      retryable: false,
    });
    expect(runAttempt).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([2_000, 4_000]);
  });

  it("rejects invalid URLs before starting yt-dlp", async () => {
    const runAttempt = vi.fn();
    const retriever = new YtDlpMediaRetriever(baseConfig, runAttempt);

    await expect(
      retriever.retrieve(new URL("https://invalid.example/post/1")),
    ).rejects.toMatchObject({ code: "MEDIA_URL_INVALID" });
    expect(runAttempt).not.toHaveBeenCalled();
  });
});
