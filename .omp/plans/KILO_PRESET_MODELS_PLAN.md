# Kilo Provider — Live-Precedence Preset Model List

## Context

`packages/stage-ui/src/libs/providers/providers/kilo/index.ts` exposes `extraMethods.listModels`, which
fetches `https://api.kilo.ai/api/gateway/models` live and filters for
`m.id.includes(':free')`. On any fetch failure it falls back to a hardcoded 5-model array.

Live verification on 2026-10-17 against the live endpoint shows the fallback array is badly
stale and the filter is wrong:

1. **Filter drops live free models.** `id.includes(':free')` matches 13 of the 17 models the
   gateway reports as `isFree: true`. Four live free models are dropped because they have no
   `:free` suffix: `kilo-auto/free`, `openrouter/free`, `reflection/beam-free`,
   `stealth/glyph-cluster`.
2. **Fallback array is stale and partly broken.** Three of its five IDs no longer exist:
   `poolside/laguna-m.1:free` and `poolside/laguna-xs.2:free` answer keyless `404 does not exist`;
   `stepfun/step-3.7-flash:free` likewise `404`. The ID `kilo-auto` (no `/free`) answers keyless
   `401 PAID_MODEL_AUTH_REQUIRED` — a paid model ID. Only `nvidia/nemotron-3-super-120b-a12b:free`
   still resolves (`200`).
3. **Failure mode is worse than stale data.** `fetchModelsForProvider`
   (`packages/stage-ui/src/stores/providers/runtime/models.ts:89-94`) clears
   `runtimeState.models` to `[]` on any error, so a transient network failure leaves the Kilo
   provider with a completely empty model picker.

The desired end state: the live gateway listing takes precedence and is the primary source;
a verified preset list is merged underneath it so the picker is never empty; preset metadata
(friendly display names, context window, vision) survives when the live listing agrees.

The user explicitly directed: **fetched models take precedence over presets.**

## Approach

### Step 1 — Add a verified preset constant, merged below live results

Target: `packages/stage-ui/src/libs/providers/providers/kilo/index.ts`.

Add a module-level typed constant immediately above `export const providerKilo` (after the
`type KiloConfig` line, mirroring the `minimax` provider's
`const minimaxModels: ModelInfo[] = [...]` pattern — no equivalent preset-list helper exists):

