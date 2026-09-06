import type { CloudTasksClient } from "@google-cloud/tasks";
import { describe, expect, it, vi } from "vitest";
import {
  CloudTasksAnalysisQueue,
  LocalHttpAnalysisQueue,
} from "../../src/infrastructure/tasks/task-queue.js";

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

describe("LocalHttpAnalysisQueue", () => {
  it("returns before the local worker finishes processing", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const onError = vi.fn();
    const queue = new LocalHttpAnalysisQueue(
      {
        workerUrl: "http://127.0.0.1:8081/",
        maxAttempts: 3,
      },
      { fetch: fetchImpl, onError },
    );

    await expect(queue.enqueueRecipeAnalysis("recipe-1")).resolves.toBeUndefined();
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolveFetch).toBeDefined();
    resolveFetch?.(new Response(null, { status: 204 }));
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it("retries retryable worker responses with Cloud Tasks retry headers", async () => {
    let callCount = 0;
    let resolveSecondCall: (() => void) | undefined;
    const secondCall = new Promise<void>((resolve) => {
      resolveSecondCall = resolve;
    });
    const requestInits: Array<RequestInit | undefined> = [];
    const fetchImpl = vi.fn(
      async (...args: Parameters<typeof fetch>) => {
        requestInits.push(args[1]);
        callCount += 1;
        if (callCount === 1) return new Response(null, { status: 503 });
        resolveSecondCall?.();
        return new Response(null, { status: 204 });
      },
    );
    const sleep = vi.fn(async () => undefined);
    const queue = new LocalHttpAnalysisQueue(
      {
        workerUrl: "http://127.0.0.1:8081",
        maxAttempts: 3,
      },
      { fetch: fetchImpl, sleep },
    );

    await queue.enqueueRecipeAnalysis("recipe-2");
    await secondCall;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(requestInits[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-cloudtasks-taskretrycount": "0",
        }),
      }),
    );
    expect(requestInits[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-cloudtasks-taskretrycount": "1",
        }),
      }),
    );
  });

  it("does not retry non-retryable worker responses", async () => {
    let resolveFailure: (() => void) | undefined;
    const failure = new Promise<void>((resolve) => {
      resolveFailure = resolve;
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 400 }));
    const sleep = vi.fn(async () => undefined);
    const onError = vi.fn(() => resolveFailure?.());
    const queue = new LocalHttpAnalysisQueue(
      {
        workerUrl: "http://127.0.0.1:8081",
        maxAttempts: 3,
      },
      { fetch: fetchImpl, sleep, onError },
    );

    await queue.enqueueRecipeAnalysis("recipe-3");
    await failure;

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
