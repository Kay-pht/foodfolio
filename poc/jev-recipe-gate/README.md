# Jev recipe gate PoC

## Goal

Validate whether Jev can safely identify clearly non-recipe HTML-derived content before Foodfolio enters its existing recipe extraction and media-analysis pipeline.

This PoC does **not** change production routing. It discovers a large labeled URL corpus, reuses the existing URL extraction PoC to produce the same bounded HTML-derived input, sends that input to Jev, and evaluates hard-reject thresholds offline from the returned probabilities.

## Corpus size

The default corpus is:

- 500 distinct recipe URLs
- 500 distinct non-recipe URLs
- at least 350 hard negatives from recipe-adjacent pages
- at least 3 discovery sites represented in each label
- no single site may exceed 40% of either label

The discovery sources include multiple Japanese recipe sites. Recipe candidates must resolve to an explicit site-specific recipe route and still expose recipe signals after extraction. Non-recipe candidates come only from explicit site-specific non-recipe route families such as indexes, categories, lists, search results, features, or cooking articles.

Before Jev is called, the runner rejects:

- duplicate final URLs
- duplicate extracted-text SHA-256 values
- recipe candidates that no longer resolve to a known recipe route
- non-recipe candidates that redirect to a known recipe route
- non-recipe candidates that expose Recipe JSON-LD
- corpora that fail the size, hard-negative, diversity, or site-concentration gates

The large corpus is intentional. Repeating the same URL measures model stability; it does not replace content diversity.

With 500 distinct recipe URLs and zero false rejects, the exact one-sided 95% binomial upper bound for the underlying false-reject probability is about 0.6%. This is only a scale reference for the PoC and is not proof of production accuracy.

## Repetitions and threshold evaluation

Each validated URL is evaluated three times by default, for up to 3,000 Jev classifications.

The runner records:

- Jev's selected `recipe` / `non_recipe` label
- `probabilities.non_recipe`, which is the candidate production gate signal
- Jev's separate `confidence` value
- latency
- input/output token counts
- estimated Jev input cost
- source site and negative tier
- extraction method, text length, final URL, and text SHA-256

The extracted page body itself is not written to the result artifact.

The thresholds evaluated by default are:

```text
0.80
0.90
0.95
0.98
0.99
```

A recipe URL is treated conservatively: if **any** repetition reaches the threshold for `non_recipe`, that URL is counted as a false-reject risk.

A non-recipe URL is counted as consistently rejectable only when **every** repetition reaches the threshold.

The runner reports the lowest tested threshold that has:

1. zero recipe false-reject URLs, and
2. at least one consistently rejected non-recipe URL.

That value is only a corpus-level candidate. It is not production approval.

## Local run

Install dependencies and set the TypeSafe API key:

```bash
npm ci
export TYPESAFE_API_KEY="..."
```

Run the deterministic unit proof first:

```bash
npx vitest run tests/unit/jev-recipe-gate.test.ts
```

Then run the live PoC:

```bash
npm run poc:jev-gate
```

Optional model-stability check with more repetitions:

```bash
JEV_POC_REPETITIONS=5 JEV_MODEL=jev-1.13.0 npm run poc:jev-gate
```

The generated evidence is written to:

```text
poc/results/jev-recipe-gate-results.json
```

`poc/results/` is already git-ignored.

If discovery cannot assemble a qualifying 500/500 corpus, the run stops before Jev classification and writes the corpus-validation evidence to the same result path.

## How to decide the next step

Review at least:

- `corpusQuality`
- `technicalComplete`
- `thresholdEvaluation.metrics[*].recipeFalseRejectCaseIds`
- `recipeFalseRejectRate`
- `nonRecipeConsistentRejectCaseIds`
- `nonRecipeConsistentRejectCoverage`
- per-case probability variation across repetitions
- latency
- token usage and estimated cost

A production hard-reject gate should not be added merely because Jev usually classifies the corpus correctly.

If no tested threshold keeps recipe false rejects at zero, the first production integration should remain fail-open: Jev may be retained as an observation or routing signal, but it should not prevent the existing extraction path from running.

If a useful threshold is found, a separate production PR should define the exact fail-open behavior for TypeSafe/API failures, telemetry, rollout controls, and whether the same signal can safely route expensive media analysis.
