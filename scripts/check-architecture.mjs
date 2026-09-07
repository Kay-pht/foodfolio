import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const LAYERS = new Set([
  "domain",
  "application",
  "infrastructure",
  "api",
  "entrypoints",
]);

const BLOCKED_IMPORTS = new Map([
  ["domain", new Set(["application", "infrastructure", "api", "entrypoints"])],
  ["application", new Set(["infrastructure", "api", "entrypoints"])],
  ["infrastructure", new Set(["api", "entrypoints"])],
  ["api", new Set(["entrypoints"])],
  ["entrypoints", new Set()],
]);

async function listTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTypeScriptFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

function literalModuleSpecifier(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function moduleSpecifiers(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers = new Set();

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      const specifier = literalModuleSpecifier(node.moduleSpecifier);
      if (specifier) specifiers.add(specifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const specifier = literalModuleSpecifier(node.arguments[0]);
      if (specifier) specifiers.add(specifier);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...specifiers];
}

function layerFromRelativePath(path) {
  const [firstSegment] = path.split(sep);
  return firstSegment && LAYERS.has(firstSegment) ? firstSegment : undefined;
}

function importedLayer({ sourceFile, specifier, srcRoot }) {
  if (!specifier.startsWith(".")) return undefined;
  const target = resolve(dirname(sourceFile), specifier);
  const targetRelative = relative(srcRoot, target);
  if (targetRelative.startsWith(`..${sep}`) || targetRelative === "..") {
    return undefined;
  }
  return layerFromRelativePath(targetRelative);
}

export async function findArchitectureViolations({
  rootDirectory = process.cwd(),
} = {}) {
  const srcRoot = join(rootDirectory, "src");
  const files = await listTypeScriptFiles(srcRoot);
  const violations = [];

  for (const sourceFile of files) {
    const sourceRelative = relative(srcRoot, sourceFile);
    const sourceLayer = layerFromRelativePath(sourceRelative);
    if (!sourceLayer) continue;

    const blocked = BLOCKED_IMPORTS.get(sourceLayer);
    if (!blocked?.size) continue;

    const source = await readFile(sourceFile, "utf8");
    for (const specifier of moduleSpecifiers(source, sourceFile)) {
      const targetLayer = importedLayer({ sourceFile, specifier, srcRoot });
      if (!targetLayer || !blocked.has(targetLayer)) continue;
      violations.push({
        source: `src/${sourceRelative.split(sep).join("/")}`,
        sourceLayer,
        targetLayer,
        specifier,
      });
    }
  }

  return violations;
}

async function main() {
  const rootDirectory = process.argv[2]
    ? resolve(process.argv[2])
    : process.cwd();
  const violations = await findArchitectureViolations({ rootDirectory });
  if (violations.length === 0) {
    console.log("Architecture boundaries OK.");
    return;
  }

  console.error("Architecture boundary violations found:");
  for (const violation of violations) {
    console.error(
      `- ${violation.source}: ${violation.sourceLayer} -> ${violation.targetLayer} via ${violation.specifier}`,
    );
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main();
}
