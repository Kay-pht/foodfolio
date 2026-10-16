import type { MediaAccessRestriction } from "../../application/analysis/types.js";

export const MAX_YT_DLP_DIAGNOSTIC_BYTES = 16_384;

// Only a fixed classification crosses the child-process boundary; never its stderr.
export class YtDlpAccessRestrictionError extends Error {
  constructor(readonly restriction: MediaAccessRestriction) {
    super("Media access is restricted");
  }
}

export function classifyYtDlpAccessRestriction(
  error: unknown,
): MediaAccessRestriction | undefined {
  if (error instanceof YtDlpAccessRestrictionError) return error.restriction;
  if (!error || typeof error !== "object") return undefined;
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr !== "string") return undefined;

  const tail = Buffer.from(stderr)
    .subarray(-MAX_YT_DLP_DIAGNOSTIC_BYTES)
    .toString("utf8");
  for (const line of tail.split(/\r?\n/)) {
    // Ignore warnings, arbitrary exception messages, URL text and generic cookie hints.
    const message = /^ERROR:\s+\[Instagram\]\s+[^:\r\n]+:\s+(.+)$/i
      .exec(line)?.[1]
      ?.replace(/https?:\/\/\S+/gi, "");
    if (!message) continue;
    if (
      /\b(?:This (?:video|content) is age[- ]restricted|Sign in to confirm your age|Age verification (?:is )?required|People under \d{1,3} can['’]t see this content)\b/i.test(
        message,
      )
    )
      return "age_restricted";
    if (
      /This content (?:isn['’]t|is not) available to everyone:\s*It can['’]t be seen by certain audiences\b/i.test(
        message,
      ) ||
      /This content is only available for registered users who follow this account\b/i.test(
        message,
      )
    )
      return "audience_restricted";
    if (
      /\bYou need to log in to access this content\b/i.test(message) ||
      /\bThe webpage request was redirected to the login page\b/i.test(message)
    )
      return "login_required";
  }
  return undefined;
}
