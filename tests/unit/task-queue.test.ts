import type { CloudTasksClient } from "@google-cloud/tasks";
import { describe, expect, it, vi } from "vitest";
import { CloudTasksAnalysisQueue } from "../../src/infrastructure/tasks/task-queue.js";

describe("CloudTasksAnalysisQueue", () => {
  it("sets a ten-minute dispatch deadline for video fallback processing", async () => {
    const createTask = vi.fn(async () => []);
    const client = {
      queuePath: vi.fn(() => "projects/project/locations/region/queues/queue"),
      createTask,
    } as unknown as CloudTasksClient;
    const queue = new CloudTasksAnalysisQueue(
      {
        projectId: "project",
        location: "region",
        queue: "queue",
        workerUrl: "https://worker.example/",
        serviceAccountEmail: "worker@example.iam.gserviceaccount.com",
      },
      client,
    );

    await queue.enqueueRecipeAnalysis("recipe-1");

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          dispatchDeadline: { seconds: 600 },
          httpRequest: expect.objectContaining({
            url: "https://worker.example/internal/tasks/recipe-analysis",
          }),
        }),
      }),
    );
  });
});
