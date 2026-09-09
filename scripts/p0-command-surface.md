# Autonomous P0 command surface

- `npm run hooks:install`: configure the tracked `.githooks` directory for this checkout.
- `npm run check:push-policy`: test the local direct-main-push guardrail.
- `npm run check:specs`: validate Specification as Code task files.
- `npm run verify:autonomous-p0`: run the P0 guardrail regression suite.
- `npm run review:lgtm`: Reviewer-only command. Record LGTM for the current PR HEAD in `.git/foodfolio/review-proof.json`.
- `npm run pr:merge`: Human-only final command. Revalidate the proof and PR HEAD, wait for CI, merge with `--match-head-commit`, and remove the proof only after success.

AI agents must never run `npm run pr:merge`.
