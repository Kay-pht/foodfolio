import { describe, expect, it } from "vitest";
import {
  jstDayRange,
  jstMonthRange,
} from "../../src/application/analysis/admission-service.js";

describe("analysis admission policy", () => {
  it("uses midnight-to-midnight JST as the daily window", () => {
    const beforeMidnight = jstDayRange(new Date("2026-09-08T14:59:59.999Z"));
    expect(beforeMidnight.start.toISOString()).toBe("2026-09-07T15:00:00.000Z");
    expect(beforeMidnight.end.toISOString()).toBe("2026-09-08T15:00:00.000Z");

    const atMidnight = jstDayRange(new Date("2026-09-08T15:00:00.000Z"));
    expect(atMidnight.start.toISOString()).toBe("2026-09-08T15:00:00.000Z");
    expect(atMidnight.end.toISOString()).toBe("2026-09-09T15:00:00.000Z");
  });

  it("uses the first day of each month at midnight JST as the monthly window", () => {
    const september = jstMonthRange(new Date("2026-09-30T14:59:59.999Z"));
    expect(september.start.toISOString()).toBe("2026-08-31T15:00:00.000Z");
    expect(september.end.toISOString()).toBe("2026-09-30T15:00:00.000Z");

    const october = jstMonthRange(new Date("2026-09-30T15:00:00.000Z"));
    expect(october.start.toISOString()).toBe("2026-09-30T15:00:00.000Z");
    expect(october.end.toISOString()).toBe("2026-10-31T15:00:00.000Z");
  });
});
