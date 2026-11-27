import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import type { Readable } from "node:stream";
import {
  AnalysisError,
  type AnalysisFailureDiagnostics,
  type MediaCollection,
  type MediaAccessRestriction,
  type MediaFailureStage,
  type MediaKind,
  type MediaOperationErrorSpec,
  type MediaRetriever,
  type PublishedMedia,
} from "../../application/analysis/types.js";

import {
  classifyYtDlpAccessRestriction,
  MAX_YT_DLP_DIAGNOSTIC_BYTES,
  YtDlpAccessRestrictionError,
} from "./yt-dlp-access-restriction.js";

import {
  transferVideo,
  VideoSizeError,
  VideoSourceError,
  type VideoStreamPublisher,
} from "./video-stream.js";

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
  classifyAccessRestriction?: (
    error: unknown,
  ) => MediaAccessRestriction | undefined;
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
        const restriction = isTimeoutFailure(error)
          ? undefined
          : this.config.classifyAccessRestriction?.(error);
        if (restriction || attempt === this.config.maxAttempts) {
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
            restriction
              ? {
                  ...this.config.downloadFailedError,
                  retryable: false,
                  message: "Media access is restricted",
                }
              : this.config.downloadFailedError,
            this.config.downloadFailureStage
              ? {
                  mediaFailureStage: this.config.downloadFailureStage,
                  mediaFailureClass:
                    restriction ??
                    (isTimeoutFailure(error) ? "timeout" : "unknown"),
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

  async publishVideo(
    url: URL,
    publish: VideoStreamPublisher,
  ): Promise<{ media: PublishedMedia; attempts: number }> {
    if (!this.config.validateUrl(url))
      throw toAnalysisError(this.config.invalidUrlError);
    const options = {
      formatSelector: this.config.formatSelector,
      maxFileSizeArgument: this.config.maxFileSizeArgument,
    };
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      try {
        const media = await publish(
          { index: 1, kind: "video", contentType: this.config.contentType },
          (destination) =>
            runYtDlpAttempt(
              this.config.binaryPath,
              url.toString(),
              (stdout, exited) =>
                transferVideo(
                  stdout,
                  destination,
                  this.config.maxBytes,
                  exited,
                ),
              this.config.attemptTimeoutMs,
              options,
            ),
        );
        return { media, attempts: attempt };
      } catch (error) {
        const sourceError =
          error instanceof VideoSourceError ? error.cause : error;
        const timedOut = isTimeoutFailure(sourceError);
        const restriction = timedOut
          ? undefined
          : this.config.classifyAccessRestriction?.(sourceError);
        const classification =
          error instanceof VideoSizeError ? error.classification : restriction;
        if (error instanceof AnalysisError) {
          if (!error.retryable || attempt === this.config.maxAttempts) {
            if (!this.config.downloadFailureStage) throw error;
            throw new AnalysisError(
              error.code,
              error.retryable,
              error.message,
              error.provider,
              {
                mediaFailureStage: "publish",
                mediaFailureClass: "storage",
                ...error.diagnostics,
                mediaIndex: 1,
                mediaKind: "video",
                mediaAttempt: attempt,
                mediaMaxAttempts: this.config.maxAttempts,
              },
            );
          }
        } else if (classification || attempt === this.config.maxAttempts) {
          throw toAnalysisError(
            this.config.downloadFailedError,
            this.config.downloadFailureStage
              ? {
                  mediaFailureStage: this.config.downloadFailureStage,
                  mediaFailureClass:
                    classification ?? (timedOut ? "timeout" : "unknown"),
                  mediaIndex: 1,
                  mediaKind: "video",
                  mediaAttempt: attempt,
                  mediaMaxAttempts: this.config.maxAttempts,
                }
              : undefined,
          );
        }
        await this.sleep(
          Math.min(
            this.config.retryBaseSeconds * attempt,
            this.config.maxRetrySeconds,
          ) * 1000,
        );
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

const MAX_FRAGMENT_FILE_BYTES = 32 * 1024 * 1024;

type YtDlpOutput =
  string | ((stdout: Readable, exited: Promise<void>) => Promise<void>);

export async function runYtDlpAttempt(
  binaryPath: string,
  sourceUrl: string,
  output: YtDlpOutput,
  timeoutMs: number,
  options: YtDlpAttemptOptions,
): Promise<void> {
  if (typeof output === "string") {
    return runYtDlpProcess(binaryPath, sourceUrl, output, timeoutMs, options);
  }

  let scratchDirectory: string;
  try {
    scratchDirectory = await mkdtemp(
      join(tmpdir(), "foodfolio-video-fragments-"),
    );
  } catch {
    throw scratchFailure("local_prepare", true);
  }
  const command = binaryPath.includes("/")
    ? resolvePath(binaryPath)
    : binaryPath;
  const result = await runYtDlpProcess(
    command,
    sourceUrl,
    output,
    timeoutMs,
    options,
    scratchDirectory,
  ).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    await rm(scratchDirectory, { recursive: true, force: true });
  } catch {
    throw scratchFailure("local_cleanup", false);
  }
  if (!result.ok) throw result.error;
}

function scratchFailure(
  stage: "local_prepare" | "local_cleanup",
  retryable: boolean,
): AnalysisError {
  return new AnalysisError(
    "INTERNAL_ANALYSIS_ERROR",
    retryable,
    stage === "local_prepare"
      ? "Video scratch directory preparation failed"
      : "Video scratch directory cleanup failed",
    undefined,
    { mediaFailureStage: stage, mediaFailureClass: "filesystem" },
  );
}

async function runYtDlpProcess(
  binaryPath: string,
  sourceUrl: string,
  output: YtDlpOutput,
  timeoutMs: number,
  options: YtDlpAttemptOptions,
  scratchDirectory?: string,
): Promise<void> {
  const streaming = typeof output !== "string";
  const args = [
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
    ...(streaming
      ? ["--concurrent-fragments", "1", "--abort-on-unavailable-fragments"]
      : []),
    "--max-filesize",
    options.maxFileSizeArgument,
    "-f",
    options.formatSelector,
    "-o",
    streaming ? "-" : output,
    sourceUrl,
  ];
  // The native fragment downloader uses relative filenames even on stdout.
  // RLIMIT_FSIZE bounds those files without limiting writes to the stdout pipe.
  const limitUnit = process.platform === "darwin" ? 1024 : 512;
  const child = spawn(
    streaming ? "/bin/sh" : binaryPath,
    streaming
      ? [
          "-c",
          'ulimit -f "$1" || exit 1; shift; exec "$@"',
          "foodfolio-yt-dlp",
          String(MAX_FRAGMENT_FILE_BYTES / limitUnit),
          binaryPath,
          ...args,
        ]
      : args,
    {
      cwd: scratchDirectory,
      stdio: ["ignore", streaming ? "pipe" : "ignore", "pipe"],
    },
  );
  const exited = new Promise<void>((resolve, reject) => {
    let stderr = Buffer.alloc(0);
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr = Buffer.from(
        Buffer.concat([stderr, chunk]).subarray(-MAX_YT_DLP_DIAGNOSTIC_BYTES),
      );
    });
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
      const diagnostic = stderr.toString("utf8");
      if (
        streaming &&
        (signal === "SIGXFSZ" || diagnostic.includes("[Errno 27]"))
      ) {
        reject(new VideoSizeError("too_large"));
        return;
      }
      const restriction = classifyYtDlpAccessRestriction({
        stderr: diagnostic,
      });
      reject(
        restriction
          ? new YtDlpAccessRestrictionError(restriction)
          : new Error("yt-dlp process failed"),
      );
    });
  });
  if (!streaming) return exited;
  void exited.catch(() => {});
  const transfer = output(child.stdout!, exited);
  try {
    await transfer;
  } catch (error) {
    child.kill("SIGKILL");
    await exited.catch(() => {});
    throw error;
  }
}
