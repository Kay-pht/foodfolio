import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/build-api.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

describe("recipe edit differential sync timing (REST-1)", () => {
  let context: PostgresTestContext;
  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);
  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it.each(["Ingredient", "RecipeStep", "Recipe"] as const)(
    "returns the saved edit after sync during a %s row-lock wait",
    async (table) => {
      const user = await context.prisma.user.create({
        data: { firebaseUid: `sync-timing-${table}`, setting: { create: {} } },
      });
      const recipe = await context.prisma.recipe.create({
        data: {
          userId: user.id,
          originalUrl: `https://example.com/sync-timing-${table}`,
          normalizedUrl: `https://example.com/sync-timing-${table}`,
          sourceType: "web",
          title: "保存前",
          analysisStatus: "completed",
          ingredients: { create: { name: "元の材料", sortOrder: 0 } },
          steps: { create: { text: "元の手順", sortOrder: 0 } },
        },
      });
      const app = buildApi({
        prisma: context.prisma,
        authVerifier: {
          verifyIdToken: async () => ({ firebaseUid: user.firebaseUid }),
        },
        firebaseUsers: { deleteUser: async () => {} },
        taskQueue: { enqueueRecipeAnalysis: async () => {} },
      });
      let releaseLock!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let lockReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        lockReady = resolve;
      });
      let lock: Promise<void> | undefined;
      let save: Promise<Response> | undefined;
      try {
        const base = await app.listen({ host: "127.0.0.1", port: 0 });
        const headers = {
          authorization: "Bearer test",
          "content-type": "application/json",
        };
        const path = `${base}/v1/recipes/${recipe.id}`;
        lock = context.prisma.$transaction(
          async (tx) => {
            if (table === "Ingredient") {
              await tx.$queryRaw`SELECT "id" FROM "Ingredient" WHERE "recipeId" = CAST(${recipe.id} AS uuid) FOR UPDATE`;
            } else if (table === "RecipeStep") {
              await tx.$queryRaw`SELECT "id" FROM "RecipeStep" WHERE "recipeId" = CAST(${recipe.id} AS uuid) FOR UPDATE`;
            } else {
              await tx.$queryRaw`SELECT "id" FROM "Recipe" WHERE "id" = CAST(${recipe.id} AS uuid) FOR UPDATE`;
            }
            lockReady();
            await released;
          },
          { timeout: 20_000 },
        );
        await Promise.race([ready, lock]);
        save = fetch(path, {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            title: "保存後",
            ingredients: [{ name: "玉ねぎ", amount: "1個" }],
            steps: [
              { text: "  刻む\n細かく  " },
              { text: " " },
              { text: "煮る" },
            ],
          }),
        });
        const deadline = Date.now() + 5_000;
        let blocked = false;
        while (Date.now() < deadline) {
          const rows = await context.prisma.$queryRaw<Array<{ pid: number }>>`
            SELECT pid FROM pg_stat_activity
            WHERE wait_event_type = 'Lock'
              AND query LIKE ${`%"${table}"%`}
              AND pid <> pg_backend_pid()
          `;
          if (rows.length) {
            blocked = true;
            break;
          }
          await delay(10);
        }
        expect(blocked).toBe(true);
        const during = await fetch(`${base}/v1/sync`, { headers });
        expect(during.status).toBe(200);
        const snapshot = await during.json();
        expect(
          snapshot.recipes.find((r: { id: string }) => r.id === recipe.id)
            .title,
        ).toBe("保存前");
        releaseLock();
        await lock;
        const response = await save;
        expect(response.status).toBe(200);
        const saved = await response.json();
        expect(saved.title).toBe("保存後");
        expect(saved.ingredients[0].name).toBe("玉ねぎ");
        expect(saved.steps.map((step: { text: string }) => step.text)).toEqual([
          "刻む\n細かく",
          "煮る",
        ]);
        expect(await (await fetch(path, { headers })).json()).toEqual(saved);
        const next = await fetch(
          `${base}/v1/sync?cursor=${encodeURIComponent(snapshot.nextCursor)}`,
          { headers },
        );
        expect(next.status).toBe(200);
        expect(
          (await next.json()).recipes.find(
            (r: { id: string }) => r.id === recipe.id,
          ),
        ).toEqual(saved);
      } finally {
        releaseLock();
        await lock;
        await save;
        await app.close();
      }
    },
    30_000,
  );
});
