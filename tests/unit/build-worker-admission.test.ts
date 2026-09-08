import { describe, expect, it, vi } from "vitest";
import {
  buildWorker,
  type RecipeAnalysisProcessor,
} from "../../src/api/build-worker.js";

describe("buildWorker analysis admission lifecycle", () => {
  it("finishes the admission after a terminal analysis result", async () => {
    const service: RecipeAnalysisProcessor = {
      process: vi.fn(async () => ({ retry: false })),
    };
    const finishAdmission = vi.fn(async () => {});
    const app = buildWorker(service, finishAdmission);

    const response = await app.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      payload: { recipeId: "00000000-0000-0000-0000-000000000001" },
    });

    expect(response.statusCode).toBe(204);
    expect(finishAdmission).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
    );
    await app.close();
  });

  it("keeps the admission outstanding while Cloud Tasks should retry", async () => {
    const service: RecipeAnalysisProcessor = {
      process: vi.fn(async () => ({ retry: true })),
    };
    const finishAdmission = vi.fn(async () => {});
    const app = buildWorker(service, finishAdmission);

    const response = await app.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      payload: { recipeId: "00000000-0000-0000-0000-000000000002" },
    });

    expect(response.statusCode).toBe(503);
    expect(finishAdmission).not.toHaveBeenCalled();
    await app.close();
  });
});
