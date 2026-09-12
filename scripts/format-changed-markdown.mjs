import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const ZERO_SHA_PATTERN = /^0+$/;

export function selectMarkdownPaths(paths) {
  return [...new Set(paths)]
    .map((path) => path.replace(/^\.\/+/, ""))
    .filter((path) => path.endsWith(".md"))
    .sort();
}

async function gitLines(args) {
  const { stdout } = await execFileAsync("git", args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.split("\n").filter(Boolean);
}

async function changedPaths(baseSha, headSha) {
  if (ZERO_SHA_PATTERN.test(baseSha)) {
    return gitLines(["ls-tree", "-r", "--name-only", headSha]);
  }
  return gitLines([
    "diff",
    "--name-only",
    "--diff-filter=ACMRTUXB",
    baseSha,
    headSha,
    "--",
  ]);
}

async function workingTreePaths() {
  const [unstaged, staged, untracked] = await Promise.all([
    gitLines(["diff", "--name-only", "--diff-filter=ACMRTUXB", "--"]),
    gitLines([
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMRTUXB",
      "--",
    ]),
    gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  return [...unstaged, ...staged, ...untracked];
}

async function existingPaths(paths) {
  const results = await Promise.all(
    paths.map(async (path) => {
      try {
        await access(path);
        return path;
      } catch {
        return undefined;
      }
    }),
  );
  return results.filter(Boolean);
}

async function runPrettier(mode, paths) {
  const { stdout, stderr } = await execFileAsync(
    "npx",
    [
      "--yes",
      "prettier@3.9.6",
      "--ignore-path",
      ".prettierignore.markdown",
      mode,
      ...paths,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}

async function main() {
  const mode = process.argv[2];
  const baseSha = process.env.MARKDOWN_BASE_SHA;
  const headSha = process.env.MARKDOWN_HEAD_SHA;

  if (mode !== "--write" && mode !== "--check") {
    throw new Error("Expected --write or --check");
  }
  if (
    !baseSha ||
    !headSha ||
    !GIT_SHA_PATTERN.test(baseSha) ||
    !GIT_SHA_PATTERN.test(headSha) ||
    ZERO_SHA_PATTERN.test(headSha)
  ) {
    throw new Error(
      "MARKDOWN_BASE_SHA and MARKDOWN_HEAD_SHA must be Git object IDs",
    );
  }

  const paths = selectMarkdownPaths([
    ...(await changedPaths(baseSha, headSha)),
    ...(mode === "--write" ? await workingTreePaths() : []),
  ]);
  const existing = await existingPaths(paths);
  if (existing.length === 0) {
    console.log("No changed Markdown files to format.");
    return;
  }

  console.log(
    `${mode === "--write" ? "Formatting" : "Checking"} ${existing.length} changed Markdown file(s).`,
  );
  await runPrettier(mode, existing);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
