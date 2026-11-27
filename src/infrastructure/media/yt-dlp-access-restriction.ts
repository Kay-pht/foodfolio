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
    const diagnostic =
      /^ERROR:\s+\[(Instagram|TikTok)\]\s+[^:\r\n]+:\s+(.+)$/i.exec(line);
    const message = diagnostic?.[2]
      ?.replace(/https?:\/\/\S+/gi, "")
      .replace(/^Restricted Video:\s*/i, "");
    if (diagnostic?.[1]?.toLowerCase() === "tiktok") {
      if (
        message &&
        /^(?:TikTok is requiring login for access to this content|This post may not be comfortable for some audiences\. Log in for access)(?:[.!;:]|$)/i.test(
          message,
        )
      )
        return "login_required";
      if (
        message &&
        /^You do not have permission to view this post\. Log into an account that has access(?:[.!;:]|$)/i.test(
          message,
        )
      )
        return "audience_restricted";
      continue;
    }
    if (!message) continue;
    if (
      /^(?:This (?:video|content) is age[- ]restricted|Sign in to confirm your age|Age verification (?:is )?required|People under \d{1,3} can['’]t see this content)(?:[.!;:]|$)/i.test(
        message,
      )
    )
      return "age_restricted";
    if (
      /^This content (?:isn['’]t|is not) available to everyone:\s*It can['’]t be seen by certain audiences(?:[.!;:]|$)/i.test(
        message,
      ) ||
      /^This content is only available for registered users who follow this account(?:[.!;:]|$)/i.test(
        message,
      )
    )
      return "audience_restricted";
    if (
      /^You need to log in to access this content(?:[.!;:]|$)/i.test(message) ||
      /^The webpage request was redirected to the login page(?:[.!;:]|$)/i.test(
        message,
      )
    )
      return "login_required";
  }
  return undefined;
}
