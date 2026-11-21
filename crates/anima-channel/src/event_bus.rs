// SPDX-License-Identifier: GPL-3.0-or-later

//! Bounded, thread-safe fan-out for the Wave 0 server→client event lane.
//!
//! `anima-channel` is thread-per-connection with no async runtime
//! ([`crate::server`]), so the bus is deliberately synchronous and lock-based.
//! Producers (today: tests and future daemon services such as the realtime
//! pipeline or chat) only ever push into in-memory queues — publishing never
//! touches a socket and never blocks on a client. The connection thread polls
//! its own lane and writes the drained frames; see the ADR in
//! [`crate::wire`].
//!
//! Two handles:
//!
//! - [`EventBus`] — shared, cloneable publisher handle. One is owned by
//!   [`crate::ChannelServer`] and exposed via `ChannelServer::event_bus()` so
//!   daemon services can publish without knowing anything about sessions.
//! - [`EventLane`] — a per-connection subscriber handle: a bounded FIFO of
//!   pending [`GatewayEvent`]s plus the topic set controlled by the
//!   `event.subscribe` / `event.unsubscribe` RPC actions.

use std::collections::{BTreeSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::wire::{EventTopic, GatewayEvent};

/// Default capacity of one connection's bounded event lane.
///
/// 256 frames is generous for the low-rate control vocabulary and still keeps
/// memory bounded by `connections × 256` even if a producer runs away.
pub const DEFAULT_LANE_CAPACITY: usize = 256;

/// How often a connection thread wakes to drain its event lane when no client
/// frame arrives. Short enough for ~15–40 Hz lip-sync, far below the 75 s
/// dead-peer TTL, which is still measured against inbound `last_seen`.
pub const DEFAULT_EVENT_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Per-connection event lane: subscribed topics plus a bounded FIFO of events.
///
/// Cloning shares the same inner state; each accepted connection gets exactly
/// one fresh lane (created with [`RpcContext::new`](crate::RpcContext::new) /
/// `for_session`), so clones are only for handing the same lane to the session
/// and the connection loop.
#[derive(Clone)]
pub struct EventLane {
    inner: Arc<EventLaneInner>,
}

struct EventLaneInner {
    /// Topics this connection wants; empty by default (no events).
    topics: RwLock<BTreeSet<EventTopic>>,
    /// Pending events, oldest at the front.
    queue: Mutex<VecDeque<GatewayEvent>>,
    /// Maximum buffered events before drop-oldest kicks in.
    capacity: usize,
}

impl EventLane {
    /// Create a lane that buffers at most `capacity` events.
    pub fn new(capacity: usize) -> Self {
        Self {
            inner: Arc::new(EventLaneInner {
                topics: RwLock::new(BTreeSet::new()),
                queue: Mutex::new(VecDeque::with_capacity(capacity)),
                capacity,
            }),
        }
    }

    /// Create a lane with [`DEFAULT_LANE_CAPACITY`].
    pub fn with_defaults() -> Self {
        Self::new(DEFAULT_LANE_CAPACITY)
    }

    /// Add topics to this lane's subscription set (idempotent).
    pub fn subscribe(&self, topics: &[EventTopic]) {
        let mut set = self
            .inner
            .topics
            .write()
            .expect("event topic lock poisoned");
        set.extend(topics.iter().copied());
    }

    /// Remove topics from this lane's subscription set (idempotent).
    pub fn unsubscribe(&self, topics: &[EventTopic]) {
        let mut set = self
            .inner
            .topics
            .write()
            .expect("event topic lock poisoned");
        for topic in topics {
            set.remove(topic);
        }
    }

    /// Snapshot the subscribed topics in wire (enum declaration) order.
    pub fn subscribed_topics(&self) -> Vec<EventTopic> {
        let set = self.inner.topics.read().expect("event topic lock poisoned");
        set.iter().copied().collect()
    }

    /// True when `topic` is currently subscribed.
    pub fn is_subscribed(&self, topic: EventTopic) -> bool {
        self.inner
            .topics
            .read()
            .expect("event topic lock poisoned")
            .contains(&topic)
    }

    /// Drop every buffered event without sending it (used pre-auth and on
    /// fresh authentication).
    pub fn clear(&self) {
        self.inner
            .queue
            .lock()
            .expect("event queue lock poisoned")
            .clear();
    }

    /// Buffer one published event. When full, the oldest event is dropped; a
    /// low-rate control event prefers to evict the oldest high-rate sample so
    /// control traffic survives a burst.
    pub fn enqueue(&self, event: GatewayEvent) {
        self.inner.enqueue_locked(&event);
    }

    /// Take all buffered events in publication order, leaving the lane empty.
    pub fn drain(&self) -> Vec<GatewayEvent> {
        self.inner
            .queue
            .lock()
            .expect("event queue lock poisoned")
            .drain(..)
            .collect()
    }

    /// Number of buffered events (for diagnostics and tests).
    pub fn len(&self) -> usize {
        self.inner
            .queue
            .lock()
            .expect("event queue lock poisoned")
            .len()
    }

    /// True when no events are buffered.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Maximum number of buffered events.
    pub fn capacity(&self) -> usize {
        self.inner.capacity
    }
}

impl std::fmt::Debug for EventLane {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let topics = self.subscribed_topics();
        f.debug_struct("EventLane")
            .field("topics", &topics)
            .field("len", &self.len())
            .field("capacity", &self.capacity())
            .finish_non_exhaustive()
    }
}

