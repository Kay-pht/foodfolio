import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnalysisError,
  type AnalysisFailureDiagnostics,
  type MediaCollection,
  type MediaFailureStage,
  type MediaKind,
  type MediaOperationErrorSpec,
  type MediaRetriever,
} from "../../application/analysis/types.js";

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
  invalidUrlError: MediaOperationErrorSpec;
  downloadFailedError: MediaOperationErrorSpec;
  downloadFailureStage?: MediaFailureStage;
  localPrepareError?: MediaOperationErrorSpec;
  localCleanupError?: MediaOperationErrorSpec;
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

export interface YtDlpMediaFilesystem {
  createWorkDirectory(prefix: string): Promise<string>;
  clearWorkDirectory(workDirectory: string): Promise<void>;
  removeWorkDirectory(workDirectory: string): Promise<void>;
}

const defaultFilesystem: YtDlpMediaFilesystem = {
  createWorkDirectory: (prefix) => mkdtemp(join(tmpdir(), prefix)),
  clearWorkDirectory,
  removeWorkDirectory: (workDirectory) =>
    rm(workDirectory, { recursive: true, force: true }),
};

export class YtDlpMediaRetriever implements MediaRetriever {
  constructor(
    private readonly config: YtDlpMediaRetrieverConfig,
    private readonly runAttempt: YtDlpAttemptRunner = runYtDlpAttempt,
    private readonly sleep: Sleeper = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly filesystem: YtDlpMediaFilesystem = defaultFilesystem,
  ) {}

  async retrieve(url: URL): Promise<MediaCollection> {
    if (!this.config.validateUrl(url)) {
      throw toAnalysisError(this.config.invalidUrlError);
    }

    let workDirectory: string;
    try {
      workDirectory = await this.filesystem.createWorkDirectory(
        this.config.workDirectoryPrefix,
      );
    } catch (error) {
      throw this.localFilesystemFailure(
        error,
        "local_prepare",
        this.config.localPrepareError,
      );
    }
    const outputPath = join(workDirectory, this.config.outputFileName);

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      try {
        await this.filesystem.clearWorkDirectory(workDirectory);
      } catch (error) {
        throw this.localFilesystemFailure(
          error,
          "local_cleanup",
          this.config.localCleanupError,
          attempt,
        );
      }
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
          dispose: async () => {
            try {
              await this.filesystem.removeWorkDirectory(workDirectory);
            } catch (error) {
              throw this.localFilesystemFailure(
                error,
                "local_cleanup",
                this.config.localCleanupError,
                attempt,
              );
            }
          },
        };
      } catch (error) {
        if (attempt === this.config.maxAttempts) {
          try {
            await this.filesystem.removeWorkDirectory(workDirectory);
          } catch (cleanupError) {
            throw this.localFilesystemFailure(
              cleanupError,
              "local_cleanup",
              this.config.localCleanupError,
              attempt,
            );
          }
          throw toAnalysisError(
            this.config.downloadFailedError,
            this.config.downloadFailureStage
              ? {
                  mediaFailureStage: this.config.downloadFailureStage,
                  mediaFailureClass: isTimeoutFailure(error)
                    ? "timeout"
                    : "unknown",
                  mediaIndex: 1,
                  mediaKind: this.config.kind,
                  mediaAttempt: attempt,
                  mediaMaxAttempts: this.config.maxAttempts,
                }
              : undefined,
          );
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

  private localFilesystemFailure(
    error: unknown,
    stage: "local_prepare" | "local_cleanup",
    spec?: MediaOperationErrorSpec,
    attempt?: number,
  ): unknown {
    if (!spec) return error;
    return new AnalysisError(
      spec.code,
      spec.retryable,
      spec.message,
      undefined,
      {
        mediaFailureStage: stage,
        mediaFailureClass: "filesystem",
        mediaIndex: 1,
        mediaKind: this.config.kind,
        ...(attempt !== undefined
          ? {
              mediaAttempt: attempt,
              mediaMaxAttempts: this.config.maxAttempts,
            }
          : {}),
      },
    );
  }
}

async function clearWorkDirectory(workDirectory: string): Promise<void> {
  const entries = await readdir(workDirectory);
  await Promise.all(
    entries.map((entry) =>
      rm(join(workDirectory, entry), { recursive: true, force: true }),
    ),
  );
}

function toAnalysisError(
  spec: MediaOperationErrorSpec,
  diagnostics?: AnalysisFailureDiagnostics,
): AnalysisError {
  return new AnalysisError(
    spec.code,
    spec.retryable,
    spec.message,
    undefined,
    diagnostics,
  );
}

function isTimeoutFailure(error: unknown): boolean {
  let current = error;
  const seen = new Set<object>();
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return false;
    if (seen.has(current)) return false;
    seen.add(current);
    const record = current as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : null;
    const code = typeof record.code === "string" ? record.code : null;
    if (
      name === "TimeoutError" ||
      name === "AbortError" ||
      code === "ETIMEDOUT" ||
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      code === "UND_ERR_HEADERS_TIMEOUT" ||
      code === "UND_ERR_BODY_TIMEOUT" ||
      (record.killed === true && record.signal === "SIGKILL")
    )
      return true;
    current = record.cause;
  }
  return false;
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
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      if (timedOut) {
        const error = Object.assign(new Error("yt-dlp process timed out"), {
          name: "TimeoutError",
          code: "ETIMEDOUT",
          killed: true,
          signal: signal ?? "SIGKILL",
        });
        reject(error);
        return;
      }
      reject(new Error("yt-dlp process failed"));
    });
  });
}