```ts
import type { ModelInfo } from '../../types'

/**
 * Verified Kilo Gateway free models. Provenance: live listing from
 * https://api.kilo.ai/api/gateway/models (2026-10-17) cross-checked against
 * the Kilo lane in ~/pi-freeflow/src/models.ts.
 *
 * These are a fallback: listModels() returns the live listing first and only
 * merges these in for IDs the live call did not return. Preset rows carry a
 * friendly name, context window, and vision flag the raw listing omits.
 */
const kiloPresetModels: ModelInfo[] = [
  {
    id: 'kilo-auto/free',
    name: 'Kilo Auto Free',
    provider: 'kilo',
    description: 'Auto-routes to the best available free coding model',
    contextLength: 256_000,
  },
  {
    id: 'dots-studio/dots-3-note-preview:free',
    name: 'Dots3-Note Preview',
    provider: 'kilo',
    description: 'Dots Studio preview model, 512K context',
    contextLength: 512_000,
    capabilities: ['vision'],
  },
  {
    id: 'nvidia/nemotron-3.5-super-vl:free',
    name: 'Nemotron 3.5 Super VL',
    provider: 'kilo',
    description: 'NVIDIA vision-language reasoning model, 1M context',
    contextLength: 1_000_000,
    capabilities: ['vision'],
  },
  {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    name: 'Nemotron 3 Nano Omni Reasoning',
    provider: 'kilo',
    description: 'NVIDIA omni-modal reasoning model, 256K context',
    contextLength: 256_000,
    capabilities: ['vision'],
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'Nemotron 3 Ultra 550B',
    provider: 'kilo',
    description: 'NVIDIA frontier reasoning model, 1M context',
    contextLength: 1_000_000,
  },
  {
    id: 'nvidia/nemotron-3.5-lightning:free',
    name: 'Nemotron 3.5 Lightning',
    provider: 'kilo',
    description: 'NVIDIA fast frontier model, 1M context',
    contextLength: 1_000_000,
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nemotron 3 Super 120B',
    provider: 'kilo',
    description: 'NVIDIA large reasoning/model, 262K context',
    contextLength: 262_144,
  },
  {
    id: 'nvidia/nemotron-3.5-content-safety:free',
    name: 'Nemotron 3.5 Content Safety',
    provider: 'kilo',
    description: 'NVIDIA moderation classifier, not a chat model',
    contextLength: 128_000,
    capabilities: ['vision'],
  },
  {
    id: 'reflection/beam-free',
    name: 'Reflection Beam 1.0',
    provider: 'kilo',
    description: 'Reflection reasoning model, 1M context',
    contextLength: 1_048_576,
  },
  {
    id: 'xingchen-agi/xing4.0-29b-a4b:free',
    name: 'XingChen Xing4.0 29B A4B',
    provider: 'kilo',
    description: 'XingChen AGI 29B MoE model, 262K context',
    contextLength: 262_144,
  },
  {
    id: 'thinkingmachines/inkling-small:free',
    name: 'Inkling Small',
    provider: 'kilo',
    description: 'Thinking Machines model, 1M context',
    contextLength: 1_048_576,
    capabilities: ['vision'],
  },
  {
    id: 'poolside/laguna-s-2.1:free',
    name: 'Poolside Laguna S 2.1',
    provider: 'kilo',
    description: 'Poolside coding model, 262K context',
    contextLength: 262_144,
  },
  {
    id: 'poolside/laguna-xs-2.1:free',
    name: 'Poolside Laguna XS 2.1',
    provider: 'kilo',
    description: 'Poolside small coding model, 262K context',
    contextLength: 262_144,
  },
  {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere North Mini Code',
    provider: 'kilo',
    description: 'Cohere coding model, 256K context',
    contextLength: 256_000,
  },
  {
    id: 'liquid/lfm-2.5-2.6b:free',
    name: 'Liquid LFM 2.5 2.6B',
    provider: 'kilo',
    description: 'Liquid AI small fast model, 64K context',
    contextLength: 65_536,
  },
  {
    id: 'openrouter/free',
    name: 'OpenRouter Free Router',
    provider: 'kilo',
    description: 'OpenRouter free-tier auto router, 200K context',
    contextLength: 200_000,
    capabilities: ['vision'],
  },
  {
    id: 'stealth/glyph-cluster',
    name: 'Glyph Cluster',
    provider: 'kilo',
    description: 'Stealth preview model, 256K context',
    contextLength: 256_000,
  },
]
```

Notes that constrain the implementer:
- Import `ModelInfo` as a type from `'../../types'` (the `ProviderExtraMethods.listModels` return
  type, `packages/stage-ui/src/libs/providers/types.ts:103-111`).
- Do not export the constant; it mirrors `minimax`'s local const.
- Ordering of this array is the fallback display order; live results are ordered first
  regardless (Step 2).
- `contextLength` is the field name consumed by `fetchModelsForProvider`; do not use
  `context_length` for preset rows.

### Step 2 — Rewrite `listModels` so live results take precedence

Replace the entire existing `extraMethods.listModels` body in the same file. The new behavior:

```ts
  extraMethods: {
    listModels: async () => {
      try {
        const response = await fetch('https://api.kilo.ai/api/gateway/models')
        if (!response.ok) {
          throw new Error(`Failed to fetch models: ${response.status}`)
        }
        const data = await response.json()
        // Expected format: { data: [{ id: string, ... }] } or array
        const models = Array.isArray(data) ? data : (data.data || [])

        const live = models
          .filter((model: any) => model.isFree === true || model.id?.includes(':free') || /(^|\/)free$/.test(model.id ?? ''))
          .map((model: any) => ({
            id: model.id as string,
            name: model.name as string,
            provider: 'kilo',
            description: (model.description || 'Kilo Gateway free model') as string,
            contextLength: (model.context_length ?? model.top_provider?.context_length) as number | undefined,
            capabilities: (model.architecture?.input_modalities?.includes('image') ? ['vision'] : undefined) as string[] | undefined,
          }))
          .filter((m: any) => !!m.id)

        // Live listing takes precedence. Merge presets only for IDs the live
        // call did not surface, and keep preset metadata when the ID matches.
        const presetById = new Map(kiloPresetModels.map(m => [m.id, m]))
        const merged = live.map((model: any) => {
          const preset = presetById.get(model.id)
          if (!preset)
            return model
          presetById.delete(model.id)
          return {
            ...model,
            name: preset.name,
            description: preset.description ?? model.description,
            contextLength: model.contextLength ?? preset.contextLength,
            capabilities: model.capabilities?.length ? model.capabilities : preset.capabilities,
          }
        })
        for (const preset of presetById.values())
          merged.push(preset)

        return merged
      }
      catch {
        // Live fetch failed (offline, CORS, provider outage): the preset list
        // keeps the model picker non-empty instead of returning [].
        return kiloPresetModels
      }
    },
  },
```

