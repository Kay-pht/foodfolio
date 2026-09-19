export const DEFAULT_BATCH_SIZE = 100;
export const MAX_BATCH_SIZE = 100;

export interface BatchSelectableCase {
  id: string;
  expected: "recipe" | "non-recipe";
  completedRuns: number;
  hasTerminalError: boolean;
  retryPriority?: boolean;
}

export function parseBatchSize(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_BATCH_SIZE);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_BATCH_SIZE) {
    throw new Error(
      `JEV_POC_BATCH_SIZE must be an integer from 1 to ${MAX_BATCH_SIZE}`,
    );
  }
  return parsed;
}

export function selectBatchCaseIds(
  cases: BatchSelectableCase[],
  repetitions: number,
  batchSize: number = DEFAULT_BATCH_SIZE,
): string[] {
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error("repetitions must be a positive integer");
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be from 1 to ${MAX_BATCH_SIZE}`);
  }

  const pending = cases.filter(
    (item) => !item.hasTerminalError && item.completedRuns < repetitions,
  );
  const priority = pending.filter((item) => item.retryPriority === true);
  const priorityIds = new Set(priority.map(({ id }) => id));
  const nonPriority = pending.filter((item) => !priorityIds.has(item.id));
  const partial = nonPriority.filter((item) => item.completedRuns > 0);
  const freshRecipe = nonPriority.filter(
    (item) => item.completedRuns === 0 && item.expected === "recipe",
  );
  const freshNonRecipe = nonPriority.filter(
    (item) => item.completedRuns === 0 && item.expected === "non-recipe",
  );

  const selected = [...priority, ...partial].slice(0, batchSize);
  let recipeIndex = 0;
  let nonRecipeIndex = 0;

  while (selected.length < batchSize) {
    const selectedRecipeCount = selected.filter(
      ({ expected }) => expected === "recipe",
    ).length;
    const selectedNonRecipeCount = selected.length - selectedRecipeCount;
    const preferRecipe = selectedRecipeCount <= selectedNonRecipeCount;
    const preferred = preferRecipe
      ? freshRecipe[recipeIndex]
      : freshNonRecipe[nonRecipeIndex];
    const fallback = preferRecipe
      ? freshNonRecipe[nonRecipeIndex]
      : freshRecipe[recipeIndex];
    const next = preferred ?? fallback;

    if (!next) break;

    selected.push(next);
    if (next.expected === "recipe") {
      recipeIndex += 1;
    } else {
      nonRecipeIndex += 1;
    }
  }

  return selected.map(({ id }) => id);
}
