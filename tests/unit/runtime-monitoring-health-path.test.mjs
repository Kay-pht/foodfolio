import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

const monitoring = await readFile(
  new URL("../../infra/terraform/monitoring.tf", import.meta.url),
  "utf8",
);

function resource(name, nextName) {
  const start = monitoring.indexOf(
    `resource "google_monitoring_alert_policy" "${name}"`,
  );
  const end = nextName
    ? monitoring.indexOf(
        `resource "google_monitoring_alert_policy" "${nextName}"`,
        start,
      )
    : monitoring.length;
  return monitoring.slice(start, end);
}

describe("public API uptime check", () => {
  it("checks the deployed /health endpoint and names it in the incident", () => {
    const uptime = monitoring.split(
      'resource "google_monitoring_alert_policy" "api_5xx"',
    )[0];

    expect(uptime).toMatch(/path\s*=\s*"\/health"/);
    expect(uptime).toContain("`/health` が再び成功");
    expect(uptime).toContain('status_class = "STATUS_CLASS_2XX"');
    expect(uptime).toContain('json_path    = "$.status"');
    expect(uptime).toContain(String.raw`content = "\"ok\""`);
  });
});

describe("actionable runtime alert notifications", () => {
  it("explains the impact and first response for every metric alert", () => {
    const policies = [
      resource("api_uptime", "api_5xx"),
      resource("api_5xx", "recipe_analysis_final_failure"),
      resource("api_memory_high", "worker_memory_high"),
      resource("worker_memory_high"),
    ];

    for (const policy of policies) {
      expect(policy).toContain("## 何が起きたか");
      expect(policy).toContain("## 最初に行うこと");
      expect(policy).toContain("`Alert closed`");
    }
  });

  it("preserves the 5xx response class after aggregation", () => {
    expect(resource("api_5xx", "recipe_analysis_final_failure")).toContain(
      'group_by_fields      = ["resource.label.service_name", "metric.label.response_code_class"]',
    );
  });

  it("keeps Worker memory investigation broad while final failures stay filtered", () => {
    const workerMemory = resource("worker_memory_high");
    const finalFailure = resource(
      "recipe_analysis_final_failure",
      "api_memory_high",
    );

    expect(monitoring).toContain("worker_logs_url");
    expect(workerMemory).toContain("${local.worker_logs_url}");
    expect(workerMemory).not.toContain("${local.worker_failure_logs_url}");
    expect(finalFailure).toContain("${local.worker_failure_logs_url}");
  });

  it("renders guaranteed operational fields for final analysis failures", () => {
    const policy = resource("recipe_analysis_final_failure", "api_memory_high");

    for (const field of [
      "analysisAttemptLabel",
      "errorCode",
      "impact",
      "nextAction",
      "provider",
      "retryPolicy",
      "summary",
      "target",
    ]) {
      expect(policy).toContain(`EXTRACT(jsonPayload.${field})`);
    }
    expect(policy).toContain("## 何が起きたか");
    expect(policy).toContain("## 影響");
    expect(policy).toContain("## 次に行うこと");
    expect(policy).toContain(
      "レシピID、URL、リクエスト本文、例外メッセージはSlackへ表示しません",
    );
  });
});
