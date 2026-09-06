import { describe, expect, it } from "vitest";
import { NoopNotificationSender } from "../../src/infrastructure/notifications/noop-notification-sender.js";

describe("NoopNotificationSender", () => {
  it("acknowledges local notification calls without invalid tokens", async () => {
    const sender = new NoopNotificationSender();

    await expect(
      sender.sendRecipeAnalysisCompleted([], "recipe-1", "Recipe"),
    ).resolves.toEqual([]);
    await expect(
      sender.sendRecipeAnalysisFailed([], "recipe-1", "Recipe"),
    ).resolves.toEqual([]);
  });
});
