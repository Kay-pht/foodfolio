import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

const buildConfig = JSON.parse(
  await readFile(
    new URL("../../tsconfig.build.json", import.meta.url),
    "utf8",
  ),
);

describe("production TypeScript build boundary", () => {
  it("does not compile PoC sources that depend on ignored local evidence", () => {
    expect(buildConfig.exclude).toContain("poc");
  });

  it("continues to exclude test sources from the production build", () => {
    expect(buildConfig.exclude).toContain("tests");
  });
});
