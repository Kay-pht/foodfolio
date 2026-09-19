export const DEFAULT_BATCH_SIZE = 100;
export const MAX_BATCH_SIZE = 1_000;

export interface BatchCandidate {
  id: string;
  expected: "recipe" | "non-recipe";
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

export function selectBalancedBatch<T extends BatchCandidate>(
  candidates: T[],
  completedIds: ReadonlySet<string>,
  batchSize: number,
): T[] {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("batchSize must be a positive integer");
  }

  const remaining = candidates.filter(({ id }) => !completedIds.has(id));
  const recipe = remaining.filter(({ expected }) => expected === "recipe");
  const nonRecipe = remaining.filter(
    ({ expected }) => expected === "non-recipe",
  );

  const recipeTarget = Math.floor(batchSize / 2);
  const nonRecipeTarget = batchSize - recipeTarget;
  const selected = [
    ...recipe.slice(0, recipeTarget),
    ...nonRecipe.slice(0, nonRecipeTarget),
  ];

  if (selected.length >= batchSize) return selected.slice(0, batchSize);

  const selectedIds = new Set(selected.map(({ id }) => id));
  for (const candidate of remaining) {
    if (selected.length >= batchSize) break;
    if (selectedIds.has(candidate.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }

  return selected;
}