Load-bearing details:
- **Live-first ordering.** `live` is mapped in the endpoint's own order; presets are appended
  afterwards. Onboarding auto-selects `models[0].id`
  (`packages/stage-ui/src/components/scenarios/dialogs/onboarding/v3/steps/step-consciousness.vue:357-359`),
  so the first live model wins, which is the user's stated precedence.
- **Free detection must not be `:free`-only.** Use the union of `model.isFree === true`,
  `id.includes(':free')`, and the regex `/(^|\/)free$/` — the last catches `kilo-auto/free` and
  `openrouter/free`. Verified against the live payload: this yields exactly the 17 `isFree: true`
  entries.
- **`isFree === true` must be a strict comparison** — the live payload sets `isFree: false`
  explicitly on paid models, so truthiness alone is also correct, but strict is unambiguous.
- **Preset metadata merge rule.** A preset overrides `name` and `description`; `contextLength`
  and `capabilities` take the live value when present and fall back to the preset. This preserves
  live accuracy for numbers while keeping the friendly display name in the picker.
- **Delete the five stale IDs** `kilo-auto`, `poolside/laguna-m.1:free`,
  `poolside/laguna-xs.2:free`, `stepfun/step-3.7-flash:free` — all absent or paid upstream.
  Clean cutover; no compatibility alias.
- **Keep the outer `try/catch` returning `kiloPresetModels`.** This is the specific reason the
  current code's `catch` is retained rather than removed: the store clears the array to `[]` on
  throw (`runtime/models.ts:92`), and an empty picker is the reported failure mode.
- Do not change `fetch`, the URL, the error string format, `validators`,
  `validationRequiredWhen`, `createProvider`, or the schema in this step.

### Step 3 — Fix the Quick Start default model ID

Target: `packages/stage-ui/src/components/scenarios/dialogs/onboarding/v3/quick-start.vue:369-370`.

The `llmModel` getter returns the literal `'kilo-auto'` for the Kilo provider, which is the paid
model ID (`401 PAID_MODEL_AUTH_REQUIRED` keyless). Change the literal to the live free ID:

```ts
    if (llmProvider.value === 'kilo')
      return 'kilo-auto/free'
```

This is the only `'kilo-auto'` literal in `quick-start.vue` (line 370). Do not touch the
`lanlan-free` → `'free-model'` or `openai` → `'gpt-4o'` branches.

### Step 4 — Update the provider test to pin the new contract

Target: `packages/stage-ui/src/libs/providers/providers/kilo/index.test.ts`.

Keep the six existing tests. Two need edits and three need adding.

Edit the live-listing test is not present; instead replace the
`'creates an OpenAI-compatible provider with Kilo defaults'` test's model literal from
`'kilo-auto'` to `'kilo-auto/free'` (lines 40 and 43) so it stops asserting against the paid ID.

Add these tests inside the existing `describe('providerKilo', ...)` block:

