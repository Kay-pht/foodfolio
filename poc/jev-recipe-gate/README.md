# Jev recipe gate PoC

## Goal

Validate whether Jev can classify HTML-derived page content as one specific cooking recipe or non-recipe content before Foodfolio enters its existing recipe extraction and media-analysis pipeline.

This PoC does **not** change production routing. It reuses the existing URL extraction PoC, sends only its bounded AI input to Jev, and measures whether a hard non-recipe rejection threshold can be chosen without false-rejecting recipe fixtures.

## What is measured

Each fixture is evaluated three times by default. The runner records:

- Jev's selected `recipe` / `non_recipe` label
- `probabilities.non_recipe`, which is the candidate production gate signal
- Jev's separate `confidence` value for diagnosis
- latency
- input/output token counts
- estimated Jev input cost
- extraction method, input character count, and SHA-256

The extracted page text itself is not written to the committed source tree. Generated results are stored under the already ignored `poc/results/` directory.

The thresholds evaluated by default are:

```text
0.80
0.90
0.95
0.98
0.99
```

A recipe fixture is treated conservatively: if **any** repetition reaches the threshold for `non_recipe`, that fixture is counted as a false-reject risk.

A non-recipe fixture is counted as consistently rejectable only when **every** repetition reaches the threshold.

The runner reports the lowest tested threshold that has:

1. zero recipe false-reject fixtures, and
2. at least one consistently rejected non-recipe fixture.

That value is only a fixture-level candidate. It is not production approval.

## Local run

Install dependencies and set the TypeSafe API key:

```bash
npm ci
export TYPESAFE_API_KEY="..."
```

Run the unit proof first:

```bash
npx vitest run tests/unit/jev-recipe-gate.test.ts
```

Then run the live PoC:

```bash
npm run poc:jev-gate
```

Optional overrides:

```bash
JEV_POC_REPETITIONS=5 JEV_MODEL=jev-1.13.0 npm run poc:jev-gate
```

The result is written to:

```text
poc/results/jev-recipe-gate-results.json
```

## How to decide the next step

A production hard-reject gate should not be added from this PoC merely because Jev usually classifies the fixtures correctly.

The follow-up decision should first inspect each threshold's:

- `recipeFalseRejectCaseIds`
- `recipeFalseRejectRate`
- `nonRecipeConsistentRejectCaseIds`
- `nonRecipeConsistentRejectCoverage`
- repeated-run stability
- latency and cost

If no tested threshold keeps recipe false rejects at zero, the first production integration should remain fail-open: Jev may be retained as an observation or routing signal, but it should not prevent the current extraction path from running.

If a useful threshold is found, a separate production PR should define the exact fail-open behavior for Jev/API failures, telemetry, rollout controls, and whether the same decision can also safely route expensive media analysis.
