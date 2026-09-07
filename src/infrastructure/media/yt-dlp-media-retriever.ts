import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnalysisError,
  type MediaCollection,
  type MediaKind,
  type MediaRetriever,
} from "../../application/analysis/types.js";

export interface MediaRetrievalErrorSpec {
  code: string;
  retryable: boolean;
  message: string;
}

export interface YtDlpMediaRetrieverConfig {
  binaryPath: string;
  maxAttempts: number;
  attemptTimeoutMs: number;
  retryBaseSeconds: number;
  maxRetrySeconds: number;
  maxBytes: number;
  maxFileSizeArgument: string;
  workDirectoryPrefix: string;
  outputFileName: string;
  kind: MediaKind;
  contentType: string;
  formatSelector: string;
  validateUrl(url: URL): boolean;
  invalidUrlError: MediaRetrievalErrorSpec;
  downloadFailedError: MediaRetrievalErrorSpec;
}

export interface YtDlpAttemptOptions {
  formatSelector: string;
  maxFileSizeArgument: string;
}

export type YtDlpAttemptRunner = (
  binaryPath: string,
  sourceUrl: string,
  outputPath: string,
  timeoutMs: number,
  options: YtDlpAttemptOptions,
) => Promise<void>;

type Sleeper = (milliseconds: number) => Promise<void>;

export class YtDlpMediaRetriever implements MediaRetriever {
  constructor(
    private readonly config: YtDlpMediaRetrieverConfig,
    private readonly runAttempt: YtDlpAttemptRunner = runYtDlpAttempt,
    private readonly sleep: Sleeper = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async retrieve(url: URL): Promise<MediaCollection> {
    if (!this.config.validateUrl(url)) {
      throw toAnalysisError(this.config.invalidUrlError);
    }

    const workDirectory = await mkdtemp(
      join(tmpdir(), this.config.workDirectoryPrefix),
    );
    const outputPath = join(workDirectory, this.config.outputFileName);

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      await resetWorkDirectory(workDirectory);
      try {
        await this.runAttempt(
          this.config.binaryPath,
          url.toString(),
          outputPath,
          this.config.attemptTimeoutMs,
          {
            formatSelector: this.config.formatSelector,
            maxFileSizeArgument: this.config.maxFileSizeArgument,
          },
        );
        const metadata = await stat(outputPath);
        if (metadata.size < 1 || metadata.size > this.config.maxBytes) {
          throw new Error("downloaded media size is outside the allowed range");
        }
        return {
          items: [
            {
              index: 1,
              kind: this.config.kind,
              filePath: outputPath,
              sizeBytes: metadata.size,
              contentType: this.config.contentType,
            },
          ],
          attempts: attempt,
          dispose: () => rm(workDirectory, { recursive: true, force: true }),
        };
      } catch {
        if (attempt === this.config.maxAttempts) {
          await rm(workDirectory, { recursive: true, force: true });
          throw toAnalysisError(this.config.downloadFailedError);
        }
        const retrySeconds = Math.min(
          this.config.retryBaseSeconds * attempt,
          this.config.maxRetrySeconds,
        );
        await this.sleep(retrySeconds * 1000);
      }
    }

    throw toAnalysisError(this.config.downloadFailedError);
  }
}

async function resetWorkDirectory(workDirectory: string): Promise<void> {
  await rm(workDirectory, { recursive: true, force: true });
  await mkdir(workDirectory, { recursive: true });
}

function toAnalysisError(spec: MediaRetrievalErrorSpec): AnalysisError {
  return new AnalysisError(spec.code, spec.retryable, spec.message);
}

export async function runYtDlpAttempt(
  binaryPath: string,
  sourceUrl: string,
  outputPath: string,
  timeoutMs: number,
  options: YtDlpAttemptOptions,
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
        options.maxFileSizeArgument,
        "-f",
        options.formatSelector,
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
