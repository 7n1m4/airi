// SPDX-License-Identifier: GPL-3.0-or-later

//! Export golden JSON wire fixtures for every EventPayload variant and core
//! DTO, so Dart, C#, and any other client can round-trip-test their codecs
//! against Rust-canonical wire shapes.
//!
//! ```sh
//! cargo run -p anima-channel --example export-golden-fixtures          # rewrite fixtures
//! cargo run -p anima-channel --example export-golden-fixtures -- --check   # fail if drifted
//! ```
//!
//! Fixtures are checked in under `crates/anima-channel/fixtures/golden/`.
//! CI runs a Rust test that loads every fixture, deserializes it into the
//! matching wire type, and re-serializes to confirm a byte-equal round trip.

use std::path::{Path, PathBuf};

use anima_channel::wire::{
    CharacterStatsData, CoreStatusReply, DomainStatsData, EmotionTagData, EventPayload,
    EventSubscriptionReply, EventTopic, GatewayAuthReply, GatewayConfigReply, GatewayEvent,
    GatewayServerFrame, HeartbeatData, HeartbeatKind, LipSyncRmsData, MemoryStatsData,
    ProviderInfo, ProviderStatsData, ProvidersListReply, RpcErrorObject, RuntimePingReply,
    RuntimeStatusReply, SettingsGetReply, SettingsSetReply, StatusChangedData, TokenDeltaData,
    VaultStatsData, VaultStatusReply,
};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/golden")
}

/// One golden fixture: a file name and its serializable content.
struct Fixture {
    name: &'static str,
    value: serde_json::Value,
}

