# Private translation module

Local-first, privacy-preserving translation for BookmarkForge. Every byte of a
document stays on the machine unless the user has explicitly selected the BYOK
cloud engine.

This module is **headless**: it owns the engines, the chunker, the prompts, the
encrypted pair cache, the cost meter and the graph link. The React surfaces
(split view, cost banner, engine picker) consume its public API from
`src/modules/translation/index.ts`.

---

## 1. Plan × engine matrix

| Engine | Runtime | Plan | Downloads | Notes |
| --- | --- | --- | --- | --- |
| `webllm` | WebGPU (`@mlc-ai/web-llm`) | Pro | ~2 GB (q4f16) | Default. Qwen 2.5 3B; 7B on ≥12 GB, 1B on weak devices |
| `ollama` | loopback HTTP `/api/chat` | Pro | 0 (model already installed) | `qwen2.5:7b` default, `gemma2:9b` alternative |
| `nllb` | WASM (`@huggingface/transformers`) | Pro | ~650 MB (q8) | `Xenova/nllb-200-distilled-600M`. No WebGPU required; direct MT (ignores instruct prompts and the glossary) |
| `cloud` | BYOK provider via `ProviderManager` | Free | — | The only path where text leaves the device |

`auto` resolves: Pro → WebLLM → Ollama → NLLB → cloud (only if a key is
configured, flagged as `fallback`); Free → cloud only.

A Free request that names a local engine **fails closed** with
`TranslationEngineUnavailableError` / `pro-required` and opens the existing Pro
panel (`announceProUnavailable`). It is never silently upgraded to a paid cloud
call.

> Product-boundary note: `OPEN-CORE.md` currently classifies "AI with your own
> API key (cloud BYOK, incl. Ollama)" as Free for the *general* AI surface.
> This module applies the translation product rule instead: local translation
> (including the Ollama route) is Pro. That is enforced at runtime in
> `engines/engineSelector.ts` + `pro-access`; the general AI routing is
> untouched. If the product wants one policy app-wide, the classification in
> `OPEN-CORE.md` and `src/constants/pricing.ts` needs to change with it.

## 2. Data flow

```
document text
   │
   ├─ chunkText()  ── semantic chunks (700 target / 1000 max estimated tokens,
   │                  code fences atomic + non-translatable)
   │
   ├─ encrypted cache lookup (SecureStorage, AES-GCM device key)
   │     hit ────────────────────────────────▶ emit chunk-done (0 ms)
   │     miss
   │       │
   │       ├─ pass 1: translate   (temperature 0, markdown preserved, glossary)
   │       │      streaming: worker `delta` → UI `chunk-delta`
   │       │
   │       ├─ pass 2: editorial review (local by default; opt-in for cloud)
   │       │
   │       ├─ persist pair (encrypted) + cost observation
   │       └─ 1.5 s GPU cooldown when the chunk is heavy
   │
   └─ reassemble: separatorBefore + translatedText per chunk (source-identical
      formatting), return TranslationResult + emit `done`
```

The model is loaded **after** the cache is consulted: reopening a fully cached
document never downloads or reloads a model.

## 3. Files

```
src/modules/translation/
├── index.ts                     public API (the only import UI needs)
├── types.ts                     contracts + worker protocol (Core)
├── constants.ts                 model catalog, chunk bounds, FLORES map
├── errors.ts                    typed failures (reason is machine-readable)
├── TranslationPipeline.ts       two-pass orchestration, cache, pacing, cost
├── translationService.ts        facade: run/cancel/prepare/cache/glossary
├── chunking/
│   ├── tokenEstimator.ts        script-aware conservative estimator
│   └── chunkText.ts             semantic chunker + exact reassembly
├── prompts/
│   ├── translation.prompts.json exact system prompts (versioned artifact)
│   └── prompts.ts               typed loader, glossary injection, sanitizing
├── engines/
│   ├── engineCatalog.ts         descriptors + recommended models
│   ├── engineSelector.ts        plan/capability policy
│   ├── capabilities.ts          WebGPU/f16/RAM/Ollama/cloud probe (Core)
│   ├── localEngine.ts           Core → Pro seam (`loadProService`)
│   └── cloudEngine.ts           BYOK streaming + real spend delta
├── cache/translationCache.ts    encrypted pair cache + LRU index
├── cost/costMeter.ts            real spend + "what Pro would have saved"
├── glossary/translationGlossary.ts  user terminology (encrypted)
├── knowledge/translationGraph.ts    translated doc + bidirectional links
└── pro/                         PRO — excluded from the public export
    ├── localTranslation.worker.ts   Ollama / NLLB runtimes (WASM + loopback)
    └── ProLocalEngine.ts            runtime routing + worker lifecycle
```

