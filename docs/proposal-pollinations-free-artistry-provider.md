# Architectural Proposal: Zero-Config Free Artistry Provider (Pollinations AI)

**Status:** Proposed Architecture & Design Specification
**Target Subsystems:**
- `packages/stage-pages/src/pages/settings/modules/artistry.vue` (Artistry Module Switchboard)
- `packages/stage-ui/src/stores/modules/artistry.ts` (Artistry Pinia Store & Config)
- `apps/stage-tamagotchi/src/main/services/airi/widgets/providers/pollinations.ts` (Pollinations Backend Provider)
- `apps/stage-tamagotchi/src/main/services/airi/widgets/artistry-bridge.ts` (Provider Registry)
- `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/image-journal.ts` (Tool Routing)
- `packages/stage-ui/src/stores/modules/artistry-autonomous.ts` (Autonomous Artistry Director)

**Authoritative References:**
- [`.agents/skills/airi-artistry-comfyui-widgets/`](../.agents/skills/airi-artistry-comfyui-widgets/SKILL.md) — Artistry store, widget routing, and headless generation contracts.
- [`docs/proposal-generative-code-painting-rwkv-webllm.md`](./proposal-generative-code-painting-rwkv-webllm.md) — Dual-Engine Generative Code-Painting (Procedural + RWKV-7).
- [`docs/data-catalog.md`](./data-catalog.md) — Persistent storage keys and settings catalog.

---

## 1. Executive Summary

AIRI's **Autonomous Artistry (AA)** and **Image Journal (`image_journal`)** allow the AI companion to autonomously paint scenes, create selfie polaroids, and update room backdrops.

Currently, all raster generation backends require either:
1. **High Hardware Resources**: Local `ComfyUI` requires a discrete NVIDIA GPU with 8GB–16GB VRAM running locally via Python/CUDA.
2. **Paid Cloud Accounts**: `Replicate.ai` or `NanoBanana` require external API tokens, billing setup, and credit cards.

### The Solution: Zero-Configuration Pollinations AI Provider