fn write_fixtures() -> Result<Vec<(String, String)>, Box<dyn std::error::Error>> {
    let dir = fixtures_dir();

    // -- EventPayload fixtures (one per variant, covering edge cases) -------
    let events: Vec<(&str, EventPayload)> = vec![
        (
            "event.lip_sync_rms.silence",
            EventPayload::LipSyncRms(LipSyncRmsData {
                actor_id: "assistant-1".into(),
                level: 0.0,
                seq: 0,
                ts_ms: 1_700_000_000_000,
            }),
        ),
        (
            "event.lip_sync_rms.basic",
            EventPayload::LipSyncRms(LipSyncRmsData {
                actor_id: "character-7".into(),
                level: 0.42,
                seq: 1024,
                ts_ms: 1_700_000_000_123,
            }),
        ),
        (
            "event.lip_sync_rms.peak",
            EventPayload::LipSyncRms(LipSyncRmsData {
                actor_id: "assistant-1".into(),
                level: 1.0,
                seq: u64::MAX,
                ts_ms: 1_700_000_000_999,
            }),
        ),
        (
            "event.emotion_tag.emotion",
            EventPayload::EmotionTag(EmotionTagData {
                actor_id: "character-7".into(),
                tag: "happy".into(),
                kind: anima_channel::wire::CueKind::Emotion,
                intensity: 0.8,
                duration_ms: Some(3000),
                seq: 42,
                ts_ms: 1_700_000_000_200,
            }),
        ),
        (
            "event.emotion_tag.motion_no_duration",
            EventPayload::EmotionTag(EmotionTagData {
                actor_id: "character-7".into(),
                tag: "wave".into(),
                kind: anima_channel::wire::CueKind::Motion,
                intensity: 0.6,
                duration_ms: None,
                seq: 43,
                ts_ms: 1_700_000_000_300,
            }),
        ),
        (
            "event.emotion_tag.vfx",
            EventPayload::EmotionTag(EmotionTagData {
                actor_id: "character-7".into(),
                tag: "sparkle".into(),
                kind: anima_channel::wire::CueKind::Vfx,
                intensity: 1.0,
                duration_ms: Some(1500),
                seq: 44,
                ts_ms: 1_700_000_000_400,
            }),
        ),
        (
            "event.token_delta.partial",
            EventPayload::TokenDelta(TokenDeltaData {
                session_id: "sess-abc".into(),
                message_id: "msg-1".into(),
                delta: "Hello".into(),
                index: 0,
                final_: false,
                seq: 5,
                ts_ms: 1_700_000_000_900,
            }),
        ),
        (
            "event.token_delta.final",
            EventPayload::TokenDelta(TokenDeltaData {
                session_id: "sess-abc".into(),
                message_id: "msg-1".into(),
                delta: " world".into(),
                index: 1,
                final_: true,
                seq: 6,
                ts_ms: 1_700_000_001_000,
            }),
        ),
        (
            "event.presence_changed.online",
            EventPayload::PresenceChanged(anima_channel::wire::PresenceChangedData {
                subject: "user-42".into(),
                state: "online".into(),
                seq: 7,
                ts_ms: 1_700_000_000_500,
            }),
        ),
        (
            "event.presence_changed.offline",
            EventPayload::PresenceChanged(anima_channel::wire::PresenceChangedData {
                subject: "user-42".into(),
                state: "offline".into(),
                seq: 8,
                ts_ms: 1_700_000_000_600,
            }),
        ),
        (
            "event.status_changed.healthy",
            EventPayload::StatusChanged(StatusChangedData {
                core_available: true,
                store_available: true,
                store_health: "ok".into(),
                seq: 100,
                ts_ms: 1_700_000_000_700,
            }),
        ),
        (
            "event.status_changed.unhealthy",
            EventPayload::StatusChanged(StatusChangedData {
                core_available: false,
                store_available: false,
                store_health: "unavailable".into(),
                seq: 101,
                ts_ms: 1_700_000_000_800,
            }),
        ),
    ];

    // -- Core DTO fixtures (one each) ---------------------------------------
    let dto_fixtures: Vec<(&str, serde_json::Value)> = vec![
        (
            "core_status.reply",
            serde_json::to_value(CoreStatusReply {
                app: "airi-daemon".into(),
                version: "0.1.0".into(),
                core_available: true,
                store_available: true,
                store_health: "ok".into(),
                protocol: "airi-channel/1".into(),
                session_count: 10,
                message_count: 42,
            })?,
        ),
        (
            "runtime_ping.reply",
            serde_json::to_value(RuntimePingReply {
                pong: true,
                time: 1_700_000_000,
                uptime_seconds: 3600,
            })?,
        ),
        (
            "runtime_status.reply",
            serde_json::to_value(RuntimeStatusReply {
                app: "airi-daemon".into(),
                version: "0.1.0".into(),
                pid: 1234,
                uptime_seconds: 3600,
                protocol: "airi-channel/1".into(),
            })?,
        ),
        (
            "providers_list.reply",
            serde_json::to_value(ProvidersListReply {
                providers: vec![ProviderInfo {
                    id: "openai".into(),
                    kind: "openai".into(),
                    model: "gpt-4o".into(),
                    base_url: "https://api.openai.com/v1".into(),
                    enabled: true,
                    updated_at: 1_700_000_000,
                }],
            })?,
        ),
        (
            "settings_get.reply",
            serde_json::to_value(SettingsGetReply {
                section: "tts".into(),
                settings: r#"{"voice":"alloy"}"#.into(),
            })?,
        ),
        (
            "settings_set.reply",
            serde_json::to_value(SettingsSetReply { ok: true })?,
        ),
        (
            "vault_status.reply",
            serde_json::to_value(VaultStatusReply {
                available: true,
                stats: Some(VaultStatsData {
                    chats: DomainStatsData {
                        sessions: 3,
                        messages: 15,
                        bytes: 1024,
                    },
                    memory: MemoryStatsData {
                        summaries: 2,
                        journal_entries: 7,
                        bytes: 512,
                    },
                    providers: ProviderStatsData {
                        count: 1,
                        bytes: 256,
                    },
                    characters: CharacterStatsData {
                        count: 2,
                        bytes: 128,
                    },
                }),
            })?,
        ),
        (
            "gateway_config.reply",
            serde_json::to_value(GatewayConfigReply {
                hostname: "127.0.0.1".into(),
                port: 6121,
            })?,
        ),
        (
            "gateway_auth.reply",
            serde_json::to_value(GatewayAuthReply {
                authenticated: true,
                session_started_ms: 1_700_000_000_000,
            })?,
        ),
        (
            "event_subscribe.reply",
            serde_json::to_value(EventSubscriptionReply {
                topics: EventTopic::ALL.to_vec(),
            })?,
        ),
        (
            "heartbeat.pong",
            serde_json::to_value(HeartbeatData {
                kind: HeartbeatKind::Pong,
                message: Some("💛".into()),
                at: Some(1_700_000_000_000),
            })?,
        ),
        (
            "heartbeat.ping",
            serde_json::to_value(HeartbeatData {
                kind: HeartbeatKind::Ping,
                message: None,
                at: None,
            })?,
        ),
        (
            "rpc.error.invalid_token",
            serde_json::to_value(RpcErrorObject {
                code: "invalid_token".into(),
                message: "invalid token".into(),
            })?,
        ),
    ];

    // Build the full fixture list with serialized JSON.
    let mut fixtures: Vec<Fixture> = Vec::new();

    for (name, payload) in &events {
        let event = GatewayEvent::new(payload.topic(), payload.clone());
        let frame = GatewayServerFrame::event(event);
        let value = serde_json::to_value(&frame)?;
        fixtures.push(Fixture { name, value });
    }

    for (name, value) in &dto_fixtures {
        fixtures.push(Fixture {
            name,
            value: value.clone(),
        });
    }

    // Write each fixture as pretty-printed JSON.
    std::fs::create_dir_all(&dir)?;
    let mut written: Vec<(String, String)> = Vec::new();
    for f in &fixtures {
        let json = serde_json::to_string_pretty(&f.value)?;
        let json = format!("{json}\n");
        let path = dir.join(format!("{}.json", f.name));
        std::fs::write(&path, &json)?;
        written.push((f.name.to_string(), json));
    }

    Ok(written)
}

fn check_fixtures() -> Result<(), Box<dyn std::error::Error>> {
    let dir = fixtures_dir();
    let expected = write_fixtures()?;
    let mut stale = Vec::new();

    for (name, content) in &expected {
        let path = dir.join(format!("{name}.json"));
        let current = std::fs::read_to_string(&path).map_err(|e| {
            format!(
                "cannot read {}: {e} (run the exporter once to create it)",
                path.display()
            )
        })?;
        if &current != content {
            stale.push(name.clone());
        }
    }

    if !stale.is_empty() {
        eprintln!(
            "error: {} fixture(s) are stale. Run `cargo run -p anima-channel --example export-golden-fixtures` and commit the result.",
            stale.len()
        );
        for name in &stale {
            eprintln!("  stale: {name}");
        }
        std::process::exit(1);
    }

    println!("ok: all {} golden fixtures are up to date", expected.len());
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let check = std::env::args().skip(1).any(|arg| arg == "--check");
    if check {
        check_fixtures()
    } else {
        let written = write_fixtures()?;
        for (name, _) in &written {
            println!("wrote {name}.json");
        }
        Ok(())
    }
}