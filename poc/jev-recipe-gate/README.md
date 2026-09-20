# Jev recipe gate PoC

## Goal

Validate whether Jev can safely identify clearly non-recipe HTML-derived content before Foodfolio enters its existing recipe extraction and media-analysis pipeline.

This PoC does **not** change production routing.

## Corpus target

The final validation target remains:

- 500 distinct recipe URLs
- 500 distinct non-recipe URLs
- at least 350 recipe-adjacent hard negatives
- at least 3 discovery sites represented in each label
- no single site above 40% of either label

Candidate URLs are discovered from multiple Japanese recipe sites. Recipe and non-recipe labels use explicit source-specific URL families and are revalidated after fetching.

The runner excludes:

- duplicate final URLs
- duplicate extracted-text SHA-256 values
- recipe candidates that no longer resolve to a known recipe route
- non-recipe candidates that no longer resolve to an explicit known non-recipe route
- non-recipe candidates exposing Recipe JSON-LD

A corpus smaller than 500/500 can still be evaluated in batches. Its results are **provisional only** and can never produce a production-qualified candidate threshold.

This means a run such as recipe=500 / non-recipe=370 is still useful evidence. The available 870 URLs can be evaluated without pretending that the final corpus quality gate has passed.

## 100-URL batch execution

One invocation processes at most **100 distinct URLs**.

Each URL is evaluated three times by default, so one invocation performs at most:

```text
100 URLs × 3 repetitions = 300 successful Jev classifications
```

The runner then stops normally. Run the same command again when you want the next batch.

Fresh batches are balanced toward recipe/non-recipe 50/50 when both labels are available. A URL that was only partially completed before an interruption is resumed before fresh URLs are selected.

The maximum URL batch size is hard-capped at 100. A smaller batch can be selected with:

```bash
JEV_POC_BATCH_SIZE=25 npm run poc:jev-gate
```

Values above 100 are rejected.

## Checkpoint and resume

The state/result file is:

```text
poc/results/jev-recipe-gate-results.json
```

It is created **before corpus discovery starts** and then replaced atomically as progress is saved.

After Jev evaluation starts, a checkpoint is written after every successful classification, extraction failure, API failure, and completed URL. This means the next invocation can resume from the saved runs instead of starting over.

The result file includes:

- discovered and validated corpus counts
- corpus quality status
- exact evaluated URLs
- completed/pending/failed URL counts
- each repetition's recipe/non_recipe probabilities
- Jev confidence
- latency
- HTTP attempt count
- input/output token usage
- per-call and cumulative estimated cost
- the last batch's selected/processed URL IDs
- provisional and qualified threshold fields

Raw extracted page content is never persisted. Only extraction metadata, text length, and SHA-256 are stored.

`poc/results/` is git-ignored.

## First run

Set the API key in the repository root `.env`:

```env
TYPESAFE_API_KEY=...
```

Run the deterministic tests:

```bash
npx vitest run tests/unit/jev-recipe-gate.test.ts
```

Then run the first batch:

```bash
npm run poc:jev-gate
```

The first invocation performs corpus discovery/validation, creates the checkpoint, and then evaluates at most 100 URLs.

## Following batches

Use exactly the same command:

```bash
npm run poc:jev-gate
```

The existing result file is loaded automatically. Fully completed URLs are skipped and the next batch of at most 100 URLs is selected.

Continue only when you want to consume the next batch.

## Reset and corpus refresh

To discard all saved Jev evidence and start again:

```bash
JEV_POC_RESET=1 npm run poc:jev-gate
```

To rerun corpus discovery while preserving compatible Jev runs for URLs that still exist in the refreshed corpus:

```bash
JEV_POC_REFRESH_CORPUS=1 npm run poc:jev-gate
```

Corpus refresh is useful after adding more discovery sources or when the initial discovery cannot reach the final 500/500 target.

Changing the model or repetition count while a checkpoint exists is rejected. Either keep the same settings or reset the checkpoint.

## Threshold evaluation

The default thresholds are:

```text
0.80
0.90
0.95
0.98
0.99
```

A recipe URL is considered a false-reject risk if **any** completed repetition reaches the non_recipe threshold.

A non-recipe URL is consistently rejectable only when **every required repetition** reaches the threshold.

Threshold metrics only use URLs that completed all required repetitions. Partially completed URLs do not count as consistently rejectable.

The result contains:

- `provisionalCandidateThreshold`: calculated from the fully completed URLs so far
- `qualifiedCandidateThreshold`: emitted only when the final corpus quality gate passes and every corpus URL completes all repetitions without terminal errors

A provisional threshold must not be used to enable production hard rejection.

## Failure behavior

A transient TypeSafe 429/529 is retried with bounded backoff.

If a Jev call still fails after retries, the runner:

1. checkpoints the batch error,
2. keeps the affected URL pending instead of terminally failing it,
3. immediately stops the current batch to avoid additional consumption,
4. exits non-zero.

Running the same command again retries that pending URL before fresh URLs. Successful repetitions already saved for that URL are reused, provided the re-extracted content hash is unchanged.

Extraction failures do not consume Jev calls; they are recorded and the batch can continue with other selected URLs. If a partially evaluated URL re-extracts to different content, the runner stops using that URL's mixed evidence and records it for manual reset or corpus refresh.

If all currently validated URLs have been exhausted but the final 500/500 corpus target is still unmet, the runner reports that the evidence is incomplete. Improve discovery and run with `JEV_POC_REFRESH_CORPUS=1`.

## Cost interpretation

Each successful Jev response contributes its reported input token usage to the estimated cost.

The result file records both:

- `lastBatch.estimatedCostUsd`
- `pricing.totalEstimatedCostUsd`

This allows cost and accuracy to be reviewed after every batch before deciding whether to run the next 100 URLs.

With 500 distinct recipe URLs and zero false rejects, the exact one-sided 95% binomial upper bound for the underlying false-reject probability is about 0.6%. This is a scale reference only and is not proof of production accuracy.

## Media routing companion PoC

YouTube / Instagram / TikTok / AI共有会話について、Jevのrecipe判定をルーティングに使えるかを別runnerで検証します。

```bash
npm run poc:jev-media
```

デフォルトのcontrolled corpusは27 fixtureです。テキストなし3件はJevを呼ばず、残り24件を各3回評価するため、clean runの最大successful classification数は72回です。

結果はWeb PoCとは別のcheckpointへ保存します。

```text
poc/results/jev-media-routing-results.json
```

分類精度とルーティング安全性を分離して評価します。具体的なpolicy、fixture、threshold metric、消費制御は [media-routing.md](./media-routing.md) を参照してください。

productionの解析ルーティングはこのPoCでは変更しません。
