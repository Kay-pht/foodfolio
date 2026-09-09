import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const ZERO_SHA_PATTERN = /^0+$/;
const IOS_PATHS = new Set([
  ".swift-format",
  "scripts/format-ios.sh",
  "scripts/lint-ios.sh",
  "scripts/push-simulator-notification.sh",
  "scripts/test-ios.sh",
  "scripts/verify-ios.sh",
]);
const SPEC_EXEMPT_REPOSITORY_METADATA = new Set([
  ".gitignore",
  ".prettierignore",
  ".prettierignore.markdown",
  ".swift-format",
]);

function normalizePath(path) {
  return path.replace(/^\.\/+/, "");
}

function isDocumentationPath(path) {
  return path.endsWith(".md") || path.startsWith("docs/");
}

function isDocumentationWorkflowPath(path) {
  return (
    isDocumentationPath(path) ||
    path === "package.json" ||
    path === "scripts/check-docs.mjs" ||
    path === ".github/workflows/documentation.yml"
  );
}

function isIosPath(path) {
  return path.startsWith("ios/") || IOS_PATHS.has(path);
}

function isTerraformPath(path) {
  return path.startsWith("infra/terraform/");
}

function isWorkflowPath(path) {
  return path.startsWith(".github/workflows/");
}

function isTestOnlyPath(path) {
  return (
    path.startsWith("tests/") ||
    path.startsWith("ios/FoodfolioTests/") ||
    path.startsWith("ios/FoodfolioIntegrationTests/") ||
    path.startsWith("ios/FoodfolioUITests/")
  );
}

function isTaskSpecificationPath(path) {
  return path.startsWith("specs/tasks/");
}

function isSpecificationRequiredPath(path) {
  if (
    isDocumentationPath(path) ||
    isTestOnlyPath(path) ||
    isTaskSpecificationPath(path) ||
    SPEC_EXEMPT_REPOSITORY_METADATA.has(path) ||
    path.startsWith(".vscode/")
  ) {
    return false;
  }

  // Specification enforcement must fail safe. Application code, CI workflows,
  // developer automation, infrastructure, shared configuration, and any new
  // implementation path can change observable behavior. Explicitly exempt only
  // paths that are mechanically known to be documentation, tests, task specs,
  // or editor/formatting metadata.
  return true;
}

export function classifyQualityPaths(paths) {
  let backend = false;
  let ios = false;

  for (const rawPath of paths) {
    const path = normalizePath(rawPath);
    if (!path) {
      continue;
    }
    if (isIosPath(path)) {
      ios = true;
      continue;
    }
    if (isDocumentationPath(path)) {
      continue;
    }

    // Treat every unknown or shared path as backend-affecting. This fails safe
    // when new repository-level configuration or source directories are added.
    backend = true;
  }

  return { backend, ios };
}

export function classifySpecificationPaths(paths) {
  let specRequired = false;

  for (const rawPath of paths) {
    const path = normalizePath(rawPath);
    if (!path) {
      continue;
    }
    specRequired ||= isSpecificationRequiredPath(path);
  }

  return { spec_required: specRequired };
}

export function classifyAutomationPaths(paths) {
  let docs = false;
  let documentation = false;
  let terraform = false;
  let workflows = false;

  for (const rawPath of paths) {
    const path = normalizePath(rawPath);
    if (!path) {
      continue;
    }
    docs ||= isDocumentationPath(path);
    documentation ||= isDocumentationWorkflowPath(path);
    terraform ||= isTerraformPath(path);
    workflows ||= isWorkflowPath(path);
  }

  return { docs, documentation, terraform, workflows };
}

async function changedPaths(baseSha, headSha) {
  const { stdout } = await execFileAsync("git", [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    baseSha,
    headSha,
    "--",
  ]);
  return stdout.split("\n").filter(Boolean);
}

async function writeOutput(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is required");
  }
  await appendFile(
    outputPath,
    [
      `backend=${result.backend}`,
      `ios=${result.ios}`,
      `spec_required=${result.spec_required}`,
      `docs=${result.docs}`,
      `documentation=${result.documentation}`,
      `terraform=${result.terraform}`,
      `workflows=${result.workflows}`,
      "",
    ].join("\n"),
  );
}

async function main() {
  const baseSha = process.env.QUALITY_BASE_SHA;
  const headSha = process.env.QUALITY_HEAD_SHA;

  try {
    if (
      !baseSha ||
      !headSha ||
      !GIT_SHA_PATTERN.test(baseSha) ||
      !GIT_SHA_PATTERN.test(headSha) ||
      ZERO_SHA_PATTERN.test(baseSha) ||
      ZERO_SHA_PATTERN.test(headSha)
    ) {
      throw new Error(
        "QUALITY_BASE_SHA and QUALITY_HEAD_SHA must be Git object IDs",
      );
    }

    const paths = await changedPaths(baseSha, headSha);
    const result = {
      ...classifyQualityPaths(paths),
      ...classifySpecificationPaths(paths),
      ...classifyAutomationPaths(paths),
    };
    console.log(
      `Changed paths: ${paths.length}; backend=${result.backend}; ios=${result.ios}; spec_required=${result.spec_required}; docs=${result.docs}; documentation=${result.documentation}; terraform=${result.terraform}; workflows=${result.workflows}.`,
    );
    await writeOutput(result);
  } catch (error) {
    console.warn(
      `Could not classify Quality changes; running all checks safely. ${error instanceof Error ? error.message : String(error)}`,
    );
    await writeOutput({
      backend: true,
      ios: true,
      spec_required: true,
      docs: true,
      documentation: true,
      terraform: true,
      workflows: true,
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
