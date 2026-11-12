// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! Session export helpers.
//!
//! JSON Lines (JSONL) export of a session and its messages. Pure string
//! construction: no file or network I/O (callers decide where the payload
//! goes).

use airi_store::{Database, MessageRepo, SessionRepo};
use anyhow::{Context, Result};

/// Export a session and its messages as JSON Lines.
///
/// Line 1 is a session header, subsequent lines are messages in
/// chronological order:
///
/// ```json
/// {"type":"session","session":{...}}
/// {"type":"message","message":{...}}
/// ```
///
/// Each line is a self-contained JSON object; trailing newline included.
/// Errors when the session does not exist.
pub fn export_jsonl(db: &Database, session_id: &str) -> Result<String> {
    let session = SessionRepo::new(db.clone())
        .get(session_id)?
        .with_context(|| format!("session not found: {session_id}"))?;
    let messages = MessageRepo::new(db.clone()).list(session_id)?;

    let mut out = String::new();
    let header = serde_json::json!({ "type": "session", "session": session });
    out.push_str(&serde_json::to_string(&header)?);
    out.push('\n');
    for message in messages {
        let line = serde_json::json!({ "type": "message", "message": message });
        out.push_str(&serde_json::to_string(&line)?);
        out.push('\n');
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn export_jsonl_emits_session_header_then_messages() {
        let dir = tempdir().expect("tempdir");
        let db = Database::open(&dir.path().join("export.sqlite")).expect("open db");
        let sessions = SessionRepo::new(db.clone());
        sessions.create("s1", "Export me").expect("create session");
        let messages = MessageRepo::new(db.clone());
        messages
            .insert(&airi_store::StoredMessage {
                id: "m1".to_string(),
                session_id: "s1".to_string(),
                role: "user".to_string(),
                content: "hello".to_string(),
                created_at: 10,
                metadata: serde_json::json!({}),
            })
            .expect("insert m1");
        messages
            .insert(&airi_store::StoredMessage {
                id: "m2".to_string(),
                session_id: "s1".to_string(),
                role: "assistant".to_string(),
                content: "hi there".to_string(),
                created_at: 20,
                metadata: serde_json::json!({"finishReason": "stop"}),
            })
            .expect("insert m2");

        let jsonl = export_jsonl(&db, "s1").expect("export");
        let lines: Vec<&str> = jsonl.lines().collect();
        assert_eq!(lines.len(), 3);

        let header: serde_json::Value = serde_json::from_str(lines[0]).expect("header parses");
        assert_eq!(header["type"], "session");
        assert_eq!(header["session"]["id"], "s1");
        assert_eq!(header["session"]["title"], "Export me");

        let first: serde_json::Value = serde_json::from_str(lines[1]).expect("message parses");
        assert_eq!(first["type"], "message");
        assert_eq!(first["message"]["role"], "user");
        assert_eq!(first["message"]["content"], "hello");

        let second: serde_json::Value = serde_json::from_str(lines[2]).expect("message parses");
        assert_eq!(second["message"]["role"], "assistant");
        assert_eq!(second["message"]["id"], "m2");

        assert!(jsonl.ends_with('\n'));
    }

    #[test]
    fn export_jsonl_errors_for_missing_session() {
        let dir = tempdir().expect("tempdir");
        let db = Database::open(&dir.path().join("export.sqlite")).expect("open db");
        let err = export_jsonl(&db, "nope").expect_err("missing session must error");
        assert!(format!("{err:#}").contains("nope"));
    }
}
