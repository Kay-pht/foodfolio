import { describe, expect, it } from "vitest";
import {
  assertLocalDatabase,
  mergeLocalEnvironment,
} from "../../scripts/dev-local-support.mjs";

describe("local development environment", () => {
  it("layers the base environment before local overrides without dropping shared secrets", () => {
    const environment = mergeLocalEnvironment(
      {
        DATABASE_URL: "postgresql://ambient.example/database",
        ZAI_API_KEY: "ambient-zai-key",
      },
      {
        DATABASE_URL: "postgresql://base.example/database",
        ZAI_API_KEY: "base-zai-key",
        YOUTUBE_API_KEY: "base-youtube-key",
      },
      { DATABASE_URL: "postgresql://localhost/foodfolio" },
    );

    expect(environment.DATABASE_URL).toBe("postgresql://localhost/foodfolio");
    expect(environment.ZAI_API_KEY).toBe("base-zai-key");
    expect(environment.YOUTUBE_API_KEY).toBe("base-youtube-key");
  });

  it.each([
    "postgresql://foodfolio:password@127.0.0.1:5432/foodfolio",
    "postgres://foodfolio:password@localhost/foodfolio",
    "postgresql://foodfolio:password@[::1]:5432/foodfolio",
  ])("accepts the local Foodfolio database URL %s", (databaseUrl) => {
    expect(() =>
      assertLocalDatabase("DATABASE_URL", databaseUrl),
    ).not.toThrow();
  });

  it.each([
    "postgresql://foodfolio:password@database.example:5432/foodfolio",
    "postgresql://foodfolio:password@localhost:5433/foodfolio",
    "postgresql://foodfolio:password@localhost:5432/other",
    "postgresql://other:password@localhost:5432/foodfolio",
    "https://foodfolio:password@localhost:5432/foodfolio",
    "not-a-url",
  ])("rejects a non-local Foodfolio database URL %s", (databaseUrl) => {
    expect(() => assertLocalDatabase("DATABASE_URL", databaseUrl)).toThrow(
      /DATABASE_URL/,
    );
  });
});
