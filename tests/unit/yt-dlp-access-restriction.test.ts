import { describe, expect, it } from "vitest";
import {
  classifyYtDlpAccessRestriction,
  MAX_YT_DLP_DIAGNOSTIC_BYTES,
} from "../../src/infrastructure/media/yt-dlp-access-restriction.js";

describe("bounded yt-dlp access restriction classification", () => {
  it.each([
    ["This content is age-restricted", "age_restricted"],
    ["Sign in to confirm your age", "age_restricted"],
    ["Age verification is required", "age_restricted"],
    ["People under 19 can't see this content", "age_restricted"],
    [
      "This content isn't available to everyone: It can't be seen by certain audiences.",
      "audience_restricted",
    ],
    [
      "This content is only available for registered users who follow this account",
      "audience_restricted",
    ],
    ["You need to log in to access this content", "login_required"],
    [
      "The webpage request was redirected to the login page. You have exceeded the rate-limit for accessing posts anonymously",
      "login_required",
    ],
  ])("classifies only an explicit error: %s", (text, expected) => {
    expect(
      classifyYtDlpAccessRestriction({
        stderr: `ERROR: [Instagram] fixture: ${text}`,
      }),
    ).toBe(expected);
  });
  it("uses bounded trailing stderr and discards earlier restriction text", () => {
    const line = "ERROR: [Instagram] fixture: This content is age-restricted";
    expect(
      classifyYtDlpAccessRestriction({
        stderr: "x".repeat(MAX_YT_DLP_DIAGNOSTIC_BYTES * 2) + "\n" + line,
      }),
    ).toBe("age_restricted");
    expect(
      classifyYtDlpAccessRestriction({
        stderr: line + "\n" + "x".repeat(MAX_YT_DLP_DIAGNOSTIC_BYTES),
      }),
    ).toBeUndefined();
  });
  it.each([
    undefined,
    null,
    "age-restricted",
    new Error("ERROR: [Instagram] fixture: This content is age-restricted"),
    { stderr: 123 },
    { stdout: "ERROR: [Instagram] fixture: This content is age-restricted" },
    { stderr: "WARNING: [Instagram] fixture: This content is age-restricted" },
    { stderr: "ERROR: [Other] fixture: This content is age-restricted" },
    {
      stderr:
        "ERROR: [Instagram] fixture: Requested content is not available, rate-limit reached or login required",
    },
    {
      stderr: "ERROR: [Instagram] fixture: This content is not age-restricted",
    },
    {
      stderr:
        "ERROR: [Instagram] fixture: Use --cookies-from-browser to authenticate",
    },
    {
      stderr: "ERROR: [Instagram] fixture: https://example.com/age-restricted",
    },
  ])("does not infer a restriction from ambiguous input %#", (error) => {
    expect(classifyYtDlpAccessRestriction(error)).toBeUndefined();
  });
});
