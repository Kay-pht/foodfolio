import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/build-api.js";
import {
  AnalysisError,
  type RepresentativeImageResolver,
} from "../../src/application/analysis/types.js";
import type { AuthVerifier } from "../../src/infrastructure/auth/auth-verifier.js";
import type { AnalysisTaskQueue } from "../../src/infrastructure/tasks/task-queue.js";
import { posts, setup } from "../helpers/tiktok-thumbnail.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

const auth: AuthVerifier = {
  verifyIdToken: async (token) => ({ firebaseUid: token }),
};
const noOpQueue: AnalysisTaskQueue = { enqueueRecipeAnalysis: async () => {} };
const headers = (user: string) => ({ authorization: `Bearer ${user}` });

describe("recipe image resolution API", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);

  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it("reuses the representative image resolver for the owned recipe", async () => {
    const requestedURLs: string[] = [];
    const imageResolver: RepresentativeImageResolver = {
      resolveImageUrl: async (url) => {
        requestedURLs.push(url.toString());
        return "https://i.ytimg.com/vi/example/maxresdefault.jpg";
      },
    };
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: { deleteUser: async () => {} },
      taskQueue: noOpQueue,
      imageResolver,
    });
    const originalUrl = "https://www.youtube.com/watch?v=0to72EbNg8A";
    const created = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: headers("image-owner"),
      payload: { url: originalUrl },
    });
    const recipeId = created.json().id as string;

    const resolved = await app.inject({
      method: "POST",
      url: `/v1/recipes/${recipeId}/image/resolve`,
      headers: headers("image-owner"),
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toEqual({
      imageUrl: "https://i.ytimg.com/vi/example/maxresdefault.jpg",
    });
    expect(requestedURLs).toEqual([originalUrl]);

    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/recipes/${recipeId}/image/resolve`,
      headers: headers("other-user"),
    });
    expect(forbidden.statusCode).toBe(404);
    expect(requestedURLs).toEqual([originalUrl]);

    await app.close();
  });

  it("returns no image when representative image metadata cannot be recovered", async () => {
    const imageResolver: RepresentativeImageResolver = {
      resolveImageUrl: async () => {
        throw new AnalysisError(
          "SOURCE_CONTENT_UNAVAILABLE",
          false,
          "metadata unavailable",
        );
      },
    };
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: { deleteUser: async () => {} },
      taskQueue: noOpQueue,
      imageResolver,
    });
    const created = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: headers("image-missing"),
      payload: { url: "https://example.com/missing-image" },
    });
    const recipeId = created.json().id as string;

    const resolved = await app.inject({
      method: "POST",
      url: `/v1/recipes/${recipeId}/image/resolve`,
      headers: headers("image-missing"),
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toEqual({ imageUrl: null });

    await app.close();
  });

  it.each(posts)(
    "recovers the missing TikTok thumbnail for $id without mutating saved content (TVT-2)",
    async (post) => {
      const { extractor, get } = setup({}, post);
      const app = buildApi({
        prisma: context.prisma,
        authVerifier: auth,
        firebaseUsers: { deleteUser: async () => {} },
        taskQueue: noOpQueue,
        imageResolver: extractor,
      });
      try {
        const owner = `tiktok-image-${post.id}`;
        const created = await app.inject({
          method: "POST",
          url: "/v1/recipes",
          headers: headers(owner),
          payload: { url: post.short },
        });
        expect(created.statusCode).toBe(201);
        const recipeId = created.json().id as string;
        const before = await context.prisma.recipe.findUniqueOrThrow({
          where: { id: recipeId },
        });
        expect(before.imageUrl).toBeNull();
        const resolved = await app.inject({
          method: "POST",
          url: `/v1/recipes/${recipeId}/image/resolve`,
          headers: headers(owner),
        });
        expect(resolved.statusCode).toBe(200);
        expect(resolved.json()).toEqual({
          imageUrl: `https://images.example/${post.id}.jpg`,
        });
        expect(
          await context.prisma.recipe.findUniqueOrThrow({
            where: { id: recipeId },
          }),
        ).toEqual(before);
        const calls = get.mock.calls.length;
        const forbidden = await app.inject({
          method: "POST",
          url: `/v1/recipes/${recipeId}/image/resolve`,
          headers: headers("tiktok-other-user"),
        });
        expect(forbidden.statusCode).toBe(404);
        expect(get).toHaveBeenCalledTimes(calls);
      } finally {
        await app.close();
      }
    },
  );
});
