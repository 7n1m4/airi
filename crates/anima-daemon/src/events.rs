// SPDX-License-Identifier: GPL-3.0-or-later

//! Daemon-side façade over the `anima-channel` Wave 0 event bus.
//!
//! Every daemon service publishes through [`EventPublisher`] instead of
//! importing channel wire types directly. The wrapper builds the typed
//! payloads (with `seq`/`ts_ms` left at `0` — [`EventBus::publish`] stamps the
//! process-wide monotonic sequence and unix-millisecond timestamp) and fans
//! out to subscribed connection lanes. Publishing never touches a socket.
//!
//! One publisher is owned by [`crate::gateway::Gateway`] and cloned into each
//! bind and each D-Bus handler, so every clone shares the same bus and the
//! same coarse-health dedupe state. This is what keeps rebinds from emitting
//! stale events and stops `core.status` RPCs from echoing an unchanged health
//! snapshot as a fresh "change".

use std::sync::{Arc, Mutex};

use anima_channel::{ChannelServer, EventBus, EventPayload, EventTopic, GatewayEvent};
use serde_json::Value;

/// Broad class of an `emotion.tag` cue, mirrored from the channel wire
/// vocabulary so a future audio/expression service never imports
/// `anima_channel::CueKind` (or any channel type) to publish a cue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonCueKind {
    /// Facial expression / emotion key.
    Emotion,
    /// Body motion — must not be dispatched to a facial morph.
    Motion,
    /// Visual effect — must not be dispatched to a facial morph.
    Vfx,
}

impl From<DaemonCueKind> for anima_channel::CueKind {
    fn from(value: DaemonCueKind) -> Self {
        match value {
            DaemonCueKind::Emotion => Self::Emotion,
            DaemonCueKind::Motion => Self::Motion,
            DaemonCueKind::Vfx => Self::Vfx,
        }
    }
}

/// Last published coarse-health snapshot: `(core_available, store_available,
/// store_health)`. Compared by value so a repeated, unchanged health reading
/// is not reported as a new `status.changed` event.
type StatusKey = (bool, bool, String);

/// Cloneable publisher handle shared by all daemon services.
///
/// Clones share both the underlying [`EventBus`] and the dedupe state (via
/// `Arc`), so publishing from one clone is visible to every subscriber lane
/// registered on the server's bus.
#[derive(Clone)]
pub struct EventPublisher {
    bus: EventBus,
    last_status: Arc<Mutex<Option<StatusKey>>>,
}

impl std::fmt::Debug for EventPublisher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EventPublisher")
            .field("subscribers", &self.bus.subscriber_count())
            .field("last_status", &self.last_status)
            .finish_non_exhaustive()
    }
}

impl EventPublisher {
    /// Wrap an externally owned bus.
    pub fn new(bus: EventBus) -> Self {
        Self {
            bus,
            last_status: Arc::new(Mutex::new(None)),
        }
    }

    /// Build a publisher over the bus a `ChannelServer` is configured with.
    /// Prefer this when a server already owns the bus; the gateway owns the
    /// canonical bus and injects it into every bind, so both handles agree.
    pub fn from_server(server: &ChannelServer) -> Self {
        Self::new(server.event_bus())
    }

    /// Borrow the underlying bus (for diagnostics and server injection).
    pub fn bus(&self) -> &EventBus {
        &self.bus
    }

    /// Coarse count of live subscriber lanes (no per-topic query exists).
    pub fn subscriber_count(&self) -> usize {
        self.bus.subscriber_count()
    }

    fn publish(&self, topic: EventTopic, data: EventPayload, id: Option<Value>) {
        let event = GatewayEvent::new(topic, data);
        let event = match id {
            Some(id) => event.with_id(id),
            None => event,
        };
        self.bus.publish(event);
    }

    /// Publish a coarse, secret-free core-health snapshot.
    ///
    /// Returns `true` when the snapshot was actually published and `false`
    /// when it matched the last published value (a misleading repeat). The
    /// payload mirrors `CoreStatusReply`: no tokens, paths, prompts or config.
    pub fn status_changed(
        &self,
        core_available: bool,
        store_available: bool,
        store_health: impl Into<String>,
        id: Option<Value>,
    ) -> bool {
        let store_health = store_health.into();
        let key: StatusKey = (core_available, store_available, store_health.clone());
        {
            let mut last = self
                .last_status
                .lock()
                .expect("event publisher status lock poisoned");
            if last.as_ref() == Some(&key) {
                return false;
            }
            *last = Some(key);
        }
        self.publish(
            EventTopic::StatusChanged,
            EventPayload::StatusChanged(anima_channel::StatusChangedData {
                core_available,
                store_available,
                store_health,
                seq: 0,
                ts_ms: 0,
            }),
            id,
        );
        true
    }

