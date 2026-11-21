# Mode selection matrix

Documents how the daemon-owned vs client-local store ownership is chosen at
startup. Selection is pure: configuration (`Disabled`/`Auto`/`Required`)
plus a health probe (`core.status`). Ownership never flips mid-session.

## Modes

| Configured mode | Probe result | Selected mode | Store owner |
|---|---|---|---|
| `Disabled` | never probed | `Local` | client opens its own `airi.sqlite` |
| `Auto` | healthy | `Daemon` | daemon owns store; client uses RPC |
| `Auto` | unhealthy / unreachable | `Local` | client opens local store (fallback) |
| `Required` | healthy | `Daemon` | daemon owns store; client uses RPC |
| `Required` | unhealthy / unreachable | `Unavailable` | **no store opened** (fail-closed) |

## Single-writer rule

In `Daemon` mode the daemon is the only process that opens the profile's
`airi.sqlite`. Clients never open a competing store file; they read and
write through daemon RPC (`core.status`, settings, sessions, providers,
memory/journal, cards). In `Local` mode the client is the sole writer (the
current Slint behavior). `Unavailable` opens nothing — no empty/temp/
fallback database.

## Assertions (crates/anima-daemon/tests/ownership.rs)

- `daemon_mode_owns_the_store`: daemon profile opens store; client profile has
  no store file.
- `fallback_mode_opens_local_store`: local profile opens store; daemon profile
  (unused) has no store.
- `required_unhealthy_never_opens_local`: no store file created.
- `daemon_and_local_are_distinct_profiles`: distinct profiles → distinct DBs.
- `chat_sessions_daemon_store_operates`: `SessionRepo` operates on daemon store;
  client profile has no store.
- `stmm_and_journal_daemon_store_appends`: `SummaryRepo` + `TextJournalService`
  append on daemon store; client profile has no store.
- `cards_daemon_settings_load_and_save`: `SettingsStore` cards section
  load/save on daemon store; client profile has no store.
- `mode_selection_controls_store_ownership`: end-to-end matrix assertion.

## References

- `crates/anima-slint/src/daemon_mode.rs` — `select_mode`, `DaemonMode`,
  `SelectedMode`.
- `crates/anima-daemon/src/core.rs` — `CoreService::open`, `status_reply`.
- `docs/design-daemon-client.md` — Slice A/B/D ownership decisions.