```ts
  it('lists every gateway free model once the live listing is used', async () => {
    const config = { apiKey: '', baseUrl: 'https://api.kilo.ai/api/gateway/v1' }
    const provider = await providerKilo.createProvider(config)
    const models = await providerKilo.extraMethods?.listModels?.(config, provider)

    // Live listing takes precedence: at least the gateway's isFree models surface.
    expect((models ?? []).length).toBeGreaterThanOrEqual(17)
    // The 4 free models with no :free suffix used to be dropped by the id filter.
    for (const id of ['kilo-auto/free', 'openrouter/free', 'reflection/beam-free', 'stealth/glyph-cluster']) {
      expect((models ?? []).some(m => m.id === id)).toBe(true)
    }
    // Presets never duplicate a live row.
    const ids = (models ?? []).map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps preset metadata when a live row matches a preset id', async () => {
    const config = { apiKey: '', baseUrl: 'https://api.kilo.ai/api/gateway/v1' }
    const provider = await providerKilo.createProvider(config)
    const models = await providerKilo.extraMethods?.listModels?.(config, provider)
    const dots = (models ?? []).find(m => m.id === 'dots-studio/dots-3-note-preview:free')

    expect(dots?.name).toBe('Dots3-Note Preview')
    expect(dots?.contextLength).toBe(512_000)
  })

  it('falls back to the preset list when the live fetch fails', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('offline') }) as typeof fetch
    try {
      const config = { apiKey: '', baseUrl: 'https://api.kilo.ai/api/gateway/v1' }
      const provider = await providerKilo.createProvider(config)
      const models = await providerKilo.extraMethods?.listModels?.(config, provider)

      expect((models ?? []).length).toBeGreaterThan(0)
      expect((models ?? []).every(m => m.id.includes(':free') || /(^|\/)free$/.test(m.id))).toBe(true)
      // No stale IDs survive in the preset fallback.
      expect((models ?? []).some(m => m.id === 'kilo-auto')).toBe(false)
      expect((models ?? []).some(m => m.id === 'poolside/laguna-m.1:free')).toBe(false)
    }
    finally {
      globalThis.fetch = originalFetch
    }
  })
```

Notes that constrain the implementer:
- The live-listing tests hit the network. They are the intended verification of Step 2's
  filter and merge behavior, and must not be mocked to a fixture — the live gateway is the
  source of truth the plan commits to.
- `expect(...length).toBeGreaterThanOrEqual(17)` is deliberately a lower bound so an upstream
  model addition does not fail CI; the `isFree` count was 17 on 2026-10-17.
- The `globalThis.fetch` stub must be restored in `finally`, otherwise later tests in the same
  file break.
- Do not weaken the existing `'fills the default base URL and empty apiKey'`,
  `'allows overriding base URL'`, `'always requires validation'`, or
  `'has keyless provider configuration'` tests.

## Critical files & anchors

- `packages/stage-ui/src/libs/providers/providers/kilo/index.ts` — the whole change; `listModels`
  at lines 52-107 is replaced, `kiloPresetModels` is added above `providerKilo` (line 20).
- `packages/stage-ui/src/libs/providers/types.ts:103-111` — `ModelInfo` shape
  (`contextLength`, `capabilities?: string[]`) the preset constant must satisfy.
- `packages/stage-ui/src/stores/providers/runtime/models.ts:89-94` — clears
  `runtimeState.models` to `[]` on throw; the reason the `catch` must return presets, not rethrow.
- `packages/stage-ui/src/components/scenarios/dialogs/onboarding/v3/quick-start.vue:369-370` —
  the stale `'kilo-auto'` default that must become `'kilo-auto/free'`.
- `packages/stage-ui/src/libs/providers/providers/kilo/index.test.ts` — contract pinning;
  the existing `'kilo-auto'` literals at lines 40 and 43.

## About the Free Hub (no change planned)

The Free Hub
(`packages/stage-pages/src/pages/settings/providers/free-hub/index.vue` +
`helpers.ts`) resolves the `kilo` catalog platform to the generic `openai-compatible` provider
rather than the dedicated Kilo provider, via `resolveProviderId`'s `default:` branch
(`helpers.ts:40-42`). Live probing confirms this path still works for Kilo today: Kilo's base
URL `https://api.kilo.ai/api/gateway/v1` serves both `/models` (200) and
`/chat/completions` (200, keyless), so `openai-compatible` reaches it correctly — verified with
`poolside/laguna-s-2.1:free`, `kilo-auto/free`, and
`dots-studio/dots-3-note-preview:free` all returning 200.

So this is a routing shortcut that loses the dedicated Kilo provider's preset metadata and its
`listModels`, not a currently broken path. It is not part of this task; the plan changes the
Kilo provider itself, which benefits the settings pages, onboarding, and BrainModelPicker that
do resolve `'kilo'` directly.

## Verification

Run from the repo root `/home/vi/7n1m4/airi`.

1. Unit tests for the provider (Steps 1, 2, 4):
   `pnpm -F @proj-airi/stage-ui test -- src/libs/providers/providers/kilo/index.test.ts`
   Expected: the original 6 tests pass with the `'kilo-auto'` → `'kilo-auto/free'` literal
   updated, plus the 3 new tests pass. Concretely: the live-listing test reports
   `>= 17` models and contains `kilo-auto/free`, `openrouter/free`, `reflection/beam-free`,
   `stealth/glyph-cluster` with no duplicate ids; the metadata test finds
   `dots-studio/dots-3-note-preview:free` with `name: 'Dots3-Note Preview'` and
   `contextLength: 512_000`; the offline test returns a non-empty list containing no
   `'kilo-auto'` and no `'poolside/laguna-m.1:free'`.

