// SPDX-License-Identifier: GPL-3.0-or-later

//! Rust conformance test: every golden fixture under
//! `fixtures/golden/` must deserialize into its wire type and
//! re-serialize to a byte-equal JSON value.
//!
//! This is the Rust leg of the three-job conformance CI
//! (airi-wxp.2.8). The Dart and C# legs run the same fixtures
//! through their own codecs.
//!
//! ```sh
//! cargo test -p anima-channel --locked golden_fixtures
//! ```

#[cfg(test)]
mod golden_fixtures {
    use anima_channel::wire::{
        CoreStatusReply, EmotionTagData, EventPayload, EventSubscriptionReply, GatewayAuthReply,
        GatewayConfigReply, GatewayEvent, GatewayServerFrame, HeartbeatData, ProvidersListReply,
        RpcErrorObject, RuntimePingReply, RuntimeStatusReply, SettingsGetReply, SettingsSetReply,
        VaultStatusReply,
    };
    use serde::de::DeserializeOwned;
    use serde::Serialize;
    use std::path::{Path, PathBuf};

    fn fixtures_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/golden")
    }

    /// Load a fixture file as pretty JSON text and parse it.
    fn load_json(name: &str) -> serde_json::Value {
        let path = fixtures_dir().join(format!("{name}.json"));
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("invalid JSON in {}: {e}", path.display()))
    }

    /// Round-trip helper: deserialize `value` into `T`, re-serialize, and
    /// assert both directions are byte-equal to the original.
    fn round_trip<T>(name: &str, value: &serde_json::Value)
    where
        T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug,
    {
        let decoded: T = serde_json::from_value(value.clone())
            .unwrap_or_else(|e| panic!("{name}: deserialize failed: {e}"));
        let re_encoded = serde_json::to_value(&decoded)
            .unwrap_or_else(|e| panic!("{name}: serialize failed: {e}"));
        assert_eq!(
            value, &re_encoded,
            "{name}: round-trip mismatch\n  expected: {value}\n  got: {re_encoded}"
        );
    }

    // ----------------------------------------------------------------
    // Event frame fixtures (wrapped in GatewayServerFrame::Event)
    // ----------------------------------------------------------------

    #[test]
    fn event_lip_sync_rms_fixtures() {
        for name in &[
            "event.lip_sync_rms.silence",
            "event.lip_sync_rms.basic",
            "event.lip_sync_rms.peak",
        ] {
            let value = load_json(name);
            round_trip::<GatewayServerFrame>(name, &value);
        }
    }

    #[test]
    fn event_emotion_tag_fixtures() {
        for name in &[
            "event.emotion_tag.emotion",
            "event.emotion_tag.motion_no_duration",
            "event.emotion_tag.vfx",
        ] {
            let value = load_json(name);
            round_trip::<GatewayServerFrame>(name, &value);
        }
    }

    #[test]
    fn event_token_delta_fixtures() {
        for name in &["event.token_delta.partial", "event.token_delta.final"] {
            let value = load_json(name);
            round_trip::<GatewayServerFrame>(name, &value);
        }
    }

    #[test]
    fn event_presence_changed_fixtures() {
        for name in &["event.presence_changed.online", "event.presence_changed.offline"] {
            let value = load_json(name);
            round_trip::<GatewayServerFrame>(name, &value);
        }
    }

    #[test]
    fn event_status_changed_fixtures() {
        for name in &["event.status_changed.healthy", "event.status_changed.unhealthy"] {
            let value = load_json(name);
            round_trip::<GatewayServerFrame>(name, &value);
        }
    }

    // ----------------------------------------------------------------
    // Core DTO fixtures (standalone JSON objects)
    // ----------------------------------------------------------------

    #[test]
    fn core_status_reply_fixture() {
        let value = load_json("core_status.reply");
        round_trip::<CoreStatusReply>("core_status.reply", &value);
    }

    #[test]
    fn runtime_ping_reply_fixture() {
        let value = load_json("runtime_ping.reply");
        round_trip::<RuntimePingReply>("runtime_ping.reply", &value);
    }

    #[test]
    fn runtime_status_reply_fixture() {
        let value = load_json("runtime_status.reply");
        round_trip::<RuntimeStatusReply>("runtime_status.reply", &value);
    }

    #[test]
    fn providers_list_reply_fixture() {
        let value = load_json("providers_list.reply");
        round_trip::<ProvidersListReply>("providers_list.reply", &value);
    }

    #[test]
    fn settings_get_reply_fixture() {
        let value = load_json("settings_get.reply");
        round_trip::<SettingsGetReply>("settings_get.reply", &value);
    }

    #[test]
    fn settings_set_reply_fixture() {
        let value = load_json("settings_set.reply");
        round_trip::<SettingsSetReply>("settings_set.reply", &value);
    }

    #[test]
    fn vault_status_reply_fixture() {
        let value = load_json("vault_status.reply");
        round_trip::<VaultStatusReply>("vault_status.reply", &value);
    }

    #[test]
    fn gateway_config_reply_fixture() {
        let value = load_json("gateway_config.reply");
        round_trip::<GatewayConfigReply>("gateway_config.reply", &value);
    }

    #[test]
    fn gateway_auth_reply_fixture() {
        let value = load_json("gateway_auth.reply");
        round_trip::<GatewayAuthReply>("gateway_auth.reply", &value);
    }

    #[test]
    fn event_subscribe_reply_fixture() {
        let value = load_json("event_subscribe.reply");
        round_trip::<EventSubscriptionReply>("event_subscribe.reply", &value);
    }

    #[test]
    fn heartbeat_pong_fixture() {
        let value = load_json("heartbeat.pong");
        round_trip::<HeartbeatData>("heartbeat.pong", &value);
    }

    #[test]
    fn heartbeat_ping_fixture() {
        let value = load_json("heartbeat.ping");
        round_trip::<HeartbeatData>("heartbeat.ping", &value);
    }

    #[test]
    fn rpc_error_fixture() {
        let value = load_json("rpc.error.invalid_token");
        round_trip::<RpcErrorObject>("rpc.error.invalid_token", &value);
    }

    // ----------------------------------------------------------------
    // Cross-cutting: every fixture file must be valid JSON
    // ----------------------------------------------------------------

    #[test]
    fn every_golden_fixture_is_valid_json() {
        let dir = fixtures_dir();
        let entries: Vec<_> = std::fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "json"))
            .collect();
        assert!(!entries.is_empty(), "no golden fixtures found");
        for entry in &entries {
            let path = entry.path();
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
            let value: serde_json::Value = serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("invalid JSON in {}: {e}", path.display()));
            assert!(
                value.is_object(),
                "{}: expected JSON object, got {}",
                path.display(),
                value
            );
        }
    }
}