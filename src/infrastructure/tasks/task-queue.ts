import { CloudTasksClient } from "@google-cloud/tasks";

export interface AnalysisTaskQueue {
  enqueueRecipeAnalysis(recipeId: string): Promise<void>;
}

export class CloudTasksAnalysisQueue implements AnalysisTaskQueue {
  private readonly client = new CloudTasksClient();
  constructor(
    private readonly config: {
      projectId: string;
      location: string;
      queue: string;
      workerUrl: string;
      serviceAccountEmail: string;
    },
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
