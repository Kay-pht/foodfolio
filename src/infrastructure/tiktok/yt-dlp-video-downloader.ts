import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnalysisError,
  type DownloadedVideo,
  type TikTokVideoDownloader,
} from "../../application/analysis/types.js";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export interface YtDlpDownloaderConfig {
  binaryPath: string;
  maxAttempts: number;
  attemptTimeoutMs: number;
  retryBaseSeconds: number;
  maxRetrySeconds: number;
}

type AttemptRunner = (
  binaryPath: string,
  sourceUrl: string,
  outputPath: string,
  timeoutMs: number,
) => Promise<void>;

type Sleeper = (milliseconds: number) => Promise<void>;

export class YtDlpTikTokVideoDownloader implements TikTokVideoDownloader {
  constructor(
    private readonly config: YtDlpDownloaderConfig,
    private readonly runAttempt: AttemptRunner = runYtDlpAttempt,
    private readonly sleep: Sleeper = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async download(url: URL): Promise<DownloadedVideo> {
    if (!isTikTokUrl(url))
      throw new AnalysisError(
        "TIKTOK_VIDEO_URL_INVALID",
        false,
        "TikTok video fallback received an invalid URL",
      );

    const workDirectory = await mkdtemp(
      join(tmpdir(), "foodfolio-tiktok-video-"),
    );
    const outputPath = join(workDirectory, "video.mp4");

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      await removeAttemptArtifacts(outputPath);
      try {
        await this.runAttempt(
          this.config.binaryPath,
          url.toString(),
          outputPath,
          this.config.attemptTimeoutMs,
        );
        const metadata = await stat(outputPath);
        if (metadata.size < 1 || metadata.size > MAX_VIDEO_BYTES)
          throw new Error("downloaded video size is outside the allowed range");
        return {
          filePath: outputPath,
          sizeBytes: metadata.size,
          attempts: attempt,
          dispose: () => rm(workDirectory, { recursive: true, force: true }),
        };
      } catch {
        if (attempt === this.config.maxAttempts) {
          await rm(workDirectory, { recursive: true, force: true });
          throw new AnalysisError(
            "TIKTOK_VIDEO_DOWNLOAD_FAILED",
            false,
            `TikTok video download failed after ${this.config.maxAttempts} attempts`,
          );
        }
        const retrySeconds = Math.min(
          this.config.retryBaseSeconds * attempt,
          this.config.maxRetrySeconds,
        );
        await this.sleep(retrySeconds * 1000);
      }
    }

    throw new AnalysisError(
      "TIKTOK_VIDEO_DOWNLOAD_FAILED",
      false,
      "TikTok video download failed",
    );
  }
}

async function removeAttemptArtifacts(outputPath: string): Promise<void> {
  await Promise.all([
    rm(outputPath, { force: true }),
    rm(`${outputPath}.part`, { force: true }),
    rm(`${outputPath}.ytdl`, { force: true }),
  ]);
}

function isTikTokUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    (host === "tiktok.com" || host.endsWith(".tiktok.com"))
  );
}

async function runYtDlpAttempt(
  binaryPath: string,
  sourceUrl: string,
  outputPath: string,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      binaryPath,
      [
        "--no-playlist",
        "--no-cache-dir",
        "--no-progress",
        "--no-warnings",
        "--retries",
        "3",
        "--fragment-retries",
        "3",
        "--extractor-retries",
        "3",
        "--sleep-requests",
        "1",
        "--max-filesize",
        "100M",
        "-f",
        "b[ext=mp4]",
        "-o",
        outputPath,
        sourceUrl,
      ],
      { stdio: "ignore" },
    );
    const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error("yt-dlp process failed"));
    });
  });
}
