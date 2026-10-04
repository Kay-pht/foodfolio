import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("iOS verification test count", () => {
  it("matches the XCTest methods in all three Foodfolio test targets", () => {
    const targets = [
      "FoodfolioTests",
      "FoodfolioIntegrationTests",
      "FoodfolioUITests",
    ];
    let declaredTests = 0;
    for (const target of targets) {
      const directory = `${repositoryRoot}/ios/${target}`;
      for (const file of readdirSync(directory, { recursive: true })) {
        if (!file.endsWith(".swift")) continue;
        const source = readFileSync(`${directory}/${file}`, "utf8");
        declaredTests += [...source.matchAll(/^\s*func test\w*\(\)/gm)].length;
      }
    }

    const packageJson = JSON.parse(
      readFileSync(`${repositoryRoot}/package.json`, "utf8"),
    );
    const configuredCount = packageJson.scripts["verify:ios"].match(
      /IOS_EXPECTED_TEST_COUNT=(\d+)/,
    );
    expect(declaredTests).toBeGreaterThan(0);
    expect(configuredCount).not.toBeNull();
    expect(Number(configuredCount[1])).toBe(declaredTests);
  });
});
