# Jev media routing PoC

## Goal

This companion PoC evaluates whether the same Jev recipe/non-recipe classifier used by the general-Web gate can safely participate in routing for:

- YouTube
- Instagram
- TikTok
- ChatGPT / Gemini public-share shaped conversations

It does **not** change production routing.

The key distinction is that these are two different questions:

1. Is the source about one specific recipe?
2. Does the available text contain enough information to use the text-only analysis path?

A title such as `絶品パスタ #レシピ` can correctly be classified as a recipe while still lacking ingredients and steps. The PoC therefore records semantic classification accuracy and routing safety separately.

## Proposed routing policies under test

### YouTube

The existing deterministic `assessYoutubeDescription()` result remains part of the decision.

```text
description sufficient
  AND p(recipe) >= threshold
    -> Z.ai text extraction

otherwise
    -> Gemini video-aware fallback
```

No usable text means Gemini directly and consumes no Jev call.

The PoC includes a hard negative that deliberately satisfies the structural YouTube sufficiency heuristic while describing multiple recipe ideas rather than one specific recipe. This measures whether Jev adds semantic value on top of the existing heuristic.

### Instagram

```text
non-empty metadata text
  AND p(recipe) >= threshold
    -> text analysis

otherwise
    -> media analysis
```

The fixture set includes both complete recipe captions and recipe-themed but text-incomplete captions.

### TikTok

The proposed policy is the same as Instagram:

```text
non-empty title/description
  AND p(recipe) >= threshold
    -> text analysis

otherwise
    -> media analysis
```

This intentionally evaluates a possible future route. Current production behavior for TikTok photo posts is unchanged and continues to use media analysis directly.

### AI chat

AI-shared conversation fixtures use normal Jev classification only:

```text
one specific recipe <-> non-recipe
```

No downstream AI-chat routing change is evaluated.

## Fixture set

The committed controlled corpus contains **28 fixtures**:

- YouTube: 8
- Instagram: 6
- TikTok: 6
- AI chat: 8

Three fixtures intentionally contain no usable text and therefore bypass Jev. The remaining **25 fixtures** are classified three times by default:

```text
25 fixtures x 3 repetitions = 75 successful Jev classifications
```

The fixtures reuse current production input shapes and existing test shapes where possible. Additional controlled hard negatives cover cases that production tests do not currently represent.

This corpus is for routing hypothesis testing. It is not a statistically representative sample of production traffic.

## Run

The repository root `.env` must contain:

```env
TYPESAFE_API_KEY=...
```

Run:

```bash
npm run poc:jev-media
```

The result/checkpoint is written to:

```text
poc/results/jev-media-routing-results.json
```

The result directory is git-ignored.

## Consumption control

One invocation processes at most 100 fixture cases. The current default fixture set is smaller than that, so a clean default run can complete all 24 Jev-backed fixtures in one invocation.

To deliberately restrict consumption:

```bash
JEV_MEDIA_POC_BATCH_SIZE=5 npm run poc:jev-media
```

The maximum remains 100.

The default repetition count is 3. To use a different count for a fresh checkpoint:

```bash
JEV_MEDIA_POC_REPETITIONS=1 npm run poc:jev-media
```

Changing repetition count or Jev model with an existing checkpoint is rejected.

To reset only the media checkpoint:

```bash
JEV_MEDIA_POC_RESET=1 npm run poc:jev-media
```

## Checkpoint and failure behavior

The runner:

- creates the result file before consuming Jev calls,
- checkpoints after every successful classification,
- resumes partially completed fixtures before fresh fixtures,
- records HTTP attempts, latency, token usage, and estimated cost,
- retries TypeSafe 429/529 through the shared Jev client,
- stops the entire batch after a persistent API error,
- retries the interrupted fixture first on the next invocation.

Raw fixture text is not copied into the result JSON.

## Metrics

The tested recipe-probability thresholds are:

```text
0.80
0.90
0.95
0.98
0.99
```

### Semantic classification

For fixtures with a semantic ground-truth label, the result records:

- per-run Jev choice correctness,
- total choice accuracy,
- case IDs with any incorrect choice,
- case IDs whose Jev choice changes between repetitions.

This metric answers whether Jev is classifying recipe versus non-recipe correctly.

### Routing safety

For YouTube, Instagram, and TikTok, each threshold additionally records:

- `unsafeFastRouteCaseIds`
  - expected fallback/media cases that enter Z.ai/text in at least one repetition,
- `consistentFastRouteCaseIds`
  - expected Z.ai/text cases that enter the fast path in every repetition,
- fast-path coverage,
- fallback coverage.

This metric answers whether recipe probability is a safe proxy for text sufficiency.

A semantic recipe case may therefore be:

```text
Jev classification: correct
Routing result: unsafe
```

That is an expected and important PoC outcome, not a contradiction.

## Candidate threshold

The runner reports an **experimental fixture-specific candidate threshold** only when:

1. no completed YouTube / Instagram / TikTok fallback-required fixture enters the fast route in any repetition, and
2. at least one expected fast-path fixture enters the fast route in every repetition.

The same rule is also calculated separately for YouTube, Instagram, and TikTok.

A candidate from this controlled fixture set is **not production-qualified**. It is evidence for deciding whether the routing hypothesis is worth a larger live-source validation.

## Production impact

None.

The PoC imports the existing pure YouTube sufficiency function, but production code does not import PoC code. Existing Z.ai, Gemini, Instagram, TikTok, YouTube, ChatGPT, and Gemini-shared runtime paths remain unchanged.
