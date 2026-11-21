# Daemon Provider Configuration & Settings RPC Design

**Status**: Implemented  
**Issue**: airi-wxp.1.2  
**Scope**: Provider configuration, user settings, and vault status exposed via client-agnostic RPC

## Overview

The daemon exposes provider configuration and user settings to Flutter, Godot, and Vue clients through a unified WebSocket RPC surface at port 6121. This absorbs provider registry/config/secret ownership and settings management from individual clients into the daemon, ensuring:

- **Single source of truth**: One authoritative store for providers and settings
- **Secret discipline**: API keys never cross the wire in replies
- **Client-agnostic**: Same RPC surface serves Flutter, Godot, Vue without per-client logic
- **Fail-closed**: Unavailable store/vault returns sanitized errors (no path leak)

## RPC Actions

All actions use the existing `rpc` frame format: `{"type":"rpc","action":"…","payload":{…}}`.

### `providers.list`

List all configured LLM providers (metadata only, no secrets).

**Request**: `{}`

**Response**:
```json
{
  "providers": [
    {
      "id": "openai",
      "kind": "openai",
      "model": "gpt-4o",
      "baseUrl": "https://api.openai.com/v1",
      "enabled": true,
      "updatedAt": 1234567890
    }
  ]
}
```

**Fields**:
- `id`: Provider identifier (e.g. `openai`, `llama-cpp-local`)
- `kind`: Provider kind tag (`openai`, `llama-cpp`, etc.)
- `model`: Model name (empty string if not configured)
- `baseUrl`: Base URL (empty string if using default)
- `enabled`: Whether this provider is active
- `updatedAt`: Unix milliseconds of last update

**No-secrets rule**: Response NEVER contains `apiKey`, `api_key`, `secret`, `token`, `config`, or `authToken`.

### `providers.set` — **PENDING (not implemented this wave)**

Create or update a provider configuration. The API key is write-only.

**Request**:
```json
{
  "id": "openai",
  "kind": "openai",
  "model": "gpt-4o",
  "baseUrl": "https://api.openai.com/v1",
  "enabled": true,
  "apiKey": "sk-..."
}
```

**Response**:
```json
{
  "ok": true
}
```

**On error**:
```json
{
  "ok": false,
  "error": "provider id is required"
}
```

**Write-only secret**: The `apiKey` field is accepted in requests but NEVER returned in replies.

### `settings.get`

Get a typed settings section.

**Request**:
```json
{
  "section": "chat"
}
```

**Response** (example for `chat`):
```json
{
  "section": "chat",
  "settings": {
    "sendMode": "enter",
    "suggestMode": "whisper",
    "streamIdleTimeoutMs": 600000,
    "showDirectorNotes": true,
    "combineSystemMessages": true
  }
}
```

**Supported sections**:
- `general` — GeneralSettings
- `chat` — ChatSettings
- `theme` — ThemeSettings
- `control-strip` — ControlStripSettings
- `cards` — CardsSettings
- `stage-model` — StageModelSettings
- `captions` — CaptionsSettings
- `stage-window` — StageWindowSettings
- `positioning` — PositioningSettings
- `spine` — SpineSettings
- `mmd` — MmdSettings
- `live2d` — Live2dSettings
- `audio-device` — AudioDeviceSettings
- `user-profile` — UserProfileSettings
- `local-llm` — LocalLlmSettings

**No-secrets rule**: Settings sections do not contain secrets (API keys live in the providers table, not in settings).

### `settings.set` — **PENDING (not implemented this wave)**

Update a typed settings section.

**Request**:
```json
{
  "section": "chat",
  "settings": {
    "sendMode": "enter",
    "suggestMode": "hold",
    "streamIdleTimeoutMs": 600000,
    "showDirectorNotes": true,
    "combineSystemMessages": true
  }
}
```

**Response**:
```json
{
  "ok": true
}
```

**On error**:
```json
{
  "ok": false,
  "error": "invalid settings shape for section chat"
}
```

### `vault.status`

Get vault (data export/import) statistics.

**Request**: `{}`

**Response**:
```json
{
  "available": true,
  "stats": {
    "chats": {
      "sessions": 10,
      "messages": 42,
      "bytes": 123456
    },
    "memory": {
      "summaries": 5,
      "journalEntries": 12,
      "bytes": 67890
    },
    "providers": {
      "count": 3,
      "bytes": 1024
    },
    "characters": {
      "count": 8,
      "bytes": 2048000
    }
  }
}
```

**No-secrets rule**: Stats report counts and byte sizes only, never provider API keys or config contents.

## Secret Discipline

The daemon NEVER sends secret material (API keys, tokens, vault ciphertext) in RPC replies. This is enforced by:

1. **Type-level exclusion**: Reply DTOs (`ProviderInfo`, `ProvidersListReply`, `VaultStatsReply`) contain no `apiKey`, `secret`, or `token` fields.
2. **Test coverage**: `wire.rs` tests assert no secret-bearing fields exist in serialized reply shapes.
3. **Single-writer facade**: Provider secrets are write-only via `providers.set`; the daemon stores them in SQLite but never echoes them back.

## Client Consumption

### Flutter
```dart
final providers = await client.rpc('providers.list', {});
final settings = await client.rpc('settings.get', {'section': 'chat'});
await client.rpc('settings.set', {
  'section': 'chat',
  'settings': {'sendMode': 'enter', ...},
});
```

### Godot (C#)
```csharp
var providers = await client.RpcAsync("providers.list", new { });
var settings = await client.RpcAsync("settings.get", new { section = "chat" });
await client.RpcAsync("settings.set", new {
  section = "chat",
  settings = new { sendMode = "enter", ... }
});
```

### Vue/TypeScript
```typescript
const providers = await client.rpc('providers.list', {});
const settings = await client.rpc('settings.get', { section: 'chat' });
await client.rpc('settings.set', {
  section: 'chat',
  settings: { sendMode: 'enter', ... },
});
```

## Acceptance Criteria (airi-wxp.1.2)

- [x] Design documented (this file)
- [x] Read-only settings / providers / vault via RPC with deterministic tests (write operations pending)
- [x] Secrets never exposed in replies
- [x] No client-local writer (all clients consume the same daemon surface)

## Architecture

```
┌─────────────┐  WebSocket (port 6121)  ┌──────────────┐
│   Flutter   │◀────────────────────────▶│              │
│   Godot     │                            │   Daemon     │
│   Vue       │◀────────────────────────▶│   Gateway    │
└─────────────┘                            └──────┬───────┘
                                                  │
                                                  ▼
                                         ┌────────────────┐
                                         │  CoreService   │
                                         │  (single       │
                                         │   writer)      │
                                         └────────┬───────┘
                                                  │
                                                  ▼
                                         ┌────────────────┐
                                         │  anima-store   │
                                         │  (SQLite)      │
                                         │  - providers   │
                                         │  - settings    │
                                         └────────────────┘
```

The `CoreService` wraps `anima-store`'s `ProviderRepo` and `SettingsStore`, providing a single-writer facade that:
- Fails closed when the store is unavailable (returns sanitized error)
- Enforces no-secrets discipline (never echoes API keys)
- Serializes access through a mutex (thread-safe)

## Error Handling

All RPCs return sanitized errors that do not leak:
- Filesystem paths
- SQLite error details
- Secret material

Example error reply:
```json
{
  "ok": false,
  "error": "store unavailable"
}
```

The gateway logs detailed errors server-side for diagnostics but clients see only the sanitized message.