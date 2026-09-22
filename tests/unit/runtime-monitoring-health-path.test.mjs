import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

const monitoring = await readFile(
  new URL("../../infra/terraform/monitoring.tf", import.meta.url),
  "utf8",
);

describe("public API uptime check", () => {
  it("checks the deployed /health endpoint and names it in the incident", () => {
    const uptime = monitoring.split(
      'resource "google_monitoring_alert_policy" "api_5xx"',
    )[0];

    expect(uptime).toMatch(/path\s*=\s*"\/health"/);
    expect(uptime).toContain("- Endpoint: `GET /health`");
    expect(uptime).toContain('status_class = "STATUS_CLASS_2XX"');
    expect(uptime).toContain('json_path    = "$.status"');
    expect(uptime).toContain(String.raw`content = "\"ok\""`);
  });
});
