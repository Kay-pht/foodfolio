import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(
  fs.readFileSync(path.join(dir, "results/expected.json"), "utf8"),
);
const actual = JSON.parse(
  fs.readFileSync(path.join(dir, "results/chatgpt-baseline.json"), "utf8"),
);

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000()（）・,、]/g, "");

const equalsNormalized = (a, b) => normalize(a) === normalize(b);

function validateShape(recipe) {
  const errors = [];

  for (const key of [
    "title",
    "servings",
    "cookingTimeMinutes",
    "genre",
    "ingredients",
    "steps",
  ]) {
    if (!(key in recipe)) errors.push(`missing:${key}`);
  }

  if (recipe.title !== null && typeof recipe.title !== "string") {
    errors.push("title:type");
  }

  if (
    recipe.cookingTimeMinutes !== null &&
    !Number.isInteger(recipe.cookingTimeMinutes)
  ) {
    errors.push("cookingTimeMinutes:type");
  }

  if (!Array.isArray(recipe.ingredients)) errors.push("ingredients:type");
  if (!Array.isArray(recipe.steps)) errors.push("steps:type");

  if (recipe.servings !== null) {
    if (typeof recipe.servings !== "object") {
      errors.push("servings:type");
    } else if (!("value" in recipe.servings) || !("raw" in recipe.servings)) {
      errors.push("servings:shape");
    }
  }

  return errors;
}

const actualById = new Map(actual.map((entry) => [entry.id, entry.recipe]));

const rows = [];
let truePositive = 0;
let falsePositive = 0;
let falseNegative = 0;
let amountExact = 0;
let amountCompared = 0;
let schemaSuccess = 0;

for (const item of expected) {
  const expectedRecipe = item.recipe;
  const actualRecipe = actualById.get(item.id);

  if (!actualRecipe) {
    rows.push({ id: item.id, error: "missing result" });
    continue;
  }

  const errors = validateShape(actualRecipe);
  if (errors.length === 0) schemaSuccess += 1;

  const expectedIngredients = new Map(
    expectedRecipe.ingredients.map((ingredient) => [
      normalize(ingredient.name),
      ingredient,
    ]),
  );
  const actualIngredients = new Map(
    actualRecipe.ingredients.map((ingredient) => [
      normalize(ingredient.name),
      ingredient,
    ]),
  );

  for (const [key, ingredient] of actualIngredients) {
    if (expectedIngredients.has(key)) {
      truePositive += 1;
      amountCompared += 1;
      if (
        equalsNormalized(ingredient.amount, expectedIngredients.get(key).amount)
      ) {
        amountExact += 1;
      }
    } else {
      falsePositive += 1;
    }
  }

  for (const key of expectedIngredients.keys()) {
    if (!actualIngredients.has(key)) falseNegative += 1;
  }

  rows.push({
    id: item.id,
    schema: errors.length === 0 ? "OK" : errors.join(","),
    title: equalsNormalized(actualRecipe.title, expectedRecipe.title),
    servingsValue:
      actualRecipe.servings?.value === expectedRecipe.servings?.value,
    cookingTime:
      actualRecipe.cookingTimeMinutes === expectedRecipe.cookingTimeMinutes,
    expectedIngredients: expectedRecipe.ingredients.length,
    actualIngredients: actualRecipe.ingredients.length,
    stepsExpected: expectedRecipe.steps.length,
    stepsActual: actualRecipe.steps.length,
  });
}

const ingredientPrecision = truePositive / (truePositive + falsePositive || 1);
const ingredientRecall = truePositive / (truePositive + falseNegative || 1);

console.table(rows);
console.log(
  JSON.stringify(
    {
      cases: expected.length,
      schemaSuccessRate: schemaSuccess / expected.length,
      ingredientPrecision,
      ingredientRecall,
      ingredientAmountExactRate: amountExact / (amountCompared || 1),
    },
    null,
    2,
  ),
);

console.log(
  "\nNOTE: chatgpt-baseline.json is an in-chat smoke-test baseline, not a cross-provider benchmark.",
);