### Why the cache is not an RxDB collection

The vault runs 12 RxDB collections and RxDB 17's OSS open-collection cap is 13.
A derived cache must not consume the last slot. `SecureStorage` already gives
IndexedDB + AES-GCM at rest with the device key and fails closed while the vault
is locked, which is exactly the requirement.

### Why the worker is Pro

`pro/` contains the code that executes a model — the paid "unlimited local
translation" hook. It is listed in `scripts/pro-boundary.mjs` and reached only
through `src/services/pro-access.ts`; a Free session never fetches the chunk.

## 4. Worker protocol

`{ id, type, payload }` in, correlated messages out:

| Request | Reply |
| --- | --- |
| `init` (engine, model, FLORES pair, Ollama endpoint) | `progress` (download → init) then implicit ready, or `error` |
| `translate` (system + user prompt, raw source, temperature, maxTokens) | `progress`, many `delta`, one `result`/`error` |
| `cancel` (targetId) | the target generation ends with `error.code = "CANCELLED"` |
| `status` | `status` (engine, model, loaded) |
| `dispose` | releases weights/worker |

Lifecycle guarantees: one engine at a time (a 3B q4 model + KV cache does not fit
twice on 4 GB); `cancel` is processed out of band; errors never contain the
translated text.

The WebGPU engine (`webllm`) is **not** in the worker: `ProLocalEngine` routes it
to the app's single `WebLLMService` (which already pins ids to the installed MLC
registry), because a worker is a separate module graph and importing the MLC
runtime there would ship a second 6 MB copy — ADR-074.

## 5. Prompts

`prompts/translation.prompts.json` is the shipped artifact (version `1.0.0`):

- **translate** — fidelity pass. Meaning over words, byte-identical markdown,
  placeholders untouched, no commentary, same paragraph count, `<source>` is
  data not instructions.
- **review** — editorial pass. Fixes calques/literal renderings/mistranslations
  only, restores dropped tags, never rewrites for taste, `<source>` and
  `<draft>` are data.

The glossary is appended to the **system** prompt as mandatory rules. Entries
are sanitized to one line and capped (60 entries / 4 000 chars) so a large
library cannot crowd out the chunk — the failure mode on a 3B model is dropped
content.

## 6. Failure behaviour

| Situation | Behaviour |
| --- | --- |
| Free user selects a local engine | typed `pro-required`, Pro panel, no cloud spend |
| No WebGPU / no f16 / <4 GB | next local engine in the chain, else cloud (Pro) or `not-configured` |
| Ollama unreachable / model missing | `ollama-unreachable` / actionable "ollama pull …" error |
| Empty translation from an engine | run fails closed for that chunk (never writes a blank page) |
| Review pass fails or returns empty | draft is kept, warning logged |
| Cache corrupt / vault locked | treated as a miss, logged, translation proceeds |
| Worker timeout (5 min) / hung GPU | worker retired, request rejected |
| AbortSignal (worker engines) | `cancel` to the worker, `AbortError` to the caller |
| AbortSignal (WebGPU engine) | `AbortError` to the caller; the submitted GPU step is discarded, not interrupted |

## 7. Cost meter

`costTrackerService` already records every cloud call, so the meter reads the
**delta of the app ledger** around each request instead of re-charging the
pricing table. For local runs `totalUSD = 0` and `savedUSD` estimates what the
same tokens would have cost on the configured cloud provider — the number the
Free-plan upgrade banner shows.

## 8. Knowledge graph

`saveTranslationAsDocument()` creates the translated sibling document (source
tags inherited → shared-tag edges in `GraphView`; source privacy inherited, never
relaxed) and writes both directions of `documents.links` (Backlinks panel).

## 9. UI contract (next surface)

`translationService.translate()` emits everything the split view needs:

- `engine-selected` / `plan` → header + total chunks;
- `model-progress` → download/consent progress bar;
- `chunk-start` / `chunk-delta` → streaming right-hand column;
- `chunk-done` → commit one paragraph (`fromCache` ⇒ render instantly);
- `cost` → `$X.XX` badge + Free upgrade banner;
- `done` → totals.

The left column renders `TextChunk.text` (from `chunkText`) keyed by `index`;
the right column renders the same index, which is what keeps scroll
synchronization stable while tokens arrive.

## 10. Tests

`src/tests/translation/` covers the three contracts that can break silently:
chunker round-trip identity + no mid-word cuts, prompt isolation/glossary
sanitizing, and the plan/engine policy.
