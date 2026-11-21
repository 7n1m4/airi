// SPDX-License-Identifier: GPL-3.0-or-later

//! Playback sinks.
//!
//! - [`SpeechSinkFactory`]: the injection point. Production uses [`RodioSinkFactory`];
//!   tests use [`CaptureSinkFactory`] to drain samples into memory.
//! - [`RodioSinkFactory`]: rodio-backed output on a dedicated OS thread (cpal streams
//!   never leave that thread). A named output device is matched by description
//!   (case-insensitive exact → substring); otherwise the system default is used and a
//!   warning is logged.
//! - [`list_output_devices`]: names of all output devices cpal can see.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use rodio::cpal::traits::{DeviceTrait, HostTrait};

use crate::error::SpeechError;
use crate::tap::BoxedSource;

/// Sink factory abstraction for dependency injection.
pub trait SpeechSinkFactory: Send + Sync {
    /// Start playback of `source`. Replaces any currently-playing source.
    ///
    /// Implementations return as soon as playback is committed (or has failed);
    /// the pipeline treats `Ok(())` as "playback will/has started".
    fn play(&self, source: BoxedSource, sentence_id: &str) -> Result<(), SpeechError>;
    /// Stop and discard the currently-playing source. No-op when idle.
    fn stop(&self);
    /// Whether the sink is expected to be usable right now.
    fn is_available(&self) -> bool;
}

/// rodio-backed sink on a dedicated thread.
pub struct RodioSinkFactory {
    device_name: Option<String>,
    state: Mutex<Option<SinkThread>>,
}

struct SinkThread {
    tx: mpsc::Sender<SinkCmd>,
    /// Liveness flag cleared by the thread when it exits.
    alive: Arc<AtomicBool>,
}

enum SinkCmd {
    Play {
        source: BoxedSource,
        reply: mpsc::Sender<Result<(), SpeechError>>,
    },
    Stop,
}

/// Wait cap for the audio thread to report device/stream success or failure.
const PLAY_REPLY_TIMEOUT: Duration = Duration::from_secs(5);

impl RodioSinkFactory {
    /// Create a factory. `device_name` selects an output device by name when it matches
    /// (cpal description, case-insensitive exact → substring); `None` or a non-matching
    /// name falls back to the default output device (with a warning logged).
    #[must_use]
    pub fn new(device_name: Option<String>) -> Self {
        Self {
            device_name: device_name.filter(|s| !s.trim().is_empty()),
            state: Mutex::new(None),
        }
    }

    fn spawn_thread(&self) -> Result<SinkThread, SpeechError> {
        let (tx, rx) = mpsc::channel::<SinkCmd>();
        let alive = Arc::new(AtomicBool::new(true));
        let thread_alive = Arc::clone(&alive);
        let device_name = self.device_name.clone();
        std::thread::Builder::new()
            .name("airi-speech-sink".into())
            .spawn(move || {
                sink_thread_main(rx, device_name);
                thread_alive.store(false, Ordering::Relaxed);
            })
            .map_err(|err| SpeechError::Playback(format!("spawn sink thread: {err}")))?;
        Ok(SinkThread { tx, alive })
    }

    fn ensure_thread(&self) -> Result<SinkThread, SpeechError> {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(existing) = state.as_ref() {
            if existing.alive.load(Ordering::Relaxed) {
                return Ok(SinkThread {
                    tx: existing.tx.clone(),
                    alive: Arc::clone(&existing.alive),
                });
            }
            tracing::warn!("speech sink thread exited; respawning");
            *state = None;
        }
        let thread = self.spawn_thread()?;
        *state = Some(SinkThread {
            tx: thread.tx.clone(),
            alive: Arc::clone(&thread.alive),
        });
        Ok(thread)
    }
}

fn match_output_device(names: &[(usize, String)], wanted: &str) -> Option<usize> {
    let wanted_lower = wanted.to_lowercase();
    // Exact (case-insensitive) match first, then substring.
    names
        .iter()
        .find(|(_, name)| name.to_lowercase() == wanted_lower)
        .or_else(|| {
            names
                .iter()
                .find(|(_, name)| name.to_lowercase().contains(&wanted_lower))
        })
        .map(|(index, _)| *index)
}

