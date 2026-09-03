import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TODO_TITLE = "# Foodfolio TODO";
const COMPLETED_TITLE = "# Foodfolio 完了済みタスク";
const TOP_LEVEL_TASK_PATTERN = /^- \[([ xX])\](?:\s|$)/;

function normalizeNewlines(content) {
  return content.replace(/\r\n?/g, "\n");
}

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === "") {
    start += 1;
  }
  while (end > start && lines[end - 1].trim() === "") {
    end -= 1;
  }

  return lines.slice(start, end);
}

function isTopLevelTask(line) {
  return TOP_LEVEL_TASK_PATTERN.test(line);
}

function isTopLevelCommentStart(line) {
  return line.startsWith("<!--");
}

function taskIsCompleted(line) {
  const match = line.match(TOP_LEVEL_TASK_PATTERN);
  return match?.[1].toLowerCase() === "x";
}

export function parseTaskDocument(content) {
  const lines = normalizeNewlines(content).split("\n");

  if (lines[0]?.startsWith("# ")) {
    lines.shift();
  }

  const bodyLines = trimBlankLines(lines);
  const segments = [];
  let index = 0;

  while (index < bodyLines.length) {
    if (bodyLines[index].trim() === "") {
      index += 1;
      continue;
    }

    const start = index;

    if (isTopLevelTask(bodyLines[index])) {
      index += 1;
      while (
        index < bodyLines.length &&
        !isTopLevelTask(bodyLines[index]) &&
        !isTopLevelCommentStart(bodyLines[index])
      ) {
        index += 1;
      }

      const segmentLines = trimBlankLines(bodyLines.slice(start, index));
      segments.push({
        kind: "task",
        completed: taskIsCompleted(segmentLines[0]),
        text: segmentLines.join("\n"),
      });
      continue;
    }

    if (isTopLevelCommentStart(bodyLines[index])) {
      index += 1;
      while (
        index < bodyLines.length &&
        !bodyLines[index - 1].includes("-->")
      ) {
        index += 1;
      }
    } else {
      index += 1;
      while (
        index < bodyLines.length &&
        !isTopLevelTask(bodyLines[index]) &&
        !isTopLevelCommentStart(bodyLines[index])
      ) {
        index += 1;
      }
    }

    const segmentLines = trimBlankLines(bodyLines.slice(start, index));
    segments.push({ kind: "content", text: segmentLines.join("\n") });
  }

  return segments;
}

function renderDocument(title, segments) {
  const body = segments.reduce((result, segment, index) => {
    if (index === 0) {
      return segment.text;
    }

    const previousSegment = segments[index - 1];
    const separator =
      previousSegment.kind === "content" || segment.kind === "content"
        ? "\n\n"
        : "\n";
    return `${result}${separator}${segment.text}`;
  }, "");
  return body ? `${title}\n\n${body}\n` : `${title}\n`;
}

export function syncTaskDocuments(todoContent, completedContent) {
  const todoSegments = parseTaskDocument(todoContent);
  const completedSegments = parseTaskDocument(completedContent);

  const restoredTodoTasks = completedSegments.filter(
    (segment) => segment.kind === "task" && !segment.completed,
  );
  const retainedCompletedSegments = completedSegments.filter(
    (segment) => segment.kind !== "task" || segment.completed,
  );
  const retainedTodoSegments = todoSegments.filter(
    (segment) => segment.kind !== "task" || !segment.completed,
  );
  const newlyCompletedTasks = todoSegments.filter(
    (segment) => segment.kind === "task" && segment.completed,
  );

  return {
    todo: renderDocument(TODO_TITLE, [
      ...restoredTodoTasks,
      ...retainedTodoSegments,
    ]),
    completed: renderDocument(COMPLETED_TITLE, [
      ...retainedCompletedSegments,
      ...newlyCompletedTasks,
    ]),
  };
}

async function readIfPresent(filePath, fallback) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function main() {
  const checkOnly = process.argv.slice(2).includes("--check");
  const tasksDirectory = path.resolve(process.cwd(), "tasks");
  const todoPath = path.join(tasksDirectory, "todo.md");
  const completedPath = path.join(tasksDirectory, "completed.md");
  const todoContent = await readIfPresent(todoPath, "");
  const completedContent = await readIfPresent(completedPath, "");
  const synced = syncTaskDocuments(todoContent, completedContent);

  if (checkOnly) {
    const mismatches = [];
    for (const [filePath, actual, expected] of [
      [todoPath, todoContent, synced.todo],
      [completedPath, completedContent, synced.completed],
    ]) {
      try {
        await access(filePath);
      } catch {
        mismatches.push(path.relative(process.cwd(), filePath));
        continue;
      }
      if (normalizeNewlines(actual) !== expected) {
        mismatches.push(path.relative(process.cwd(), filePath));
      }
    }

    if (mismatches.length > 0) {
      throw new Error(
        `タスクの仕分けが必要です: ${mismatches.join(", ")}。npm run tasks:sync を実行してください。`,
      );
    }

    console.log("Task files are correctly classified.");
    return;
  }

  await mkdir(tasksDirectory, { recursive: true });
  await Promise.all([
    writeFile(todoPath, synced.todo),
    writeFile(completedPath, synced.completed),
  ]);
  console.log("Task files were classified into todo.md and completed.md.");
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
