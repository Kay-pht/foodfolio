import { CloudTasksClient } from "@google-cloud/tasks";

export interface AnalysisTaskQueue {
  enqueueRecipeAnalysis(recipeId: string): Promise<void>;
}

export class CloudTasksAnalysisQueue implements AnalysisTaskQueue {
  constructor(
    private readonly config: {
      projectId: string;
      location: string;
      queue: string;
      workerUrl: string;
      serviceAccountEmail: string;
    },
    private readonly client: CloudTasksClient = new CloudTasksClient(),
  ) {}
  async enqueueRecipeAnalysis(recipeId: string): Promise<void> {
    const parent = this.client.queuePath(
      this.config.projectId,
      this.config.location,
      this.config.queue,
    );
    await this.client.createTask({
      parent,
      task: {
        dispatchDeadline: { seconds: 600 },
        httpRequest: {
          httpMethod: "POST",
          url: `${this.config.workerUrl.replace(/\/$/, "")}/internal/tasks/recipe-analysis`,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(JSON.stringify({ recipeId })).toString("base64"),
          oidcToken: {
            serviceAccountEmail: this.config.serviceAccountEmail,
            audience: this.config.workerUrl,
          },
        },
      },
    });
  }
}

type LocalQueueDependencies = {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  onError?: (error: unknown, recipeId: string) => void;
};

export class LocalHttpAnalysisQueue implements AnalysisTaskQueue {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly onError: (error: unknown, recipeId: string) => void;

  constructor(
    private readonly config: {
      workerUrl: string;
      maxAttempts: number;
      retryDelayMs?: number;
    },
    dependencies: LocalQueueDependencies = {},
  ) {
    this.fetchImpl = dependencies.fetch ?? fetch;
    this.sleep =
      dependencies.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.onError =
      dependencies.onError ??
      ((error, recipeId) =>
        console.error("Local recipe analysis dispatch failed", {
          recipeId,
          error,
        }));
  }

  enqueueRecipeAnalysis(recipeId: string): Promise<void> {
    void Promise.resolve()
      .then(() => this.dispatch(recipeId))
      .catch((error: unknown) => this.onError(error, recipeId));
    return Promise.resolve();
  }

  private async dispatch(recipeId: string): Promise<void> {
    const workerUrl = this.config.workerUrl.replace(/\/$/, "");
    const retryDelayMs = this.config.retryDelayMs ?? 250;

    for (let retryCount = 0; retryCount < this.config.maxAttempts; retryCount += 1) {
      try {
        const response = await this.fetchImpl(
          `${workerUrl}/internal/tasks/recipe-analysis`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-cloudtasks-taskretrycount": String(retryCount),
            },
            body: JSON.stringify({ recipeId }),
            signal: AbortSignal.timeout(600_000),
          },
        );
        if (response.ok) return;
        if (response.status < 500) {
          throw new Error(
            `Local worker rejected recipe analysis with HTTP ${response.status}`,
          );
        }
        if (retryCount === this.config.maxAttempts - 1) {
          throw new Error(
            `Local worker failed recipe analysis after ${this.config.maxAttempts} attempts with HTTP ${response.status}`,
          );
        }
      } catch (error) {
        if (retryCount === this.config.maxAttempts - 1) throw error;
      }

      await this.sleep(retryDelayMs * 2 ** retryCount);
    }
  }
}
