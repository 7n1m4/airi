// SPDX-License-Identifier: GPL-3.0-or-later

//! Amplitude tap: wraps a decoded sample source, computes RMS over fixed windows
//! (~50 ms at the source's own sample rate) and broadcasts `SpeechEvent::Amplitude`.
//!
//! Also owns the Done/Aborted disambiguation: on natural source exhaustion it sets the
//! shared `done` flag and (unless `abort` was set first) emits `SpeechEvent::Done`.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use rodio::{ChannelCount, SampleRate};

use crate::types::SpeechEvent;

/// A boxed source of f32 samples, as expected by rodio sinks.
pub type BoxedSource = Box<dyn rodio::Source<Item = f32> + Send>;

/// RMS window tap. See module docs.
pub struct AmplitudeTap<S> {
    inner: S,
    events: tokio::sync::broadcast::Sender<SpeechEvent>,
    window_samples: usize,
    acc: f32,
    count: usize,
    finished: bool,
    abort: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
}

impl<S: rodio::Source<Item = f32> + Send> AmplitudeTap<S> {
    /// Wrap `inner`. `window_ms` is clamped to ≥ 5 ms. `abort`/`done` are shared with
    /// the pipeline so cancellation and natural completion can be told apart.
    #[must_use]
    pub fn new(
        inner: S,
        events: tokio::sync::broadcast::Sender<SpeechEvent>,
        window_ms: u64,
        abort: Arc<AtomicBool>,
        done: Arc<AtomicBool>,
    ) -> Self {
        let rate = inner.sample_rate().get() as u64;
        let window_samples =
            usize::try_from((rate * window_ms.max(5) / 1000).max(1)).unwrap_or(1024);
        Self {
            inner,
            events,
            window_samples,
            acc: 0.0,
            count: 0,
            finished: false,
            abort,
            done,
        }
    }

    fn flush_window(&mut self) {
        if self.count == 0 {
            return;
        }
        let mean = self.acc / self.count as f32;
        let level = mean.sqrt().min(1.0);
        let _ = self.events.send(SpeechEvent::Amplitude { level });
        self.acc = 0.0;
        self.count = 0;
    }
}

impl<S: rodio::Source<Item = f32> + Send> Iterator for AmplitudeTap<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        match self.inner.next() {
            Some(sample) => {
                if self.abort.load(Ordering::Relaxed) {
                    // Drain without emitting amplitude; Player's stoppable wrapper
                    // will return None soon anyway.
                    return Some(sample);
                }
                self.acc += sample * sample;
                self.count += 1;
                if self.count >= self.window_samples {
                    self.flush_window();
                }
                Some(sample)
            }
            None => {
                if !self.finished {
                    self.flush_window();
                    self.finished = true;
                    self.done.store(true, Ordering::Relaxed);
                    if !self.abort.load(Ordering::Relaxed) {
                        let _ = self.events.send(SpeechEvent::Done {});
                    }
                }
                None
            }
        }
    }
}

impl<S: rodio::Source<Item = f32> + Send> rodio::Source for AmplitudeTap<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }

    fn channels(&self) -> ChannelCount {
        self.inner.channels()
    }

    fn sample_rate(&self) -> SampleRate {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<std::time::Duration> {
        self.inner.total_duration()
    }
}
