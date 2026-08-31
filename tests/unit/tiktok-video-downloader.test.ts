import { stat, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { YtDlpTikTokVideoDownloader } from "../../src/infrastructure/tiktok/yt-dlp-video-downloader.js";

const config = {
  binaryPath: "/usr/local/bin/yt-dlp",
  maxAttempts: 5,
  attemptTimeoutMs: 45_000,
  retryBaseSeconds: 2,
  maxRetrySeconds: 10,
};

describe("YtDlpTikTokVideoDownloader", () => {
  it("restarts the whole download and succeeds within five total attempts", async () => {
    let calls = 0;
    const delays: number[] = [];
    const downloader = new YtDlpTikTokVideoDownloader(
      config,
      async (_binary, sourceUrl, outputPath, timeoutMs) => {
        calls += 1;
        expect(sourceUrl).toBe("https://www.tiktok.com/@chef/video/123");
        expect(timeoutMs).toBe(45_000);
        if (calls < 3) throw new Error("temporary extraction failure");
        await writeFile(outputPath, "mp4-data");
      },
      async (milliseconds) => {
        delays.push(milliseconds);
      },
    );

    const result = await downloader.download(
      new URL("https://www.tiktok.com/@chef/video/123"),
    );

    expect(result.attempts).toBe(3);
    expect(result.sizeBytes).toBe(8);
    expect(delays).toEqual([2_000, 4_000]);
    await expect(stat(result.filePath)).resolves.toBeDefined();
    await result.dispose();
    await expect(stat(result.filePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stops after five failed attempts and returns a non-retryable error", async () => {
    const runAttempt = vi.fn(async () => {
      throw new Error("failed");
    });
    const downloader = new YtDlpTikTokVideoDownloader(
      config,
      runAttempt,
      async () => {},
    );

    await expect(
      downloader.download(new URL("https://www.tiktok.com/@chef/video/123")),
    ).rejects.toMatchObject({
      code: "TIKTOK_VIDEO_DOWNLOAD_FAILED",
      retryable: false,
    });
    expect(runAttempt).toHaveBeenCalledTimes(5);
  });

  it("rejects non-TikTok URLs without starting yt-dlp", async () => {
    const runAttempt = vi.fn();
    const downloader = new YtDlpTikTokVideoDownloader(config, runAttempt);

    await expect(
      downloader.download(new URL("https://example.com/video/123")),
    ).rejects.toMatchObject({ code: "TIKTOK_VIDEO_URL_INVALID" });
    expect(runAttempt).not.toHaveBeenCalled();
  });
});
