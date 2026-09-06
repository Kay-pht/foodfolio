import type { NotificationSender } from "../../application/analysis/types.js";

export class NoopNotificationSender implements NotificationSender {
  sendRecipeAnalysisCompleted(): Promise<string[]> {
    return Promise.resolve([]);
  }

  sendRecipeAnalysisFailed(): Promise<string[]> {
    return Promise.resolve([]);
  }
}
