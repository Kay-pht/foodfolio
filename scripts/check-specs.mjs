import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SPECS_DIR = join(ROOT, "specs", "tasks");
const REQUIRED_TOP_LEVEL = [
  "id",
  "type",
  "status",
  "objective",
  "requirements",
  "edge_cases",
  "security_invariants",
  "compatibility",
  "non_functional",
  "out_of_scope",
  "acceptance_criteria",
  "regression",
];
const ALLOWED_TYPES = new Set([
  "feature",
  "bug",
  "refactor",
  "security",
  "maintenance",
]);

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
    const relative = `specs/tasks/${filename}`;
    let spec;
    try {
      spec = parseYamlSubset(
        readFileSync(join(SPECS_DIR, filename), "utf8"),
        relative,
      );
    } catch (error) {
      errors.push(error.message);
      continue;
    }

    for (const key of REQUIRED_TOP_LEVEL) {
      if (!(key in spec))
        errors.push(`${relative}: missing required field '${key}'`);
    }
    if (!spec.id || typeof spec.id !== "string")
      errors.push(`${relative}: id must be a non-empty string`);
    if (seenSpecIds.has(spec.id))
      errors.push(
        `${relative}: duplicate spec id '${spec.id}' also used by ${seenSpecIds.get(spec.id)}`,
      );
    else if (spec.id) seenSpecIds.set(spec.id, relative);
    if (!ALLOWED_TYPES.has(spec.type))
      errors.push(`${relative}: unsupported type '${spec.type}'`);
    if (spec.status !== "approved")
      errors.push(
        `${relative}: status must be 'approved' before implementation`,
      );
    if (!spec.objective || typeof spec.objective !== "string")
      errors.push(`${relative}: objective must be non-empty`);

    if (!Array.isArray(spec.requirements) || spec.requirements.length === 0) {
      errors.push(`${relative}: requirements must contain at least one item`);
    } else {
      for (const requirement of spec.requirements) {
        if (!requirement || typeof requirement !== "object") {
          errors.push(`${relative}: every requirement must be an object`);
          continue;
        }
        for (const key of ["id", "condition", "expected", "verification"]) {
          if (!(key in requirement))
            errors.push(`${relative}: requirement is missing '${key}'`);
        }
        if (requirement.id) {
          if (seenRequirementIds.has(requirement.id)) {
            errors.push(
              `${relative}: duplicate requirement id '${requirement.id}' also used by ${seenRequirementIds.get(requirement.id)}`,
            );
          } else {
            seenRequirementIds.set(requirement.id, relative);
          }
        }
        if (
          !Array.isArray(requirement.verification) ||
          requirement.verification.length === 0
        ) {
          errors.push(
            `${relative}:${requirement.id ?? "<unknown>"}: verification must contain at least one path`,
          );
        } else {
          for (const path of requirement.verification) {
            if (typeof path !== "string" || !existsSync(join(ROOT, path))) {
              errors.push(
                `${relative}:${requirement.id ?? "<unknown>"}: verification path does not exist: ${path}`,
              );
            }
          }
        }
      }
    }

    for (const key of [
      "edge_cases",
      "security_invariants",
      "compatibility",
      "non_functional",
      "out_of_scope",
      "acceptance_criteria",
    ]) {
      if (!Array.isArray(spec[key]))
        errors.push(`${relative}: ${key} must be an array`);
    }

    const regression = spec.regression;
    if (!regression || typeof regression !== "object") {
      errors.push(`${relative}: regression must be an object`);
    } else {
      if (spec.type === "bug" && regression.required !== true) {
        errors.push(
          `${relative}: bug specifications must set regression.required: true`,
        );
      }
      if (
        spec.type === "bug" &&
        (!Array.isArray(regression.tests) || regression.tests.length === 0)
      ) {
        errors.push(
          `${relative}: bug specifications must list at least one regression test`,
        );
      }
      if (Array.isArray(regression.tests)) {
        for (const path of regression.tests) {
          if (!existsSync(join(ROOT, path)))
            errors.push(`${relative}: regression test does not exist: ${path}`);
        }
      }
    }
  }

  if (errors.length > 0) fail(errors);
  else
    console.log(
      `Specification check passed for ${files.length} task specification(s).`,
    );
}
