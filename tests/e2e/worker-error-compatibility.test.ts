import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "undici";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildWorker } from "../../src/api/build-worker.js";
import { RecipeAnalysisService } from "../../src/application/analysis/analysis-service.js";
import type {
  InstagramMediaRecipeFallback,
  SourceContentExtractor,
  TemporaryMediaStore,
} from "../../src/application/analysis/types.js";
import { ProductionInstagramMediaRecipeFallback } from "../../src/infrastructure/instagram/instagram-media-recipe-fallback.js";
import { YtDlpInstagramMediaRetriever } from "../../src/infrastructure/instagram/yt-dlp-instagram-media-retriever.js";
import { SafeHttpClient } from "../../src/infrastructure/url/safe-http-client.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

describe("Worker source/media error compatibility E2E", () => {
  let context: PostgresTestContext;
  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);
  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  async function startWorker(
    name: string,
    sourceExtractor: SourceContentExtractor,
    instagramMediaFallback?: InstagramMediaRecipeFallback,
  ) {
    const user = await context.prisma.user.create({
      data: { firebaseUid: `compatibility-${name}`, setting: { create: {} } },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: `https://www.instagram.com/p/${name}/`,
        normalizedUrl: `https://www.instagram.com/p/${name}/`,
        sourceType: "instagram",
      },
    });
    const logs: Record<string, unknown>[] = [];
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor,
      ...(instagramMediaFallback ? { instagramMediaFallback } : {}),
      recipeExtractor: { extract: vi.fn() },
      notifications: {
        sendRecipeAnalysisCompleted: async () => [],
        sendRecipeAnalysisFailed: async () => [],
        sendRecipeAnalysisNotRecipe: async () => [],
      },
      maxAttempts: 3,
    });
    const worker = buildWorker({
      process: (id, attempt, log) =>
        service.process(id, attempt, (fields, message) => {
          logs.push(fields);
          log(fields, message);
        }),
    });
    await worker.listen({ port: 0, host: "127.0.0.1" });
    return {
      worker,
      logs,
      async deliver(attempt: number) {
        const response = await fetch(
          `http://127.0.0.1:${(worker.server.address() as AddressInfo).port}/internal/tasks/recipe-analysis`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-cloudtasks-taskretrycount": String(attempt - 1),
            },
            body: JSON.stringify({ recipeId: recipe.id }),
          },
        );
        await response.text();
        const stored = await context.prisma.recipe.findUniqueOrThrow({
          where: { id: recipe.id },
        });
        return {
          httpStatus: response.status,
          recipeStatus: stored.analysisStatus,
        };
      },
    };
  }

  it("returns 204/failed after internal success-path cleanup failures and successful final cleanup", async () => {
    const publishedDirectory = await mkdtemp(
      join(tmpdir(), "foodfolio-compatibility-"),
    );
    const store: TemporaryMediaStore = {
      publish: async (item) => {
        const path = join(publishedDirectory, String(item.index));
        await copyFile(item.filePath, path);
        return {
          url: `https://storage.example/${item.index}`,
          kind: item.kind,
          contentType: item.contentType,
          dispose: () => rm(path, { force: true }),
        };
      },
    };
    let rootRemovals = 0;
    const retriever = new YtDlpInstagramMediaRetriever(
      {
        binaryPath: "unused",
        maxAttempts: 2,
        attemptTimeoutMs: 1000,
        retryBaseSeconds: 0,
        maxRetrySeconds: 0,
      },
      store,
      async () => ({
        thumbnails: [{ url: "https://cdn.example/image.jpg" }],
        formats: [],
      }),
      { retrieve: vi.fn() },
      async (asset, directory) => {
        const filePath = join(directory, `${asset.index}.jpg`);
        await writeFile(filePath, new Uint8Array([1]));
        return { filePath, sizeBytes: 1, contentType: "image/jpeg" };
      },
      async () => {},
      async (path, recursive) => {
        if (recursive && ++rootRemovals <= 2) {
          // A real filesystem error after publishing; the final recursive removal succeeds.
          await rm(path, { recursive: false, force: false });
          return;
        }
        await rm(path, { recursive, force: true });
      },
    );
    const extractMedia = vi.fn();
    const fixture = await startWorker(
      "cleanup",
      {
        extract: async (url) => ({
          sourceType: "instagram",
          resolvedUrl: url.toString(),
          imageUrl: null,
          textForAi: null,
        }),
      },
      new ProductionInstagramMediaRecipeFallback(retriever, { extractMedia }),
    );
    try {
      expect(await fixture.deliver(1)).toEqual({
        httpStatus: 204,
        recipeStatus: "failed",
      });
      expect(rootRemovals).toBe(3);
      expect(await readdir(publishedDirectory)).toEqual([]);
      expect(extractMedia).not.toHaveBeenCalled();
      expect(fixture.logs).toContainEqual(
        expect.objectContaining({
          errorCode: "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
          mediaFailureStage: "local_cleanup",
          mediaFailureClass: "filesystem",
          mediaAttempt: 2,
          mediaMaxAttempts: 2,
        }),
      );
    } finally {
      await fixture.worker.close();
      await rm(publishedDirectory, { recursive: true, force: true });
    }
  });

  it("keeps a malformed real HTTP redirect pending until the Worker delivery limit", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(302, { location: "https://[" });
      response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const client = new SafeHttpClient();
    // Only the test dispatcher routes the public test hostname to the local HTTP fixture.
    const transport = client as unknown as { dispatcher: Agent };
    await transport.dispatcher.close();
    transport.dispatcher = new Agent({
      connect: {
        lookup(_host, options, callback) {
          if (options.all)
            callback(null, [{ address: "127.0.0.1", family: 4 }]);
          else callback(null, "127.0.0.1", 4);
        },
      },
    });
    const fixture = await startWorker("redirect", {
      extract: async () => {
        await client.get(
          new URL(
            `http://compatibility.example:${(server.address() as AddressInfo).port}/`,
          ),
          "tiktok_short_url",
        );
        throw new Error("Expected malformed redirect to fail");
      },
    });
    try {
      expect(await fixture.deliver(1)).toEqual({
        httpStatus: 503,
        recipeStatus: "pending",
      });
      expect(await fixture.deliver(3)).toEqual({
        httpStatus: 204,
        recipeStatus: "failed",
      });
      expect(fixture.logs).toContainEqual(
        expect.objectContaining({
          errorCode: "INTERNAL_ANALYSIS_ERROR",
          sourceFailureStage: "redirect",
          sourceFailureClass: "redirect_invalid_location",
          sourceHttpStatus: 302,
          sourceRedirectCount: 1,
        }),
      );
      expect(JSON.stringify(fixture.logs)).not.toContain("https://[");
    } finally {
      await fixture.worker.close();
      await transport.dispatcher.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
