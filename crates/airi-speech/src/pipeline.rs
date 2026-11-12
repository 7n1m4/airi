// SPDX-License-Identifier: GPL-3.0-or-later

//! The speech pipeline: text → synth (or cache) → decode → lip-sync tap → sink.
//!
//! Events flow on a `tokio::sync::broadcast` bus (`SpeechEvent`), mirroring
//! `airi-core`'s `ChatEvent` one-way pattern. Subscribe *before* calling `SpeechPipeline::speak`.
//!
//! Barge-in: `speak` cancels any in-flight sentence first (AIRI default), and
//! `cancel_current` aborts explicitly. Abort stops the sink; the tap suppresses the
//! trailing `Done` when the abort flag is set, so listeners see exactly one terminal
//! event per sentence.
//!
//! Cache: audio bytes are cached on disk (see `SpeechAudioCache`) under
//! `sha256(client scope | model hint | voice | format hint | speed | pitch | text)`.
//! `format hint` is `response_format` when set, else the sniffed container. Cache hits
//! skip the network entirely.

use std::io::Cursor;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::{broadcast, Mutex as AsyncMutex};

use crate::cache::SpeechAudioCache;
use crate::client_common::{collect_stream, sniff_format, truncate};
use crate::error::SpeechError;
use crate::player::SpeechSinkFactory;
use crate::synth::SpeechSynthesizer;
use crate::tap::{AmplitudeTap, BoxedSource};
use crate::types::{SentenceId, SpeechEvent, SynthesizeOptions};

/// Capacity of the broadcast event bus.
const EVENT_CAPACITY: usize = 256;
/// 64 MiB cap on collected audio payloads.
const COLLECT_CAP: usize = 64 * 1024 * 1024;

struct CurrentPlayback {
    sentence_id: SentenceId,
    abort: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
}

/// Orchestrates synthesis and playback. Cheap to clone via `Arc` if desired; all
/// mutable state is behind internal locks.
pub struct SpeechPipeline {
    client: Arc<dyn SpeechSynthesizer>,
    cache_scope: String,
    cache: AsyncMutex<SpeechAudioCache>,
    sink: Arc<dyn SpeechSinkFactory>,
    events: broadcast::Sender<SpeechEvent>,
    current: Mutex<Option<CurrentPlayback>>,
    counter: AtomicU64,
    cache_enabled: AtomicBool,
}

impl SpeechPipeline {
    /// Build a pipeline. `cache_scope` disambiguates cache keys for clients that share a
    /// provider id but differ in credentials/base URL (e.g. several OpenAI-compatible
    /// endpoints): it is mixed into the key. Pass `client.id()` when one scope per id is fine.
    #[must_use]
    pub fn new(
        client: Arc<dyn SpeechSynthesizer>,
        cache: SpeechAudioCache,
        sink: Arc<dyn SpeechSinkFactory>,
        cache_scope: impl Into<String>,
    ) -> Self {
        let (events, _) = broadcast::channel(EVENT_CAPACITY);
        Self {
            client,
            cache_scope: cache_scope.into(),
            cache: AsyncMutex::new(cache),
            sink,
            events,
            current: Mutex::new(None),
            counter: AtomicU64::new(0),
            cache_enabled: AtomicBool::new(true),
        }
    }

    /// Subscribe to pipeline events.
    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<SpeechEvent> {
        self.events.subscribe()
    }

    /// Enable/disable the disk cache (e.g. for hermetic tests or cache-free operation).
    pub fn set_cache_enabled(&self, enabled: bool) {
        self.cache_enabled.store(enabled, Ordering::Relaxed);
    }

    /// Cancel the in-flight sentence, if any. Returns its id.
    ///
    /// Emits `SpeechEvent::Aborted` when something was actually aborted. A sentence that
    /// already finished naturally is not reported as aborted.
    pub fn cancel_current(&self) -> Option<SentenceId> {
        let current = self
            .current
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()?;
        if current.done.load(Ordering::Relaxed) {
            return None;
        }
        current.abort.store(true, Ordering::Relaxed);
        self.sink.stop();
        let _ = self.events.send(SpeechEvent::Aborted {});
        Some(current.sentence_id)
    }

