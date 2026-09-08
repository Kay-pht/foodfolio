import { describe, expect, it } from "vitest";
import { jstDayRange } from "../../src/application/analysis/admission-service.js";

describe("analysis admission policy", () => {
  it("uses midnight-to-midnight JST as the daily window", () => {
    const beforeMidnight = jstDayRange(
      new Date("2026-09-08T14:59:59.999Z"),
    );
    expect(beforeMidnight.start.toISOString()).toBe(
      "2026-09-07T15:00:00.000Z",
    );
    expect(beforeMidnight.end.toISOString()).toBe("2026-09-08T15:00:00.000Z");

    const atMidnight = jstDayRange(new Date("2026-09-08T15:00:00.000Z"));
    expect(atMidnight.start.toISOString()).toBe("2026-09-08T15:00:00.000Z");
    expect(atMidnight.end.toISOString()).toBe("2026-09-09T15:00:00.000Z");
  });
});
