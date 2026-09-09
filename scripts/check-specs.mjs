import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

const ROOT = realpathSync(process.cwd());
const SPECS_DIR = join(ROOT, "specs", "tasks");
const SCHEMA_PATH = join(ROOT, "specs", "schema.json");
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

function stripComment(line) {
  let single = false;
  let double = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "'" && !double) single = !single;
    if (char === '"' && !single && line[i - 1] !== "\\") double = !double;
    if (
      char === "#" &&
      !single &&
      !double &&
      (i === 0 || /\s/.test(line[i - 1]))
    ) {
      return line.slice(0, i);
    }
  }
  return line;
}

function scalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "[]") return [];
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseYamlSubset(source, file) {
  const rawLines = source.replace(/\r\n/g, "\n").split("\n");
  const lines = rawLines.map((raw, index) => ({
    raw,
    line: index + 1,
    indent: raw.match(/^ */)[0].length,
  }));

  function nextMeaningful(start) {
    for (let i = start; i < lines.length; i += 1) {
      const text = stripComment(lines[i].raw).trim();
      if (text) return i;
    }
    return -1;
  }

  function parseBlock(start, indent) {
    const first = nextMeaningful(start);
    if (first < 0) return [{}, lines.length];
    const firstText = stripComment(lines[first].raw).trim();
    const isArray = firstText.startsWith("- ") || firstText === "-";
    const container = isArray ? [] : {};
    let i = first;

    while (i < lines.length) {
      const item = lines[i];
      const text = stripComment(item.raw).trim();
      if (!text) {
        i += 1;
        continue;
      }
      if (item.indent < indent) break;
      if (item.indent > indent) {
        throw new Error(`${file}:${item.line}: unexpected indentation`);
      }

      if (isArray) {
        if (!(text.startsWith("- ") || text === "-")) {
          throw new Error(
            `${file}:${item.line}: mixed array/object indentation`,
          );
        }
        const rest = text.slice(1).trim();
        if (!rest) {
          const next = nextMeaningful(i + 1);
          if (next < 0 || lines[next].indent <= indent) {
            container.push(null);
            i += 1;
            continue;
          }
          const [child, end] = parseBlock(next, lines[next].indent);
          container.push(child);
          i = end;
          continue;
        }
        const colon = rest.indexOf(":");
        if (colon > 0) {
          const obj = {};
          const key = rest.slice(0, colon).trim();
          const value = rest.slice(colon + 1).trim();
          obj[key] = scalar(value);
          i += 1;
          const next = nextMeaningful(i);
          if (next >= 0 && lines[next].indent > indent) {
            const [child, end] = parseBlock(next, lines[next].indent);
            if (Array.isArray(child)) {
              throw new Error(
                `${file}:${lines[next].line}: expected object fields`,
              );
            }
            Object.assign(obj, child);
            i = end;
          }
          container.push(obj);
          continue;
        }
        container.push(scalar(rest));
        i += 1;
        continue;
      }

      const colon = text.indexOf(":");
      if (colon <= 0)
        throw new Error(`${file}:${item.line}: expected key: value`);
      const key = text.slice(0, colon).trim();
      const value = text.slice(colon + 1).trim();

      if (value === ">-" || value === "|-") {
        const folded = [];
        i += 1;
        while (
          i < lines.length &&
          (lines[i].raw.trim() === "" || lines[i].indent > indent)
        ) {
          if (lines[i].raw.trim()) folded.push(lines[i].raw.trim());
          i += 1;
        }
        container[key] = value === ">-" ? folded.join(" ") : folded.join("\n");
        continue;
      }

      if (value) {
        container[key] = scalar(value);
        i += 1;
        continue;
      }

      const next = nextMeaningful(i + 1);
      if (next < 0 || lines[next].indent <= indent) {
        container[key] = null;
        i += 1;
        continue;
      }
      const [child, end] = parseBlock(next, lines[next].indent);
      container[key] = child;
      i = end;
    }

    return [container, i];
  }

  return parseBlock(0, 0)[0];
}

function fail(errors) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
}

function isOutsideRoot(path) {
  const fromRoot = relative(ROOT, path);
  return (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  );
}

function repositoryFileIssue(path) {
  const absolute = resolve(ROOT, path);
  if (isOutsideRoot(absolute)) return "escapes repository";

  let realPath;
  try {
    realPath = realpathSync(absolute);
  } catch {
    return "does not exist";
  }

  if (isOutsideRoot(realPath)) return "resolves outside repository";
  if (!statSync(realPath).isFile()) return "is not a file";
  return undefined;
}

function appendSchemaErrors(errors, relativePath) {
  for (const error of validateSchema.errors ?? []) {
    const location = error.instancePath || "/";
    const additionalProperty = error.params?.additionalProperty;
    const suffix = additionalProperty ? ` (${additionalProperty})` : "";
    errors.push(
      `${relativePath}: schema ${location}: ${error.message ?? error.keyword}${suffix}`,
    );
  }
}

const files = readdirSync(SPECS_DIR)
  .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
  .sort();
if (files.length === 0) {
  fail(["No task specifications found in specs/tasks."]);
} else {
  const errors = [];
  const seenSpecIds = new Map();
  const seenRequirementIds = new Map();

  for (const filename of files) {
    const relativePath = `specs/tasks/${filename}`;
    let spec;
    try {
      spec = parseYamlSubset(
        readFileSync(join(SPECS_DIR, filename), "utf8"),
        relativePath,
      );
    } catch (error) {
      errors.push(error.message);
      continue;
    }

    if (!validateSchema(spec)) {
      appendSchemaErrors(errors, relativePath);
      continue;
    }

    if (seenSpecIds.has(spec.id)) {
      errors.push(
        `${relativePath}: duplicate spec id '${spec.id}' also used by ${seenSpecIds.get(spec.id)}`,
      );
    } else {
      seenSpecIds.set(spec.id, relativePath);
    }

    for (const requirement of spec.requirements) {
      if (seenRequirementIds.has(requirement.id)) {
        errors.push(
          `${relativePath}: duplicate requirement id '${requirement.id}' also used by ${seenRequirementIds.get(requirement.id)}`,
        );
      } else {
        seenRequirementIds.set(requirement.id, relativePath);
      }

      for (const path of requirement.verification) {
        const issue = repositoryFileIssue(path);
        if (issue) {
          errors.push(
            `${relativePath}:${requirement.id}: verification path ${issue}: ${path}`,
          );
        }
      }
    }

    if (spec.type === "bug" && spec.regression.required !== true) {
      errors.push(
        `${relativePath}: bug specifications must set regression.required: true`,
      );
    }
    if (spec.type === "bug" && spec.regression.tests.length === 0) {
      errors.push(
        `${relativePath}: bug specifications must list at least one regression test`,
      );
    }
    for (const path of spec.regression.tests) {
      const issue = repositoryFileIssue(path);
      if (issue) {
        errors.push(`${relativePath}: regression test path ${issue}: ${path}`);
      }
    }
  }

  if (errors.length > 0) fail(errors);
  else
    console.log(
      `Specification check passed for ${files.length} task specification(s).`,
    );
}