/// Shared event bus. Clone this handle to hand the same bus to a daemon
/// service; publishing fans out synchronously to every registered lane whose
/// subscription set contains the event's topic.
#[derive(Clone)]
pub struct EventBus {
    inner: Arc<EventBusInner>,
}

struct EventBusInner {
    /// Weak references so a dropped connection's lane disappears on the next
    /// publish without an explicit deregister call.
    lanes: Mutex<Vec<Weak<EventLaneInner>>>,
    /// Process-wide monotonic sequence stamped into every published payload.
    next_seq: AtomicU64,
    /// Capacity applied to newly created lanes (unused by the bus itself, but
    /// kept so `EventBus::new(capacity)` can size spawned lanes consistently).
    lane_capacity: usize,
}

impl EventBus {
    /// Create a bus whose lanes buffer at most `lane_capacity` events.
    pub fn new(lane_capacity: usize) -> Self {
        Self {
            inner: Arc::new(EventBusInner {
                lanes: Mutex::new(Vec::new()),
                next_seq: AtomicU64::new(0),
                lane_capacity,
            }),
        }
    }

    /// Create a bus with the default lane capacity.
    pub fn with_defaults() -> Self {
        Self::new(DEFAULT_LANE_CAPACITY)
    }

    /// Capacity used for lanes created by this bus.
    pub fn lane_capacity(&self) -> usize {
        self.inner.lane_capacity
    }

    /// Create a fresh lane with this bus's capacity.
    pub fn new_lane(&self) -> EventLane {
        EventLane::new(self.inner.lane_capacity)
    }

    /// Register a connection lane for fan-out. Holding only a `Weak` means a
    /// connection that goes away needs no explicit deregistration.
    pub fn register_lane(&self, lane: &EventLane) {
        let mut lanes = self.inner.lanes.lock().expect("event bus lock poisoned");
        lanes.retain(|existing| existing.upgrade().is_some());
        lanes.push(Arc::downgrade(&lane.inner));
    }

    /// Publish an event to every subscribed lane.
    ///
    /// The bus overwrites the payload's `seq` (monotonic, process-wide) and
    /// `ts_ms` (unix millis) before fan-out, so producers need not stamp them.
    /// Publication holds one lock and only writes in-memory queues; it never
    /// touches a socket or waits on a client.
    pub fn publish(&self, mut event: GatewayEvent) {
        let seq = self.inner.next_seq.fetch_add(1, Ordering::Relaxed);
        event.data.set_seq(seq);
        event.data.set_ts_ms(now_ms());

        let mut lanes = self.inner.lanes.lock().expect("event bus lock poisoned");
        lanes.retain(|weak| weak.upgrade().is_some());
        for weak in lanes.iter() {
            if let Some(inner) = weak.upgrade() {
                let subscribed = inner
                    .topics
                    .read()
                    .expect("event topic lock poisoned")
                    .contains(&event.topic);
                if subscribed {
                    inner.enqueue_locked(&event);
                }
            }
        }
    }

    /// Next sequence number (for diagnostics and tests).
    pub fn next_seq(&self) -> u64 {
        self.inner.next_seq.load(Ordering::Relaxed)
    }

    /// Number of live registered lanes (for diagnostics and tests).
    pub fn subscriber_count(&self) -> usize {
        let mut lanes = self.inner.lanes.lock().expect("event bus lock poisoned");
        lanes.retain(|weak| weak.upgrade().is_some());
        lanes.len()
    }
}

impl std::fmt::Debug for EventBus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EventBus")
            .field("subscribers", &self.subscriber_count())
            .field("next_seq", &self.next_seq())
            .finish_non_exhaustive()
    }
}

