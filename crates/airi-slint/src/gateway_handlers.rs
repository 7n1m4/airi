// SPDX-License-Identifier: GPL-3.0-or-later
//! Read-only `renderer.*` RPC handlers exposed by the `--gateway` channel server.
//!
//! These run on channel connection threads, never on the UI thread. They take
//! plain JSON and return plain JSON. Only
//! read-only, aggregate app state is exposed: chat session/message counts,
//! memory summary count, journal entry count, and enabled provider count.
//! Chat content, session titles, file paths, and credentials are never
//! returned. Every query goes through the shared store connection under its
//! mutex (see `Database::with_connection`).
//!
//! Beyond the read-only `renderer.info`, this also registers the three
//! typed, opt-in GUI verbs from `bridges::gateway_pump` (`renderer.notify`,
//! `renderer.window.raise`, `renderer.stage.visibility`). Those route through
//! the `GatewayPumpController` dispatch core and are refused with
//! `rpc_actions_disabled` unless `"allowActions": true` is set in
//! `<profile>/server-channel/config.json`. Registration itself is
//! unconditional: the dispatch core enforces the flag at request time, so
//! flipping the config works without an app restart.

use airi_store::Database;
use serde_json::json;

/// Build the registry to pass to
/// `airi_channel::ChannelServer::bind_with_renderer`.
///
/// The returned map is consumed by the gateway at bind time; handlers own a
/// clone of the store handle.
pub fn build(db: Database) -> airi_channel::RendererHandlers {
    let mut map = std::collections::HashMap::new();

    let info_handler: Box<airi_channel::RendererHandler> = Box::new(
        move |_method: &str, _payload: &serde_json::Value| -> Result<serde_json::Value, String> {
            db.with_connection(|conn| {
                let count = |sql: &str| -> Result<i64, anyhow::Error> {
                    Ok(conn.query_row(sql, [], |row| row.get::<_, i64>(0))?)
                };
                Ok(json!({
                    "app": "airi-slint",
                    "version": env!("CARGO_PKG_VERSION"),
                    "sessions": count("select count(*) from sessions")?,
                    "messages": count("select count(*) from messages")?,
                    "summaries": count("select count(*) from summaries")?,
                    "journalEntries": count("select count(*) from journal_entries")?,
                    "providersEnabled": count("select count(*) from providers where enabled = 1")?,
                }))
            })
            .map_err(|e| format!("renderer.info failed: {e}"))
        },
    );
    map.insert("info".to_string(), info_handler);

    // GUI-dispatch verbs (opt-in via `allowActions` in server-channel/
    // config.json; enforced at request time by `gateway_pump::dispatch_request`,
    // which parks the connection thread until the UI-thread pump completes
    // the action — or times out after 2 s).
    for verb in ["notify", "window.raise", "stage.visibility"] {
        map.insert(
            verb.to_string(),
            Box::new(
                move |method: &str,
                      payload: &serde_json::Value|
                      -> Result<serde_json::Value, String> {
                    crate::bridges::gateway_pump::dispatch_request(
                        &format!("renderer.{method}"),
                        payload,
                    )
                },
            ),
        );
    }

    map
}
