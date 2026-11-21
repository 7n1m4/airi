// SPDX-License-Identifier: GPL-3.0-or-later
//! In-memory awareness ring. Cap 200 (spec §F rail: memory-only metadata
//! verbs), oldest evicted first. Never persisted; lockdown purges via
//! `Ring::clear`.

use std::collections::VecDeque;

pub const RING_CAP: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RingEvent {
    pub ts_ms: u64,
    pub source: String,
    pub event: String,
}

pub struct Ring {
    cap: usize,
    events: VecDeque<RingEvent>,
}

impl Ring {
    pub fn new(cap: usize) -> Self {
        Ring {
            cap: cap.max(1),
            events: VecDeque::with_capacity(cap.min(RING_CAP)),
        }
    }

    pub fn with_default_cap() -> Self {
        Self::new(RING_CAP)
    }

    /// Push one event; evicts the oldest when full.
    pub fn push(&mut self, event: RingEvent) {
        while self.events.len() >= self.cap {
            self.events.pop_front();
        }
        self.events.push_back(event);
    }

    pub fn len(&self) -> u64 {
        self.events.len() as u64
    }

    pub fn clear(&mut self) {
        self.events.clear();
    }

    #[cfg(test)]
    pub fn events(&self) -> Vec<RingEvent> {
        self.events.iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(ts_ms: u64, source: &str, event: &str) -> RingEvent {
        RingEvent {
            ts_ms,
            source: source.to_string(),
            event: event.to_string(),
        }
    }

    #[test]
    fn cap_eviction_evicts_oldest_first() {
        let mut r = Ring::new(3);
        for i in 0..5 {
            r.push(ev(i, "media", &format!("media: {i}")));
        }
        let got = r.events();
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].event, "media: 2");
        assert_eq!(got[1].event, "media: 3");
        assert_eq!(got[2].event, "media: 4");
    }

    #[test]
    fn count_and_clear() {
        let mut r = Ring::with_default_cap();
        assert_eq!(r.len(), 0);
        for i in 0..201 {
            r.push(ev(i, "power", "power: on AC"));
        }
        assert_eq!(r.len(), 200);
        assert_eq!(r.events()[0].ts_ms, 1); // 0 was evicted
        r.clear();
        assert_eq!(r.len(), 0);
    }

    #[test]
    fn order_is_fifo() {
        let mut r = Ring::new(10);
        r.push(ev(1, "network", "network: online"));
        r.push(ev(2, "sleep", "sleep: suspending"));
        let got = r.events();
        assert_eq!(got[0].ts_ms, 1);
        assert_eq!(got[1].ts_ms, 2);
    }
}
