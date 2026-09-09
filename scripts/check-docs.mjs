import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AUTHORITATIVE_DOCS = [
  "AGENTS.md",
  "docs/README.md",
  "docs/architecture-boundaries.md",
  "docs/agent/autonomous-p0.md",
  "docs/agent/development.md",
  "docs/agent/review.md",
  "docs/agent/testing.md",
  "docs/agent/infrastructure.md",
  "docs/agent/release.md",
  "specs/README.md",
];

const MARKDOWN_LINK_PATTERN = /(!?)\[[^\]]*\]\(([^)]+)\)/gu;
const NPM_RUN_PATTERN = /\bnpm run ([a-zA-Z0-9:_-]+)/gu;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/u;
const INLINE_CODE_PATTERN = /(`+)(.*?)\1/gu;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function linkTarget(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end > 1 ? trimmed.slice(1, end) : undefined;
  }
  return trimmed.split(/\s+/u, 1)[0];
}

function isExternalOrAnchor(target) {
  return (
    target.startsWith("#") ||
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:")
  );
}

function withoutFragmentOrQuery(target) {
  return target.split("#", 1)[0].split("?", 1)[0];
}

function withoutMarkdownCode(source) {
  let fence;
  const lines = [];

  for (const line of source.split("\n")) {
    const fenceMatch = line.match(FENCE_PATTERN);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length
      ) {
        fence = undefined;
      }
      lines.push("");
      continue;
    }

    if (fenceMatch) {
      fence = fenceMatch[1];
      lines.push("");
      continue;
    }

    lines.push(line.replace(INLINE_CODE_PATTERN, ""));
  }

  return lines.join("\n");
}

function markdownLinkTargets(source, { includeImages = true } = {}) {
  const targets = [];
  const markdown = withoutMarkdownCode(source);
  MARKDOWN_LINK_PATTERN.lastIndex = 0;
  for (const match of markdown.matchAll(MARKDOWN_LINK_PATTERN)) {
    const isImage = match[1] === "!";
    if (!includeImages && isImage) continue;
    const target = match[2] ? linkTarget(match[2]) : undefined;
    if (target) targets.push(target);
  }
  return targets;
}

async function topLevelDocs(rootDirectory) {
  const docsDirectory = join(rootDirectory, "docs");
  const entries = await readdir(docsDirectory, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        extname(entry.name) === ".md" &&
        entry.name !== "README.md",
    )
    .map((entry) => entry.name)
    .sort();
}

export async function findDocumentationIssues({
  rootDirectory = process.cwd(),
} = {}) {
  const issues = [];
  const packageJson = JSON.parse(
    await readFile(join(rootDirectory, "package.json"), "utf8"),
  );
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));

  const docsIndexPath = join(rootDirectory, "docs/README.md");
  const docsIndex = await readFile(docsIndexPath, "utf8");
  const indexedDocuments = new Set(
    markdownLinkTargets(docsIndex, { includeImages: false })
      .filter((target) => !isExternalOrAnchor(target))
      .map((target) => withoutFragmentOrQuery(target))
      .filter(Boolean)
      .map((target) =>
        resolve(dirname(docsIndexPath), decodeURIComponent(target)),
      ),
  );
  for (const name of await topLevelDocs(rootDirectory)) {
    if (!indexedDocuments.has(resolve(dirname(docsIndexPath), name))) {
      issues.push(`docs/README.md does not index docs/${name}`);
    }
  }

  for (const document of AUTHORITATIVE_DOCS) {
    const absoluteDocument = join(rootDirectory, document);
    if (!(await exists(absoluteDocument))) {
      issues.push(`missing authoritative document: ${document}`);
      continue;
    }

    const source = await readFile(absoluteDocument, "utf8");
    for (const target of markdownLinkTargets(source)) {
      if (isExternalOrAnchor(target)) continue;
      const localTarget = withoutFragmentOrQuery(target);
      if (!localTarget) continue;
      const decodedTarget = decodeURIComponent(localTarget);
      const absoluteTarget = resolve(dirname(absoluteDocument), decodedTarget);
      if (!(await exists(absoluteTarget))) {
        issues.push(`${document} has broken link: ${target}`);
      }
    }

    NPM_RUN_PATTERN.lastIndex = 0;
    for (const match of source.matchAll(NPM_RUN_PATTERN)) {
      const script = match[1];
      if (script && !scripts.has(script)) {
        issues.push(`${document} references unknown npm script: ${script}`);
      }
    }
  }

  return issues;
}

async function main() {
  const rootDirectory = process.argv[2]
    ? resolve(process.argv[2])
    : process.cwd();
  const issues = await findDocumentationIssues({ rootDirectory });
  if (issues.length === 0) {
    console.log("Documentation guardrails OK.");
    return;
  }

  console.error("Documentation guardrail issues found:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main();
}
