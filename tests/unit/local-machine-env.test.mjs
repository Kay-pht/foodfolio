import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  localMachineValue,
  gcloudAccessTokenArguments,
} from "../../scripts/local-machine-env.mjs";

const roots = [];
function fixture(content) {
  const root = mkdtempSync(join(tmpdir(), "foodfolio-local-env-"));
  roots.push(root);
  const envFile = join(root, ".env.local");
  writeFileSync(envFile, content);
  return { environment: {}, envFile };
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

describe("local machine configuration", () => {
  it("reads quoted paths with spaces without exporting unrelated credentials or modifying the file", () => {
    const content =
      'DEVELOPER_DIR="/fixture/Xcode Custom.app/Contents/Developer"\nGEMINI_API_KEY=private\n';
    const options = fixture(content);
    expect(localMachineValue("DEVELOPER_DIR", options)).toBe(
      "/fixture/Xcode Custom.app/Contents/Developer",
    );
    expect(options.environment).toEqual({});
    expect(readFileSync(options.envFile, "utf8")).toBe(content);
    expect(() => localMachineValue("GEMINI_API_KEY", options)).toThrow(
      /Unsupported/,
    );
  });
  it("preserves an explicitly supplied environment value, including an empty override", () => {
    const options = fixture("DEVELOPER_DIR=/fixture/local\n");
    expect(
      localMachineValue("DEVELOPER_DIR", {
        ...options,
        environment: { DEVELOPER_DIR: "/fixture/ci" },
      }),
    ).toBe("/fixture/ci");
    expect(
      localMachineValue("DEVELOPER_DIR", {
        ...options,
        environment: { DEVELOPER_DIR: "" },
      }),
    ).toBeUndefined();
  });
  it("treats a missing local file as optional but propagates other filesystem errors", () => {
    const options = fixture("");
    expect(
      localMachineValue("DEVELOPER_DIR", {
        ...options,
        envFile: join(roots[0], "missing"),
      }),
    ).toBeUndefined();
    expect(() =>
      localMachineValue("DEVELOPER_DIR", { ...options, envFile: roots[0] }),
    ).toThrow();
  });
  it("requires an explicit local account before constructing a gcloud invocation", () => {
    expect(() => gcloudAccessTokenArguments(fixture(""))).toThrow(
      /FOODFOLIO_GCLOUD_ACCOUNT/,
    );
    expect(
      gcloudAccessTokenArguments(
        fixture("FOODFOLIO_GCLOUD_ACCOUNT=operator@example.invalid\n"),
      ),
    ).toEqual([
      "auth",
      "print-access-token",
      "--account",
      "operator@example.invalid",
    ]);
  });
});
