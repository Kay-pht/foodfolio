# Jev recipe gate PoC

## Goal

Validate whether Jev can classify HTML-derived page content as one specific cooking recipe or non-recipe content before Foodfolio enters its existing recipe extraction and media-analysis pipeline.

This PoC does **not** change production routing. It reuses the existing URL extraction PoC, sends only its bounded AI input to Jev, and measures whether a hard non-recipe rejection threshold can be chosen without false-rejecting recipe fixtures.

## Corpus size and quality

The original fixed 18-case corpus was too small for a hard-reject decision. The live PoC now builds and validates a **600-URL corpus** before sending any request to Jev:

- 300 distinct recipe URLs
- 300 distinct non-recipe URLs
- at least 200 non-recipe URLs must be recipe-adjacent hard negatives
- at least 3 discovery sites must be represented in each label
- no single discovery site may contribute more than 40% of either label
- duplicate final URLs are removed
- duplicate extracted-text SHA-256 values are removed
- recipe fixtures must still resolve to a known recipe route and expose recipe signals
- non-recipe fixtures are rejected from the corpus if they resolve to a known recipe route or expose Recipe JSON-LD

The corpus is discovered from public pages on multiple supported recipe sites, including Kikkoman, Shirogohan, Ajinomoto Park, Kurashiru, and Cookpad. Discovery is deterministic enough for one run to be inspectable, but the exact live corpus can change as third-party sites change.

The 300-recipe target is a PoC floor, not a production safety guarantee. Under an independent-binomial assumption, observing zero false rejects in 300 recipe examples gives a one-sided 95% upper bound of about 1% for the false-reject probability. Because the corpus is deliberately stratified rather than a random sample of all future traffic, that figure is only a scale reference.

Repeated model calls do not substitute for distinct content. The default run therefore uses 600 distinct URLs **and** three Jev repetitions per URL.

## What is measured

Each validated fixture is evaluated three times by default. The runner records:

- Jev's selected `recipe` / `non_recipe` label
- `probabilities.non_recipe`, which is the candidate production gate signal
- Jev's separate `confidence` value for diagnosis
- latency
- input/output token counts
- estimated Jev input cost
- extraction method, input character count, and SHA-256
- discovery site and hard/easy negative classification

The extracted page text itself is kept only in memory for the live run. It is not written to the committed source tree or generated result JSON. Generated evidence is stored under the already ignored `poc/results/` directory.

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

The runner first discovers candidates and validates the complete 300/300 corpus. If the corpus does not satisfy the size, hard-negative, uniqueness, and site-diversity requirements, it exits non-zero **before** starting Jev classification.

Optional model-stability override:

```bash
JEV_POC_REPETITIONS=5 JEV_MODEL=jev-1.13.0 npm run poc:jev-gate
```

Increasing repetitions tests stability only; it does not reduce the 600-URL content-diversity requirement.

The result is written to:

```text
poc/results/jev-recipe-gate-results.json
```

The result includes the exact URL corpus used in that run, corpus quality metrics, individual Jev runs, threshold metrics, token usage, cost, and latency. Raw extracted page bodies are not persisted.

## How to decide the next step

A production hard-reject gate should not be added from this PoC merely because Jev usually classifies the corpus correctly.

The follow-up decision should first inspect:

- `corpusQuality`
- `recipeFalseRejectCaseIds`
- `recipeFalseRejectRate`
- `nonRecipeConsistentRejectCaseIds`
- `nonRecipeConsistentRejectCoverage`
- per-site failure concentration
- hard-negative failure concentration
- repeated-run probability stability
- latency and cost

If no tested threshold keeps recipe false rejects at zero, the first production integration should remain fail-open: Jev may be retained as an observation or routing signal, but it should not prevent the current extraction path from running.

Even if the 600-case PoC produces zero false rejects, production rollout should still use a separate PR with fail-open behavior, telemetry, and staged rollout. This PoC is intended to identify whether a hard-reject design is promising enough to proceed, not to prove universal classification accuracy.