    /// Synthesize `text` and play it. Barge-in: any in-flight sentence is cancelled first.
    ///
    /// Returns the sentence id immediately after playback is committed to the sink
    /// (for the capture sink, playback has fully drained by then). Playback completion
    /// and amplitude events arrive on the event bus.
    ///
    /// # Errors
    /// Returns `SpeechError` for synthesis/decode/sink failures; the same failure is
    /// emitted as `SpeechEvent::Error` before returning.
    pub async fn speak(
        &self,
        text: &str,
        voice: &str,
        options: &SynthesizeOptions,
    ) -> Result<SentenceId, SpeechError> {
        self.cancel_current();

        let sentence_id = self.next_sentence_id();
        let abort = Arc::new(AtomicBool::new(false));
        let done = Arc::new(AtomicBool::new(false));

        let result = self
            .synthesize_and_play(
                sentence_id.clone(),
                text,
                voice,
                options,
                Arc::clone(&abort),
                Arc::clone(&done),
            )
            .await;

        match result {
            Ok(()) => {
                let mut current = self.current.lock().unwrap_or_else(|p| p.into_inner());
                *current = Some(CurrentPlayback {
                    sentence_id: sentence_id.clone(),
                    abort,
                    done,
                });
                Ok(sentence_id)
            }
            Err(err) => {
                let _ = self.events.send(SpeechEvent::Error {
                    message: truncate(&err.to_string(), 512),
                });
                Err(err)
            }
        }
    }

    fn next_sentence_id(&self) -> SentenceId {
        let seq = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        format!("s-{millis}-{seq}")
    }

    async fn synthesize_and_play(
        &self,
        sentence_id: SentenceId,
        text: &str,
        voice: &str,
        options: &SynthesizeOptions,
        abort: Arc<AtomicBool>,
        done: Arc<AtomicBool>,
    ) -> Result<(), SpeechError> {
        let effective_voice = voice.trim().to_string();
        let model_hint = options
            .model
            .clone()
            .unwrap_or_else(|| "provider-default".to_string());
        let format_hint = options.response_format.map(|f| f.as_str().to_string());
        let speed = options.speed;
        let pitch = options.pitch;

        let cache_key = format_hint.as_deref().unwrap_or("auto").to_string();
        let key = SpeechAudioCache::key_for(
            &self.cache_scope,
            &model_hint,
            &effective_voice,
            &cache_key,
            speed,
            pitch,
            text,
        );

        let bytes = if self.cache_enabled.load(Ordering::Relaxed) {
            let cached = self.cache.lock().await.get(&key);
            cached.map(|hit| hit.bytes)
        } else {
            None
        };

        let bytes = match bytes {
            Some(bytes) => {
                tracing::debug!(%sentence_id, "speech-cache hit");
                bytes
            }
            None => {
                let stream = self
                    .client
                    .synthesize(text, &effective_voice, options)
                    .await?;
                let bytes = collect_stream(stream, COLLECT_CAP).await?;
                if self.cache_enabled.load(Ordering::Relaxed) {
                    let ext = format_hint
                        .clone()
                        .or_else(|| sniff_format(&bytes).map(|f| f.as_str().to_string()))
                        .unwrap_or_else(|| "bin".to_string());
                    if let Err(err) = self.cache.lock().await.insert(&key, &ext, &bytes) {
                        tracing::warn!(
                            "speech-cache: insert failed, continuing without cache: {err}"
                        );
                    }
                }
                bytes
            }
        };

        if abort.load(Ordering::Relaxed) {
            // Cancelled while synthesizing: nothing of this sentence may play.
            return Ok(());
        }

        let decoder = rodio::Decoder::new(Cursor::new(bytes)).map_err(|err| {
            SpeechError::Decode(format!("cannot decode synthesized audio: {err}"))
        })?;

        let tap_events = self.events.clone();
        let source: BoxedSource = Box::new(AmplitudeTap::new(decoder, tap_events, 50, abort, done));

        // Started is emitted once the source is ready to be consumed, not when the
        // network call begins — consumers syncing mouth/lips care about audible start.
        let _ = self.events.send(SpeechEvent::Started {
            sentence_id: sentence_id.clone(),
        });
        self.sink.play(source, &sentence_id)?;
        Ok(())
    }
}

/// Snapshot of cache statistics (for tests and diagnostics).
#[derive(Debug, Clone, Default)]
pub struct CacheStats {
    /// Entries in the index.
    pub entries: usize,
    /// Bytes in the index.
    pub bytes: u64,
}

impl SpeechPipeline {
    /// Inspect the cache (tests).
    pub async fn cache_stats(&self) -> CacheStats {
        let cache = self.cache.lock().await;
        CacheStats {
            entries: cache.len(),
            bytes: cache.total_bytes(),
        }
    }
}