    /// Publish a connectivity/availability transition for `subject`.
    pub fn presence_changed(
        &self,
        subject: impl Into<String>,
        state: impl Into<String>,
        id: Option<Value>,
    ) {
        self.publish(
            EventTopic::PresenceChanged,
            EventPayload::PresenceChanged(anima_channel::PresenceChangedData {
                subject: subject.into(),
                state: state.into(),
                seq: 0,
                ts_ms: 0,
            }),
            id,
        );
    }

    /// Publish one streamed chat token. No daemon chat service exists yet;
    /// this wrapper is the integration seam for a future async pump.
    pub fn token_delta(
        &self,
        session_id: impl Into<String>,
        message_id: impl Into<String>,
        delta: impl Into<String>,
        index: u64,
        final_: bool,
        id: Option<Value>,
    ) {
        self.publish(
            EventTopic::TokenDelta,
            EventPayload::TokenDelta(anima_channel::TokenDeltaData {
                session_id: session_id.into(),
                message_id: message_id.into(),
                delta: delta.into(),
                index,
                final_,
                seq: 0,
                ts_ms: 0,
            }),
            id,
        );
    }

    /// Publish one discrete expression cue for an actor.
    pub fn emotion_tag(
        &self,
        actor_id: impl Into<String>,
        tag: impl Into<String>,
        kind: DaemonCueKind,
        intensity: f32,
        duration_ms: Option<u64>,
        id: Option<Value>,
    ) {
        self.publish(
            EventTopic::EmotionTag,
            EventPayload::EmotionTag(anima_channel::EmotionTagData {
                actor_id: actor_id.into(),
                tag: tag.into(),
                kind: kind.into(),
                intensity,
                duration_ms,
                seq: 0,
                ts_ms: 0,
            }),
            id,
        );
    }

