import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { describe, expect, it } from "vitest";

const readText = (relativePath) => {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

const projectSource = readText("../../ios/project.yml");
const generatedProject = readText(
  "../../ios/Foodfolio.xcodeproj/project.pbxproj",
);
const appInfoPlistStrings = readText(
  "../../ios/Foodfolio/Resources/ja.lproj/InfoPlist.strings",
);
const extensionInfoPlistStrings = readText(
  "../../ios/FoodfolioShareExtension/Resources/ja.lproj/InfoPlist.strings",
);

const expectedJapaneseBundleNames =
  '"CFBundleDisplayName" = "Foodfolio";\n"CFBundleName" = "Foodfolio";\n';

describe("Foodfolio Japanese bundle localization", () => {
  it("generates the Xcode project with Japanese as the development language", () => {
    expect(projectSource).toMatch(
      /options:\n(?: {2}.+\n)* {2}developmentLanguage: ja\n/,
    );
    expect(generatedProject).toContain("developmentRegion = ja;");
    expect(generatedProject).toMatch(
      /knownRegions = \([\s\S]*?\bja,[\s\S]*?\);/,
    );
  });

  it("keeps the installed main application name as Foodfolio", () => {
    expect(appInfoPlistStrings).toBe(expectedJapaneseBundleNames);
  });

  it("keeps the installed Share Extension name as Foodfolio", () => {
    expect(extensionInfoPlistStrings).toBe(expectedJapaneseBundleNames);
  });
});