impl EventLaneInner {
    /// Single implementation of the bounded enqueue + eviction policy, used
    /// by both the public [`EventLane::enqueue`] and the bus fan-out.
    fn enqueue_locked(&self, event: &GatewayEvent) {
        let mut queue = self.queue.lock().expect("event queue lock poisoned");
        if queue.len() >= self.capacity {
            if event.topic.is_control() {
                if let Some(index) = queue.iter().position(|e| e.topic.is_realtime()) {
                    queue.remove(index);
                } else {
                    queue.pop_front();
                }
            } else {
                queue.pop_front();
            }
        }
        queue.push_back(event.clone());
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::{
        EmotionTagData, EventPayload, EventTopic, GatewayEvent, LipSyncRmsData, PresenceChangedData,
    };

    fn rms(actor: &str, level: f32) -> GatewayEvent {
        GatewayEvent::new(
            EventTopic::LipSyncRms,
            EventPayload::LipSyncRms(LipSyncRmsData {
                actor_id: actor.to_string(),
                level,
                seq: 0,
                ts_ms: 0,
            }),
        )
    }

    fn presence(subject: &str) -> GatewayEvent {
        GatewayEvent::new(
            EventTopic::PresenceChanged,
            EventPayload::PresenceChanged(PresenceChangedData {
                subject: subject.to_string(),
                state: "online".to_string(),
                seq: 0,
                ts_ms: 0,
            }),
        )
    }

    fn lane(capacity: usize, topics: &[EventTopic]) -> EventLane {
        let lane = EventLane::new(capacity);
        lane.subscribe(topics);
        lane
    }

    #[test]
    fn bounded_lane_drops_oldest() {
        let lane = lane(2, &[EventTopic::LipSyncRms]);
        lane.enqueue(rms("a", 0.1));
        lane.enqueue(rms("b", 0.2));
        lane.enqueue(rms("c", 0.3));
        assert_eq!(lane.len(), 2);
        let drained = lane.drain();
        let levels: Vec<f32> = drained
            .iter()
            .map(|e| match &e.data {
                EventPayload::LipSyncRms(d) => d.level,
                _ => unreachable!(),
            })
            .collect();
        assert_eq!(levels, vec![0.2, 0.3], "oldest sample must be dropped");
    }

    #[test]
    fn control_event_prefers_evicting_realtime_sample() {
        let lane = lane(2, &[EventTopic::LipSyncRms, EventTopic::PresenceChanged]);
        lane.enqueue(rms("a", 0.1));
        lane.enqueue(rms("b", 0.2));
        lane.enqueue(presence("p"));
        let drained = lane.drain();
        assert_eq!(drained.len(), 2);
        assert!(drained
            .iter()
            .any(|e| e.topic == EventTopic::PresenceChanged));
        assert!(drained
            .iter()
            .any(|e| matches!(&e.data, EventPayload::LipSyncRms(d) if d.level == 0.2)));
    }

    #[test]
    fn bus_fans_out_only_to_subscribed_lanes() {
        let bus = EventBus::with_defaults();
        let lip = bus.new_lane();
        lip.subscribe(&[EventTopic::LipSyncRms]);
        let presence_lane = bus.new_lane();
        presence_lane.subscribe(&[EventTopic::PresenceChanged]);
        bus.register_lane(&lip);
        bus.register_lane(&presence_lane);
        assert_eq!(bus.subscriber_count(), 2);

        bus.publish(rms("a", 0.5));
        assert_eq!(lip.len(), 1);
        assert!(
            presence_lane.is_empty(),
            "unsubscribed lane must receive nothing"
        );
    }

    #[test]
    fn bus_stamps_monotonic_seq_and_timestamp() {
        let bus = EventBus::with_defaults();
        let lane = bus.new_lane();
        lane.subscribe(EventTopic::ALL);
        bus.register_lane(&lane);
        bus.publish(rms("a", 0.1));
        bus.publish(GatewayEvent::new(
            EventTopic::EmotionTag,
            EventPayload::EmotionTag(EmotionTagData {
                actor_id: "a".to_string(),
                tag: "calm".to_string(),
                kind: crate::wire::CueKind::Emotion,
                intensity: 0.4,
                duration_ms: None,
                seq: 99,
                ts_ms: 1,
            }),
        ));
        let drained = lane.drain();
        let seqs: Vec<u64> = drained
            .iter()
            .map(|e| match &e.data {
                EventPayload::LipSyncRms(d) => d.seq,
                EventPayload::EmotionTag(d) => d.seq,
                _ => unreachable!(),
            })
            .collect();
        assert_eq!(seqs, vec![0, 1]);
        assert!(drained.iter().all(|e| e.data.topic() == e.topic));
        let ts: Vec<u64> = drained
            .iter()
            .map(|e| match &e.data {
                EventPayload::LipSyncRms(d) => d.ts_ms,
                EventPayload::EmotionTag(d) => d.ts_ms,
                _ => unreachable!(),
            })
            .collect();
        assert!(
            ts.iter().all(|t| *t > 0),
            "bus must stamp a unix millisecond ts"
        );
    }

    #[test]
    fn dropped_lanes_are_pruned_from_bus() {
        let bus = EventBus::with_defaults();
        {
            let lane = bus.new_lane();
            bus.register_lane(&lane);
            assert_eq!(bus.subscriber_count(), 1);
        }
        assert_eq!(bus.subscriber_count(), 0);
    }
}