    /// Publish one lip-sync RMS sample for an actor.
    pub fn lip_sync_rms(&self, actor_id: impl Into<String>, level: f32, id: Option<Value>) {
        self.publish(
            EventTopic::LipSyncRms,
            EventPayload::LipSyncRms(anima_channel::LipSyncRmsData {
                actor_id: actor_id.into(),
                level,
                seq: 0,
                ts_ms: 0,
            }),
            id,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anima_channel::EventLane;

    fn subscribed_publisher() -> (EventPublisher, EventLane) {
        let bus = EventBus::with_defaults();
        let lane = bus.new_lane();
        lane.subscribe(EventTopic::ALL);
        bus.register_lane(&lane);
        (EventPublisher::new(bus), lane)
    }

    #[test]
    fn status_changed_maps_fields_bus_stamps_seq_ts_and_has_no_secrets() {
        let (publisher, lane) = subscribed_publisher();
        assert!(publisher.status_changed(true, true, "ok", None));
        assert_eq!(publisher.subscriber_count(), 1);

        let drained = lane.drain();
        assert_eq!(drained.len(), 1);
        let event = &drained[0];
        assert_eq!(event.topic, EventTopic::StatusChanged);
        assert!(event.id.is_none());
        let EventPayload::StatusChanged(data) = &event.data else {
            panic!("expected StatusChanged payload, got {:?}", event.data);
        };
        assert!(data.core_available);
        assert!(data.store_available);
        assert_eq!(data.store_health, "ok");
        assert_eq!(data.seq, 0, "first event starts at sequence zero");
        assert!(data.ts_ms > 0, "bus must stamp a unix-millisecond ts");

        let obj = serde_json::to_value(&event.data).unwrap();
        let obj = obj.as_object().unwrap();
        for forbidden in [
            "authToken",
            "auth_token",
            "dbusToken",
            "apiKey",
            "api_key",
            "secret",
            "prompt",
            "config",
            "token",
            "path",
        ] {
            assert!(!obj.contains_key(forbidden), "forbidden field: {forbidden}");
        }
    }

    #[test]
    fn status_changed_dedupes_until_the_snapshot_changes() {
        let (publisher, lane) = subscribed_publisher();
        assert!(publisher.status_changed(true, true, "ok", None));
        assert!(
            !publisher.status_changed(true, true, "ok", None),
            "unchanged health must not be re-emitted"
        );
        assert_eq!(lane.len(), 1);

        assert!(publisher.status_changed(false, false, "unavailable", None));
        let drained = lane.drain();
        assert_eq!(drained.len(), 2);
        let EventPayload::StatusChanged(data) = &drained[1].data else {
            panic!("expected StatusChanged payload");
        };
        assert!(!data.core_available);
        assert_eq!(data.store_health, "unavailable");
        assert_eq!(data.seq, 1, "sequence advances across distinct events");
    }

    #[test]
    fn presence_changed_maps_subject_and_state_with_correlation_id() {
        let (publisher, lane) = subscribed_publisher();
        let id = serde_json::json!({ "turn": 7 });
        publisher.presence_changed("gateway", "online", Some(id.clone()));
        let drained = lane.drain();
        assert_eq!(drained.len(), 1);
        let event = &drained[0];
        assert_eq!(event.topic, EventTopic::PresenceChanged);
        assert_eq!(event.id, Some(id));
        let EventPayload::PresenceChanged(data) = &event.data else {
            panic!("expected PresenceChanged payload");
        };
        assert_eq!(data.subject, "gateway");
        assert_eq!(data.state, "online");
        assert_eq!(data.seq, 0);
        assert!(data.ts_ms > 0);
    }

    #[test]
    fn token_delta_emotion_tag_and_lip_sync_rms_map_to_their_topics() {
        let (publisher, lane) = subscribed_publisher();
        publisher.token_delta("session", "message", "hi", 2, true, None);
        publisher.emotion_tag(
            "actor",
            "happy",
            DaemonCueKind::Motion,
            0.5,
            Some(120),
            None,
        );
        publisher.lip_sync_rms("actor", 0.25, None);

        let drained = lane.drain();
        assert_eq!(drained.len(), 3);
        assert_eq!(drained[0].topic, EventTopic::TokenDelta);
        let EventPayload::TokenDelta(token) = &drained[0].data else {
            panic!("expected TokenDelta");
        };
        assert_eq!(token.session_id, "session");
        assert_eq!(token.message_id, "message");
        assert_eq!(token.delta, "hi");
        assert_eq!(token.index, 2);
        assert!(token.final_);
        let obj = serde_json::to_value(&drained[0].data).unwrap();
        assert_eq!(obj["final"], true, "wire name is `final`");

        assert_eq!(drained[1].topic, EventTopic::EmotionTag);
        let EventPayload::EmotionTag(tag) = &drained[1].data else {
            panic!("expected EmotionTag");
        };
        assert_eq!(tag.actor_id, "actor");
        assert_eq!(tag.tag, "happy");
        assert_eq!(tag.kind, anima_channel::CueKind::Motion);
        assert_eq!(tag.intensity, 0.5);
        assert_eq!(tag.duration_ms, Some(120));

        assert_eq!(drained[2].topic, EventTopic::LipSyncRms);
        let EventPayload::LipSyncRms(rms) = &drained[2].data else {
            panic!("expected LipSyncRms");
        };
        assert_eq!(rms.actor_id, "actor");
        assert_eq!(rms.level, 0.25);

        for (i, event) in drained.iter().enumerate() {
            assert_eq!(event.data.topic(), event.topic);
            let (seq, ts_ms) = match &event.data {
                EventPayload::TokenDelta(d) => (d.seq, d.ts_ms),
                EventPayload::EmotionTag(d) => (d.seq, d.ts_ms),
                EventPayload::LipSyncRms(d) => (d.seq, d.ts_ms),
                EventPayload::PresenceChanged(d) => (d.seq, d.ts_ms),
                EventPayload::StatusChanged(d) => (d.seq, d.ts_ms),
            };
            assert_eq!(seq, i as u64);
            assert!(ts_ms > 0);
        }
    }

    #[test]
    fn from_server_publishes_onto_the_servers_bus() {
        let config = anima_channel::ChannelConfig::healed();
        let server = anima_channel::ChannelServer::bind("127.0.0.1", 0, &config).unwrap();
        let publisher = EventPublisher::from_server(&server);
        let lane = server.event_bus().new_lane();
        lane.subscribe(EventTopic::ALL);
        server.event_bus().register_lane(&lane);

        publisher.presence_changed("screen", "offline", None);
        let drained = lane.drain();
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].topic, EventTopic::PresenceChanged);
    }

    #[test]
    fn all_cue_kinds_map_without_importing_wire_types_at_call_sites() {
        assert_eq!(
            anima_channel::CueKind::from(DaemonCueKind::Emotion),
            anima_channel::CueKind::Emotion
        );
        assert_eq!(
            anima_channel::CueKind::from(DaemonCueKind::Motion),
            anima_channel::CueKind::Motion
        );
        assert_eq!(
            anima_channel::CueKind::from(DaemonCueKind::Vfx),
            anima_channel::CueKind::Vfx
        );
    }
}
