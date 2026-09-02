import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const databaseGeneratedUuidModels = [
  "User",
  "Recipe",
  "Ingredient",
  "RecipeStep",
  "Tag",
  "DeviceToken",
];

describe("Prisma schema", () => {
  it("keeps UUID defaults aligned with the PostgreSQL migrations", async () => {
    const schema = await readFile(
      new URL("../../prisma/schema.prisma", import.meta.url),
      "utf8",
    );

    for (const modelName of databaseGeneratedUuidModels) {
      const model = schema.match(
        new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`),
      )?.[1];

      expect(model, `${modelName} model is missing`).toBeDefined();
      expect(model).toMatch(
        /^\s*id\s+String\s+@id\s+@default\(dbgenerated\("gen_random_uuid\(\)"\)\)\s+@db\.Uuid$/m,
      );
    }
  });
});
