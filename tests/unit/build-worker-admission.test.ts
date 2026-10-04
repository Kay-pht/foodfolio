import { describe, expect, it, vi } from "vitest";
import {
  buildWorker,
  type RecipeAnalysisProcessor,
} from "../../src/api/build-worker.js";

describe("buildWorker analysis admission lifecycle", () => {
  it("ICR-5 acknowledges only after analysis and admission finalization finish", async () => {
    let completeAnalysis!: (result: { retry: boolean }) => void;
    let completeAdmission!: () => void;
    const analysis = new Promise<{ retry: boolean }>((resolve) => {
      completeAnalysis = resolve;
    });
    const admission = new Promise<void>((resolve) => {
      completeAdmission = resolve;
    });
    const process = vi.fn(() => analysis);
    const finishAdmission = vi.fn(() => admission);
    const app = buildWorker({ process }, finishAdmission);
    let acknowledged = false;
    const response = app
      .inject({
        method: "POST",
        url: "/internal/tasks/recipe-analysis",
        payload: { recipeId: "00000000-0000-0000-0000-000000000003" },
      })
      .then((result) => {
        acknowledged = true;
        return result;
      });

    try {
      await vi.waitFor(() => expect(process).toHaveBeenCalledOnce());
      expect(acknowledged).toBe(false);
      expect(finishAdmission).not.toHaveBeenCalled();
      completeAnalysis({ retry: false });
      await vi.waitFor(() => expect(finishAdmission).toHaveBeenCalledOnce());
      expect(acknowledged).toBe(false);
      completeAdmission();
      expect((await response).statusCode).toBe(204);
      expect(acknowledged).toBe(true);
    } finally {
      completeAnalysis({ retry: false });
      completeAdmission();
      await response;
      await app.close();
    }
  });

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
