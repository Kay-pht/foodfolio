import { describe, expect, it } from "vitest";
import {
  assertLocalDatabase,
  mergeLocalEnvironment,
} from "../../scripts/dev-local-support.mjs";

describe("local development environment", () => {
  it("prefers values from the local environment file", () => {
    expect(
      mergeLocalEnvironment(
        { DATABASE_URL: "postgresql://remote.example/database" },
        { DATABASE_URL: "postgresql://localhost/foodfolio" },
      ).DATABASE_URL,
    ).toBe("postgresql://localhost/foodfolio");
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
