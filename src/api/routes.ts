import type { FastifyInstance } from "fastify";
import { Prisma, type Genre } from "../generated/prisma/client.js";
import type { ApiDependencies } from "./build-api.js";
import { AppError } from "./errors/app-error.js";
import { recipeDto, recipeInclude } from "./recipe-dto.js";
import { parseAndNormalizeRecipeUrl } from "../domain/recipe/url.js";
import { genreFromLabel } from "../domain/recipe/genre.js";
import { normalizeTagName } from "../domain/tag/normalize.js";
import { decodeSyncCursor, encodeSyncCursor } from "../shared/sync-cursor.js";

const authAndUser = (app: FastifyInstance) => [
  app.authenticate,
  app.resolveUser,
];
const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const requireString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value.trim())
    throw new AppError(400, "INVALID_REQUEST", `${name} is required`);
  return value;
};

async function ownedRecipe(
  deps: ApiDependencies,
  userId: string,
  recipeId: string,
) {
  const recipe = await deps.prisma.recipe.findFirst({
    where: { id: recipeId, userId },
    include: recipeInclude,
  });
  if (!recipe) throw new AppError(404, "NOT_FOUND", "Recipe was not found");
  return recipe;
}

export function registerRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): void {
  app.post(
    "/v1/recipes",
    { preHandler: authAndUser(app) },
    async (request, reply) => {
      const url = requireString(asObject(request.body).url, "url");
      const normalized = parseAndNormalizeRecipeUrl(url);
      let recipe;
      try {
        recipe = await deps.prisma.recipe.create({
          data: { userId: request.appUser.id, ...normalized },
          include: recipeInclude,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const existing = await deps.prisma.recipe.findUnique({
            where: {
              userId_normalizedUrl: {
                userId: request.appUser.id,
                normalizedUrl: normalized.normalizedUrl,
              },
            },
          });
          throw new AppError(
            409,
            "DUPLICATE_RECIPE",
            "Recipe already exists",
            existing ? { recipeId: existing.id } : undefined,
          );
        }
        throw error;
      }
      try {
        await deps.taskQueue.enqueueRecipeAnalysis(recipe.id);
      } catch (error) {
        request.log.error(
          { err: error, recipeId: recipe.id, errorCode: "TASK_ENQUEUE_FAILED" },
          "task enqueue failed",
        );
        recipe = await deps.prisma.recipe.update({
          where: { id: recipe.id },
          data: { analysisStatus: "failed", title: "解析に失敗したレシピ" },
          include: recipeInclude,
        });
      }
      return reply.status(201).send(recipeDto(recipe));
    },
  );

  app.get("/v1/recipes", { preHandler: authAndUser(app) }, async (request) => {
    const query = asObject(request.query);
    const limit = Math.min(50, Math.max(1, Number(query.limit ?? 30) || 30));
    const cursor = typeof query.cursor === "string" ? query.cursor : undefined;
    const items = await deps.prisma.recipe.findMany({
      where: { userId: request.appUser.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    return {
      items: page.map((recipe) => ({
        id: recipe.id,
        title: recipe.title,
        imageUrl: recipe.imageUrl,
        analysisStatus: recipe.analysisStatus,
        createdAt: recipe.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  });

  app.get(
    "/v1/recipes/:recipeId",
    { preHandler: authAndUser(app) },
    async (request) => {
      const recipeId = requireString(
        asObject(request.params).recipeId,
        "recipeId",
      );
      return recipeDto(await ownedRecipe(deps, request.appUser.id, recipeId));
    },
  );

  app.patch(
    "/v1/recipes/:recipeId",
    { preHandler: authAndUser(app) },
    async (request) => {
      const recipeId = requireString(
        asObject(request.params).recipeId,
        "recipeId",
      );
      const current = await ownedRecipe(deps, request.appUser.id, recipeId);
      if (["pending", "processing"].includes(current.analysisStatus))
        throw new AppError(
          409,
          "RECIPE_ANALYSIS_IN_PROGRESS",
          "Recipe analysis is still in progress",
        );
      const body = asObject(request.body);
      const data: { title?: string; genre?: Genre | null } = {};
      if ("title" in body) {
        const title = requireString(body.title, "title").trim();
        if (title.length > 200)
          throw new AppError(422, "VALIDATION_ERROR", "title is too long");
        data.title = title;
      }
      if ("genre" in body) {
        if (body.genre !== null && typeof body.genre !== "string")
          throw new AppError(422, "VALIDATION_ERROR", "genre is invalid");
        const genre = genreFromLabel(body.genre as string | null);
        if (body.genre !== null && genre === null)
          throw new AppError(422, "VALIDATION_ERROR", "genre is invalid");
        data.genre = genre;
      }
      const ingredients = "ingredients" in body ? body.ingredients : undefined;
      if (ingredients !== undefined && !Array.isArray(ingredients))
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          "ingredients must be an array",
        );
      await deps.prisma.$transaction(async (tx) => {
        if (Array.isArray(ingredients)) {
          const values = ingredients.map((raw, sortOrder) => {
            const item = asObject(raw);
            const name = requireString(item.name, "ingredient.name").trim();
            return {
              recipeId,
              name,
              amount:
                typeof item.amount === "string"
                  ? item.amount.trim() || null
                  : null,
              sortOrder,
            };
          });
          await tx.ingredient.deleteMany({ where: { recipeId } });
          if (values.length > 0)
            await tx.ingredient.createMany({ data: values });
        }
        await tx.recipe.update({
          where: { id: recipeId },
          data: { ...data, updatedAt: new Date() },
        });
      });
      return recipeDto(await ownedRecipe(deps, request.appUser.id, recipeId));
    },
  );

  app.delete(
    "/v1/recipes/:recipeId",
    { preHandler: authAndUser(app) },
    async (request, reply) => {
      const recipeId = requireString(
        asObject(request.params).recipeId,
        "recipeId",
      );
      await ownedRecipe(deps, request.appUser.id, recipeId);
      await deps.prisma.recipe.delete({ where: { id: recipeId } });
      return reply.status(204).send();
    },
  );

  app.get("/v1/sync", { preHandler: authAndUser(app) }, async (request) => {
    const query = asObject(request.query);
    const previous =
      typeof query.cursor === "string"
        ? decodeSyncCursor(query.cursor)
        : {
            updatedAt: "1970-01-01T00:00:00.000Z",
            id: "00000000-0000-0000-0000-000000000000",
          };
    const [clock] = await deps.prisma.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    const highWater = clock?.now ?? new Date();
    const recipes = await deps.prisma.recipe.findMany({
      where: {
        userId: request.appUser.id,
        AND: [
          { updatedAt: { lte: highWater } },
          {
            OR: [
              { updatedAt: { gt: new Date(previous.updatedAt) } },
              {
                updatedAt: new Date(previous.updatedAt),
                id: { gt: previous.id },
              },
            ],
          },
        ],
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      include: recipeInclude,
    });
    const tags = await deps.prisma.tag.findMany({
      where: { userId: request.appUser.id },
      orderBy: { createdAt: "asc" },
    });
    return {
      recipes: recipes.map(recipeDto),
      tags: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        createdAt: tag.createdAt.toISOString(),
      })),
      nextCursor: encodeSyncCursor({
        updatedAt: highWater.toISOString(),
        id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      }),
    };
  });

  app.get(
    "/v1/sync/recipe-ids",
    { preHandler: authAndUser(app) },
    async (request) => ({
      recipeIds: (
        await deps.prisma.recipe.findMany({
          where: { userId: request.appUser.id },
          select: { id: true },
        })
      ).map(({ id }) => id),
    }),
  );

  app.get("/v1/tags", { preHandler: authAndUser(app) }, async (request) =>
    deps.prisma.tag.findMany({
      where: { userId: request.appUser.id },
      orderBy: { createdAt: "asc" },
    }),
  );
  app.post(
    "/v1/tags",
    { preHandler: authAndUser(app) },
    async (request, reply) => {
      let normalized;
      try {
        normalized = normalizeTagName(
          requireString(asObject(request.body).name, "name"),
        );
      } catch {
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          "Tag name must be 1 to 30 characters",
        );
      }
      const tag = await deps.prisma.tag.upsert({
        where: {
          userId_normalizedName: {
            userId: request.appUser.id,
            normalizedName: normalized.normalizedName,
          },
        },
        update: {},
        create: { userId: request.appUser.id, ...normalized },
      });
      return reply.status(201).send(tag);
    },
  );

  app.post(
    "/v1/recipes/:recipeId/tags",
    { preHandler: authAndUser(app) },
    async (request) => {
      const recipeId = requireString(
        asObject(request.params).recipeId,
        "recipeId",
      );
      const tagId = requireString(asObject(request.body).tagId, "tagId");
      await ownedRecipe(deps, request.appUser.id, recipeId);
      const tag = await deps.prisma.tag.findFirst({
        where: { id: tagId, userId: request.appUser.id },
      });
      if (!tag) throw new AppError(404, "NOT_FOUND", "Tag was not found");
      await deps.prisma.$transaction([
        deps.prisma.recipeTag.upsert({
          where: { recipeId_tagId: { recipeId, tagId } },
          update: {},
          create: { recipeId, tagId },
        }),
        deps.prisma.recipe.update({
          where: { id: recipeId },
          data: { updatedAt: new Date() },
        }),
      ]);
      return recipeDto(await ownedRecipe(deps, request.appUser.id, recipeId));
    },
  );

  app.delete(
    "/v1/recipes/:recipeId/tags/:tagId",
    { preHandler: authAndUser(app) },
    async (request, reply) => {
      const params = asObject(request.params);
      const recipeId = requireString(params.recipeId, "recipeId");
      const tagId = requireString(params.tagId, "tagId");
      await ownedRecipe(deps, request.appUser.id, recipeId);
      const tag = await deps.prisma.tag.findFirst({
        where: { id: tagId, userId: request.appUser.id },
      });
      if (!tag) throw new AppError(404, "NOT_FOUND", "Tag was not found");
      await deps.prisma.$transaction([
        deps.prisma.recipeTag.deleteMany({ where: { recipeId, tagId } }),
        deps.prisma.recipe.update({
          where: { id: recipeId },
          data: { updatedAt: new Date() },
        }),
      ]);
      return reply.status(204).send();
    },
  );

  app.get("/v1/settings", { preHandler: authAndUser(app) }, async (request) =>
    deps.prisma.userSetting.findUniqueOrThrow({
      where: { userId: request.appUser.id },
      select: { recipeAnalysisNotificationEnabled: true },
    }),
  );
  app.patch(
    "/v1/settings",
    { preHandler: authAndUser(app) },
    async (request) => {
      const enabled = asObject(request.body).recipeAnalysisNotificationEnabled;
      if (typeof enabled !== "boolean")
        throw new AppError(422, "VALIDATION_ERROR", "Setting must be boolean");
      return deps.prisma.userSetting.update({
        where: { userId: request.appUser.id },
        data: { recipeAnalysisNotificationEnabled: enabled },
        select: { recipeAnalysisNotificationEnabled: true },
      });
    },
  );

  app.put(
    "/v1/device-token",
    { preHandler: authAndUser(app) },
    async (request, reply) => {
      const token = requireString(asObject(request.body).token, "token");
      await deps.prisma.deviceToken.upsert({
        where: { fcmToken: token },
        update: { userId: request.appUser.id, lastSeenAt: new Date() },
        create: { userId: request.appUser.id, fcmToken: token },
      });
      return reply.status(204).send();
    },
  );
  app.delete(
    "/v1/device-token",
    { preHandler: authAndUser(app) },
    async (request, reply) => {
      const token = requireString(asObject(request.body).token, "token");
      await deps.prisma.deviceToken.deleteMany({
        where: { fcmToken: token, userId: request.appUser.id },
      });
      return reply.status(204).send();
    },
  );

  app.delete(
    "/v1/me",
    { preHandler: app.authenticate },
    async (request, reply) => {
      await deps.prisma.$transaction(async (tx) => {
        await tx.user.deleteMany({
          where: { firebaseUid: request.firebaseUid },
        });
      });
      try {
        await deps.firebaseUsers.deleteUser(request.firebaseUid);
      } catch (error) {
        const code = asObject(error).code;
        if (code !== "auth/user-not-found")
          throw new AppError(
            503,
            "TEMPORARILY_UNAVAILABLE",
            "Account deletion must be retried",
          );
      }
      return reply.status(204).send();
    },
  );
}