2. Free-model source check (Step 2's filter, independent of the test):
   ```
   curl -s https://api.kilo.ai/api/gateway/models \
     | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(len([m for m in d if m.get('isFree') is True]))"
   ```
   Expected: `17`. Then the three formerly-dropped IDs must be in the returned list:
   ```
   curl -s https://api.kilo.ai/api/gateway/models \
     | grep -c -E '"(kilo-auto/openrouter)/free"|reflection/beam-free|stealth/glyph-cluster'
   ```
   Expected: `3`.

3. End-to-end provider behavior (Steps 1-3) — smoke the real picker path in a throwaway script,
   then delete it:
   ```
   cd /home/vi/7n1m4/airi
   cat > /tmp/kilo-smoke.mjs <<'EOF'
   // Exercises convertProviderDefinitionToMetadata -> listModels, i.e. what
   // fetchModelsForProvider stores in runtimeState.models.
   import { convertProviderDefinitionToMetadata } from './packages/stage-ui/src/stores/providers/converters.ts'
   import { providerKilo } from './packages/stage-ui/src/libs/providers/providers/kilo/index.ts'

   const meta = convertProviderDefinitionToMetadata(providerKilo, k => k)
   const models = await meta.capabilities.listModels({})
   console.log('count:', models.length)
   console.log('first:', models[0].id, '| name:', models[0].name, '| ctx:', models[0].contextLength)
   console.log('has free-suffix-less:', models.some(m => m.id === 'kilo-auto/free'))
   console.log('has paid kilo-auto literal:', models.some(m => m.id === 'kilo-auto'))
   console.log('no stale fallback:', !models.some(m => m.id === 'poolside/laguna-m.1:free'))
   EOF
   pnpm dlx tsx /tmp/kilo-smoke.mjs
   ```
   Expected observable output: `count:` an integer `>= 17`; `first:` a live Kilo model id with a
   friendly `name` (preset override active when the id is in the preset list); `has
   free-suffix-less: true`; `has paid kilo-auto literal: false`; `no stale fallback: true`.
   Requires network access to `api.kilo.ai`.

4. Offline fallback (Step 2's catch) — rerun the same script with the network blocked, then
   delete it:
   ```
   HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 pnpm dlx tsx /tmp/kilo-smoke.mjs
   ```
   Expected: `count:` equals the preset constant's length (17), first row is `kilo-auto/free`,
   and the three "no stale / no paid literal" lines are still `true`. Remove the script with
   `rm /tmp/kilo-smoke.mjs` afterward — it lives outside the repo and is not part of the diff.

5. Typecheck the affected workspace (Step 1's new typed constant):
   `pnpm -F @proj-airi/stage-ui typecheck`
   Expected: no new errors. The `ModelInfo` import must be a `import type` to satisfy the
   repo's lint import rules.

## Assumptions & contingencies

- The live endpoint's `isFree` flag is the authoritative free-model marker; `:free` is kept as
  a secondary signal because not every free model carries the suffix. If the endpoint ever
  returns `isFree` absent (e.g. a payload change), the union filter still catches
  `:free`-suffixed and `/free`-suffixed IDs, and `stealth/glyph-cluster` — which has neither a
  suffix nor `isFree` in that hypothetical — would be dropped from the live list but retained
  via the preset merge, so the picker never loses it.
- Preset `contextLength` values are taken from the live listing (and cross-checked against
  ~/pi-freeflow/src/models.ts's Kilo lane). If a preset's context window is contested during
  implementation, prefer the live `context_length` value — Step 2 only applies the preset
  number when the live row lacks one.
- `nvidia/nemotron-3.5-content-safety:free` is retained despite being a moderation classifier
  rather than a chat model, because it is a live free listing entry and dropping it would be a
  silent scope cut. If it proves to break chat turns, keep it in the list and record that in
  the `description` — do not add client-side filtering.
- Kilo's keyless quota is shared per IP; intermittent `429`/`503` responses were observed during
  live probing (e.g. `kilo-auto/free` returned 503 then 200 on retry). The `catch` returns
  presets, so a transient failure degrades gracefully rather than emptying the picker. No retry
  logic is added — that would be out of scope.
