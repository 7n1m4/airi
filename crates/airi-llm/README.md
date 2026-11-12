<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# airi-llm

Streaming OpenAI-compatible **chat provider registry** for the AIRi Qt rewrite.
Pure async (tokio/reqwest) crate: **no Qt, no `airi-store`, no `airi-core`, no
`airi-i18n`**. JSON appears only at the HTTP and config boundaries; public APIs
are typed structs. Desktop HTTP — no CORS handling.

## Layout

| Module | Contents |
|---|---|
| `registry` | Static `PROVIDER_DEFS` (44 ids from `docs/port-manifest/providers.md` plus the port-native `llama-cpp-local` row; 45 total), `ProviderDef`, `ProviderKind`, `CredentialSchema`, `CompatFlags`, `ProviderRegistry`, `ProviderConfig` |
| `types` | `ChatRequest`, `ChatMessage`, `Role`, `ToolSpec`, `ChatChunk`, `ModelInfo`, `ChatStream` |
| `lib` | `ChatProvider` trait (`id` / `models` / `stream`), `ChatClient` compat trait (blanket impl, used by `airi-core`), `build_client`, `LlmError` / `ProviderError` |
| `sse` | Incremental `text/event-stream` parser (partial lines, `\r\n`) |
| `client_openai` | Hand-rolled reqwest + SSE OpenAI-compatible client (also serves Ollama / LM Studio / Pollinations) |
| `client_anthropic` | Hand-rolled Anthropic Messages API client |
| `client_gemini` | Hand-rolled Google Gemini native API client |
| `client_stub` | `UnsupportedChatClient` for not-yet-wired providers |

## Client implementations (the only per-wire code)

OpenAI-compatible providers are **config rows**, not new code: one client, one
registry entry each. `async-openai` was deliberately not used — the hand-rolled
SSE path is ~150 lines and tolerates provider quirks (`reasoning_content`,
`[DONE]`, custom base URLs). All three live clients share the SSE parser and
the `sse_chat_stream` pump.

| Kind | Status | Notes |
|---|---|---|
| `OpenAiCompatible` | ✅ implemented | `POST {base}/chat/completions` (`stream: true`), `GET {base}/models`. `tools` mapped to OpenAI `tools[].function`; `stream`/`max_tokens`/`temperature` honoured. |
| `LocalServer` (ollama, lm-studio) | ✅ implemented | Same wire; credential schema makes `api_key` optional. |
| `Anthropic` | ✅ implemented | Messages API via `{base}/messages`, `anthropic-version: 2023-06-01`, `x-api-key` header. Top-level `system`; `max_tokens` defaults to 4096 (API requires it); `tools` → `input_schema`. |
| `GoogleGemini` | ✅ implemented | `{base}/models/{m}:streamGenerateContent?alt=sse`, key via `x-goog-api-key` header (never the URL). Models list via `{base}/models`, `models/` prefix stripped. |
| `AwsBedrock` | ⚠️ stub | `amazon-bedrock` builds an `UnsupportedChatClient`; SigV4-signed Converse/InvokeModel APIs are a later phase. Not faked. |
| `LocalServer` (laya-local, openjev-local) | ⚠️ stub | On-device engines (ONNX / ModernBERT) land in a later phase; `stream()`/`models()` return `LlmError::UnsupportedProvider`. |
| `typesafe-ai` | ⚠️ stub | System-1 decision engine, **not a chat provider**; registered for UI completeness, always `UnsupportedProvider`. |

Other registry caveats:

- **azure-openai / azure-ai-foundry**: OpenAI wire but deployment-scoped base
  URL with `?api-version=` passthrough, which this client does not do yet. Set
  `base_url` to a fronting proxy or use `openai-compatible`; tracked as a gap.
- **byteplus / byteplus-coding-plan / volcengine-coding-plan**: Ark APIs are
  OpenAI-wire (`createOpenAI` in stage-ui); the manifest's
  `OpenAI-compatible: no` flag reflects custom validators, not the protocol.
- **minimax**: default is the international endpoint (`api.minimax.io`);
  override `base_url` to `https://api.minimaxi.com/v1` for the CN endpoint.
- **alibaba-cloud**: no default `base_url` — endpoints are workspace-scoped.
- **cloudflare-workers-ai**: set `base_url` to
  `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1`.
- **pollinations**: keyless by default.
- **Vision/multimodal** is intentionally not declared in `CompatFlags` — it is
  a per-model property, not per-provider.

## Auth / key handling

- API keys are sent only via headers (`Authorization: Bearer`,
  `x-api-key`, `x-goog-api-key`) — never in URLs, so reqwest transport errors
  cannot leak keys.
- Non-success responses are mapped to `LlmError::Provider` with the body
  truncated to 512 chars.

## Traits

`ChatProvider` is canonical. `ChatClient` keeps the P0 `stream_chat` method for
`airi-core` (untouched) and is blanket-implemented for every `ChatProvider`.
`ProviderError` is an alias of `LlmError`.

## Testing

`cargo test -p airi-llm --all-targets` — unit tests plus
`tests/mock_provider.rs`, which spins up an in-test `mockito` server and
asserts streamed deltas, finish reasons, `[DONE]` termination, and model-list
parsing for the OpenAI-compatible, Anthropic, and Gemini wires.
