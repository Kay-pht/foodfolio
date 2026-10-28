import { readFileSync } from "node:fs";
import {
  currentPr,
  readLedger,
  requireChatLgtm,
  requireIndependentProof,
  reviewPaths,
  saveJson,
  withReviewLock,
} from "./review-flow.mjs";

const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--attestation")) {
  throw new Error(
    "Use review:lgtm with no arguments, or --attestation <path> for the approved alert controller.",
  );
}
const pr = currentPr();
const paths = reviewPaths(pr);
withReviewLock(paths, () => {
  if (args.length && readLedger(paths)) {
    throw new Error(
      "A normal chat review ledger exists; alert attestation cannot bypass it.",
    );
  }
  const evidence = args.length
    ? { automation: JSON.parse(readFileSync(args[1], "utf8")) }
    : { chatReview: readLedger(paths) };
  if (!args.length) {
    requireChatLgtm(evidence.chatReview, pr, process.env.CODEX_THREAD_ID ?? "");
  }
  requireIndependentProof(evidence, pr);
  const refreshed = currentPr();
  if (
    refreshed.number !== pr.number ||
    refreshed.headRefOid !== pr.headRefOid
  ) {
    throw new Error("PR HEAD changed while recording LGTM.");
  }
  saveJson(paths.proofPath, {
    version: 1,
    verdict: "LGTM",
    pr: pr.number,
    reviewed_sha: pr.headRefOid,
    created_at: new Date().toISOString(),
    ...evidence,
  });
  console.log(`LGTM proof written for PR #${pr.number} at ${pr.headRefOid}`);
  console.log(`Proof: ${paths.proofPath}`);
});