[Pollinations.ai](https://pollinations.ai) provides a publicly available, unmetered, zero-key image synthesis endpoint powered by open-weight diffusion clusters (Flux, SDXL, Turbo):

```http
GET https://image.pollinations.ai/prompt/{encoded_prompt}?width={width}&height={height}&seed={seed}&model={model}&nologo=true
```

By adding **`PollinationsProvider`** to AIRI's Artistry architecture:
- **Instant Out-of-the-Box Functionality**: New users can generate background art and journal polaroids immediately without installing ComfyUI or acquiring API keys.
- **Zero Local VRAM Impact**: Leaves 100% of GPU resources available for 3D VRM and Live2D avatars.
- **Seamless Fallback**: Functions as a zero-cost fallback when local ComfyUI is offline or paid cloud credits run out.

---

## 2. API Contract & Dynamic Model Discovery

### 2.1 Dynamic Model Discovery (`listModels`)
Pollinations provides a live model catalog endpoint:
```http
GET https://gen.pollinations.ai/models
```
Returns an array of rich model metadata objects:
```json
[
  {
    "name": "flux",
    "title": "FLUX.1 Schnell",
    "description": "Fast, high-quality images at a tiny cost",
    "category": "image",
    "pricing": { "currency": "pollen", "completionImageTokens": "0.002" },
    "aliases": ["black-forest-labs/flux.1-schnell"]
  },
  {
    "name": "gptimage-large",
    "title": "GPT Image 1.5",
    "description": "High-fidelity image generation and editing with fine detail",
    "category": "image",
    "pricing": { "currency": "pollen", "completionImageTokens": "0.000024" }
  },
  {
    "name": "nanobanana-pro",
    "title": "Nano Banana Pro",
    "description": "Studio-quality images up to 4K, with reasoning for tricky prompts",
    "category": "image",
    "pricing": { "currency": "pollen", "completionImageTokens": "0.00012" }
  }
]
```

### 2.2 Model Selection & The Empty-String Auto-Router Rule
* **Default Option (`""` / Empty String)**:
  * Mapped to UI label: **`"Free Router (Pollinations Auto)"`**.
  * When `model: ""` is passed, no `&model=` parameter is appended to the request URL, letting Pollinations' backend automatically route to the fastest free available cluster node.
* **Explicit Model Selection**:
  * Users can dynamically pick specific models (e.g. `flux`, `gptimage-large`, `nanobanana-pro`, `seedream-pro`, `MarcosFRG/sdxl-lightning`).
  * If the network is offline when opening settings, the UI gracefully falls back to a curated offline model list.

### 2.3 Request Execution Flow
1. Main process constructs parameterized URL:
   ```typescript
   const modelParam = model ? `&model=${encodeURIComponent(model)}` : ''
   const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}${modelParam}&nologo=true`
   ```
2. Downloads binary array buffer with an `AbortSignal.timeout(60000)` safety gate.
3. Converts directly to base64 string or stores in localforage background journal (`bg-{nanoid}`).
4. Returns result to `image-journal.ts` or `artistry-autonomous.ts`.

---

## 3. Architecture & Code Integration Points

### 3.1 Main-Process Provider (`PollinationsProvider`)
Located at `apps/stage-tamagotchi/src/main/services/airi/widgets/providers/pollinations.ts`:
Implements the standard `ArtistryProvider` interface with dynamic model fetching:

```typescript
import { Buffer } from 'node:buffer'

export class PollinationsProvider implements ArtistryProvider {
  readonly id = 'pollinations'
  readonly name = 'Pollinations AI (Free / Zero-Config)'
  private defaultModel = ''

  async listModels(): Promise<Array<{ id: string, name: string, description?: string, price?: string }>> {
    try {
      const res = await fetch('https://gen.pollinations.ai/models', { signal: AbortSignal.timeout(8000) })
      if (!res.ok)
        throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const imageModels = data.filter((m: any) => m.category === 'image' || m.output_modalities?.includes('image'))
      return [
        { id: '', name: 'Free Router (Pollinations Auto)', description: 'Automatically routes to the fastest available free cluster' },
        ...imageModels.map((m: any) => ({
          id: m.name,
          name: m.title || m.name,
          description: m.description,
          price: m.pricing?.completionImageTokens ? `${m.pricing.completionImageTokens} pollen` : undefined,
        })),
      ]
    }
    catch {
      // Curated offline fallback
      return [
        { id: '', name: 'Free Router (Pollinations Auto)', description: 'Fastest available free cluster' },
        { id: 'flux', name: 'FLUX.1 Schnell', description: 'Fast, high-quality diffusion' },
        { id: 'gptimage-large', name: 'GPT Image 1.5', description: 'High-fidelity OpenAI image model' },
        { id: 'nanobanana-pro', name: 'Nano Banana Pro', description: 'Studio quality up to 4K' },
        { id: 'seedream-pro', name: 'Seedream 4.5', description: 'Premium photorealism' },
      ]
    }
  }

  async generate(request: ArtistryRequest): Promise<ArtistryJob> {
    const jobId = request.extra?.internalJobId || `pollinations-${Date.now()}`
    const model = request.model || this.defaultModel
    const width = request.extra?.width || 1024
    const height = request.extra?.height || 1024
    const seed = request.extra?.seed || Math.floor(Math.random() * 1000000)

    this.runGeneration(jobId, model, request.prompt, width, height, seed)
    return { jobId, providerJobId: jobId }
  }

  private async runGeneration(jobId: string, model: string, prompt: string, width: number, height: number, seed: number) {
    try {
      this.updateStatus(jobId, { status: 'processing', progress: 20 })
      const modelParam = model ? `&model=${encodeURIComponent(model)}` : ''
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}${modelParam}&nologo=true`

      const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
      if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)

      const arrayBuffer = await response.arrayBuffer()
      const base64 = Buffer.from(arrayBuffer).toString('base64')

      this.updateStatus(jobId, {
        status: 'completed',
        progress: 100,
        result: { base64, imageUrl: url },
      })
    }
    catch (error: any) {
      this.updateStatus(jobId, { status: 'failed', error: error.message })
    }
  }
}
```

### 3.2 Artistry Bridge Registry
Registered in `apps/stage-tamagotchi/src/main/services/airi/widgets/artistry-bridge.ts`:
```typescript
artistryProviders.set('pollinations', new PollinationsProvider())
```

### 3.3 Pinia Store & UI Switchboard
In `packages/stage-ui/src/stores/modules/artistry.ts`:
- Add `'pollinations'` to `ArtistryProviderType = 'comfyui' | 'replicate' | 'nanobanana' | 'pollinations'`.
- Add default settings: `{ pollinationsModel: '', pollinationsWidth: 1024, pollinationsHeight: 1024 }`.
- Add `fetchPollinationsModels()` action with caching in Pinia store.

In `packages/stage-pages/src/pages/settings/modules/artistry.vue`:
- Add `Pollinations AI (Free / No Key)` provider card with dynamic model dropdown showing live pricing tags and descriptions.

---

## 4. Error Handling & Graceful Fallbacks

| Scenario | Behavior |
| :--- | :--- |
| **Network Timeout (>60s)** | Abort fetch, emit clear error notification, and allow user/agent to retry. |
| **Catalog Fetch Failure** | Fall back to curated offline model list without crashing the UI. |
| **Invalid Prompt / Content Filter** | Returns empty response or HTTP error; catches gracefully and reports to chat slice. |

---

## 5. Security & Privacy Considerations

- **No Secret Storage**: Because Pollinations is unauthenticated, zero API keys or secrets are stored in `localStorage` or `credentials.json`.
- **Public URL Content**: As with any public cloud inference service, prompts sent to Pollinations are processed by their infrastructure. Users desiring 100% air-gapped privacy are routed to Local ComfyUI or Local RWKV-7 Code-Painting.

