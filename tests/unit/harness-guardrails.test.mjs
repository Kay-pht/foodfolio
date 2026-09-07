import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  findArchitectureViolations,
} from "../../scripts/check-architecture.mjs";
import { findDocumentationIssues } from "../../scripts/check-docs.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryRepository() {
  const directory = await mkdtemp(join(tmpdir(), "foodfolio-guardrails-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function write(root, path, content) {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

describe("architecture guardrail", () => {
  it("allows dependencies that point inward", async () => {
    const root = await temporaryRepository();
    await write(root, "src/domain/model.ts", "export const model = 1;\n");
    await write(
      root,
      "src/application/use-case.ts",
      'import { model } from "../domain/model.js";\nexport { model };\n',
    );
    await write(
      root,
      "src/infrastructure/adapter.ts",
      'export { model } from "../application/use-case.js";\n',
    );
    await write(
      root,
      "src/api/routes.ts",
      'export { model } from "../infrastructure/adapter.js";\n',
    );
    await write(
      root,
      "src/entrypoints/api.ts",
      'import("../api/routes.js");\n',
    );

    await expect(
      findArchitectureViolations({ rootDirectory: root }),
    ).resolves.toEqual([]);
  });

  it("rejects an application dependency on infrastructure", async () => {
    const root = await temporaryRepository();
    await write(root, "src/infrastructure/db.ts", "export const db = 1;\n");
    await write(
      root,
      "src/application/use-case.ts",
      'import { db } from "../infrastructure/db.js";\nexport { db };\n',
    );

    await expect(
      findArchitectureViolations({ rootDirectory: root }),
    ).resolves.toEqual([
      {
        source: "src/application/use-case.ts",
        sourceLayer: "application",
        targetLayer: "infrastructure",
        specifier: "../infrastructure/db.js",
      },
    ]);
  });

  it("ignores import-like text in comments and strings", async () => {
    const root = await temporaryRepository();
    await write(
      root,
      "src/domain/example.ts",
      [
        'const example = \'import { route } from "../api/routes.js";\';',
        '// import { route } from "../api/routes.js";',
        '/* export { route } from "../api/routes.js"; */',
        "export { example };",
        "",
      ].join("\n"),
    );

    await expect(
      findArchitectureViolations({ rootDirectory: root }),
    ).resolves.toEqual([]);
  });

  it("rejects a dynamic import that points outward", async () => {
    const root = await temporaryRepository();
    await write(root, "src/infrastructure/db.ts", "export const db = 1;\n");
    await write(
      root,
      "src/application/use-case.ts",
      [
        "export async function loadDb() {",
        '  return import("../infrastructure/db.js");',
        "}",
        "",
      ].join("\n"),
    );

    await expect(
      findArchitectureViolations({ rootDirectory: root }),
    ).resolves.toEqual([
      {
        source: "src/application/use-case.ts",
        sourceLayer: "application",
        targetLayer: "infrastructure",
        specifier: "../infrastructure/db.js",
      },
    ]);
  });
});

describe("documentation guardrail", () => {
  async function createMinimumDocs(root) {
    await write(
      root,
      "package.json",
      JSON.stringify({
        scripts: { verify: "echo ok", "check:docs": "echo ok" },
      }),
    );
    await write(root, "docs/guide.md", "# Guide\n");
    await write(root, "docs/architecture-boundaries.md", "# Architecture\n");
    await write(
      root,
      "docs/README.md",
      "[Guide](guide.md)\n[Architecture](architecture-boundaries.md)\n",
    );
    await write(root, "docs/agent/development.md", "`npm run verify`\n");
    await write(root, "docs/agent/testing.md", "`npm run check:docs`\n");
    await write(root, "docs/agent/infrastructure.md", "# Infrastructure\n");
    await write(root, "docs/agent/release.md", "# Release\n");
    await write(root, "AGENTS.md", "[Docs](docs/README.md)\n");
  }

  it("accepts indexed docs, valid links and existing npm scripts", async () => {
    const root = await temporaryRepository();
    await createMinimumDocs(root);

    await expect(
      findDocumentationIssues({ rootDirectory: root }),
    ).resolves.toEqual([]);
  });

  it("reports stale index, link and npm script references", async () => {
    const root = await temporaryRepository();
    await createMinimumDocs(root);
    await write(root, "docs/unindexed.md", "# Missing from index\n");
    await write(root, "AGENTS.md", "[Missing](docs/missing.md)\n");
    await write(root, "docs/agent/testing.md", "`npm run missing-script`\n");

    const issues = await findDocumentationIssues({ rootDirectory: root });
    expect(issues).toContain("docs/README.md does not index docs/unindexed.md");
    expect(issues).toContain("AGENTS.md has broken link: docs/missing.md");
    expect(issues).toContain(
      "docs/agent/testing.md references unknown npm script: missing-script",
    );
  });

  it("requires a real non-code link for each indexed document", async () => {
    const root = await temporaryRepository();
    await createMinimumDocs(root);
    await write(root, "docs/unindexed.md", "# Unindexed\n");
    await write(
      root,
      "docs/README.md",
      [
        "[Guide](guide.md)",
        "[Architecture](architecture-boundaries.md)",
        "Mention only: (unindexed.md)",
        "`[Inline example](unindexed.md)`",
        "```md",
        "[Fenced example](unindexed.md)",
        "```",
        "",
      ].join("\n"),
    );

    const issues = await findDocumentationIssues({ rootDirectory: root });
    expect(issues).toContain("docs/README.md does not index docs/unindexed.md");

    await write(
      root,
      "docs/README.md",
      [
        "[Guide](guide.md)",
        "[Architecture](architecture-boundaries.md)",
        "[Unindexed](unindexed.md)",
        "",
      ].join("\n"),
    );

    await expect(
      findDocumentationIssues({ rootDirectory: root }),
    ).resolves.not.toContain("docs/README.md does not index docs/unindexed.md");
  });
});