fn open_device(device_name: Option<&str>) -> Result<rodio::Device, SpeechError> {
    let host = rodio::cpal::default_host();
    if let Some(wanted) = device_name {
        let devices: Vec<_> = host
            .output_devices()
            .map(Iterator::collect)
            .unwrap_or_default();
        let names: Vec<(usize, String)> = devices
            .iter()
            .enumerate()
            .map(|(index, dev)| {
                let name = dev
                    .description()
                    .map(|d| d.name().to_string())
                    .unwrap_or_else(|_| format!("<device {index}>"));
                (index, name)
            })
            .collect();
        if let Some(index) = match_output_device(&names, wanted) {
            return Ok(devices
                .into_iter()
                .nth(index)
                .expect("index from enumeration"));
        }
        tracing::warn!(%wanted, "output device not found; falling back to default");
    }
    host.default_output_device()
        .ok_or_else(|| SpeechError::Playback("no default output device available".into()))
}

fn sink_thread_main(rx: mpsc::Receiver<SinkCmd>, device_name: Option<String>) {
    let mut stream: Option<rodio::MixerDeviceSink> = None;
    let mut player: Option<rodio::Player> = None;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            SinkCmd::Play { source, reply } => {
                if stream.is_none() {
                    match open_device(device_name.as_deref())
                        .and_then(|device| {
                            rodio::DeviceSinkBuilder::from_device(device).map_err(|err| {
                                SpeechError::Playback(format!("output config: {err}"))
                            })
                        })
                        .and_then(|builder| {
                            builder.open_stream().map_err(|err| {
                                SpeechError::Playback(format!("open output stream: {err}"))
                            })
                        }) {
                        Ok(sink) => {
                            let mut sink = sink;
                            sink.log_on_drop(false);
                            stream = Some(sink);
                        }
                        Err(err) => {
                            let _ = reply.send(Err(err));
                            continue;
                        }
                    }
                }
                // Replace any existing player; dropping it stops its sources.
                if let Some(old) = player.take() {
                    old.stop();
                }
                let mixer = stream.as_ref().expect("stream opened above").mixer();
                let new_player = rodio::Player::connect_new(mixer);
                new_player.append(source);
                player = Some(new_player);
                let _ = reply.send(Ok(()));
            }
            SinkCmd::Stop => {
                if let Some(old) = player.take() {
                    old.stop();
                }
            }
        }
    }
}

impl SpeechSinkFactory for RodioSinkFactory {
    fn play(&self, source: BoxedSource, _sentence_id: &str) -> Result<(), SpeechError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        let thread = self.ensure_thread()?;
        if thread
            .tx
            .send(SinkCmd::Play {
                source,
                reply: reply_tx,
            })
            .is_err()
        {
            return Err(SpeechError::Playback("sink thread is gone".into()));
        }
        reply_rx
            .recv_timeout(PLAY_REPLY_TIMEOUT)
            .map_err(|_| SpeechError::Playback("timed out waiting for the audio thread".into()))?
    }

    fn stop(&self) {
        if let Ok(guard) = self.state.lock() {
            if let Some(thread) = guard.as_ref() {
                let _ = thread.tx.send(SinkCmd::Stop);
            }
        }
    }

    fn is_available(&self) -> bool {
        true
    }
}

/// Names of all output devices visible to cpal. Empty when enumeration fails or on
/// headless machines — "empty" means "no known devices", not an error.
#[must_use]
pub fn list_output_devices() -> Vec<String> {
    let host = rodio::cpal::default_host();
    host.output_devices()
        .map(|devices| {
            devices
                .filter_map(|dev| dev.description().ok().map(|d| d.name().to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// Test sink: drains the source into an internal buffer synchronously.
/// `take_samples()` returns everything that would have reached the device.
#[derive(Default)]
pub struct CaptureSinkFactory {
    samples: Mutex<Vec<f32>>,
}

impl CaptureSinkFactory {
    /// Create an empty capture sink.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Take the drained samples (clears the buffer).
    pub fn take_samples(&self) -> Vec<f32> {
        std::mem::take(&mut *self.samples.lock().unwrap_or_else(|p| p.into_inner()))
    }

    /// Samples captured so far without draining.
    pub fn sample_count(&self) -> usize {
        self.samples.lock().unwrap_or_else(|p| p.into_inner()).len()
    }
}

impl SpeechSinkFactory for CaptureSinkFactory {
    fn play(&self, source: BoxedSource, _sentence_id: &str) -> Result<(), SpeechError> {
        let mut guard = self.samples.lock().unwrap_or_else(|p| p.into_inner());
        for sample in source {
            guard.push(sample);
        }
        Ok(())
    }

    fn stop(&self) {
        // Nothing to stop: play() drains synchronously and is already complete.
    }

    fn is_available(&self) -> bool {
        true
    }
}
