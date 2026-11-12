// SPDX-License-Identifier: GPL-3.0-or-later

//! Disk-backed LRU speech audio cache.
//!
//! Mirrors `SpeechAudioCache` (packages/stage-ui/src/services/speech/audio-cache.ts):
//! 200 entries / 50 MB cap, least-recently-used eviction. Unlike the Vue original it is
//! backed by the filesystem (`<data>/airi-qt/speech-cache/<sha256>.<ext>`) instead of an
//! in-memory Map, so decoded-once audio survives restarts. An in-memory index is rebuilt
//! from the directory at open; file mtimes seed the LRU order.
//!
//! Key: `sha256(provider_id | model | voice | format | speed | pitch | trimmed text)`.
//! The plan sketched `sha256(provider_id | model | voice | format | spoken text)`; `speed`
//! and `pitch` are included because they alter the audio bytes — same rationale as the
//! Vue `createSpeechAudioCacheKey`, which carries `pitch` and `speed`.
//!
//! Not concurrency-literal: the pipeline holds the cache behind a `tokio::sync::Mutex`.
//! The cache itself is `!Sync`-agnostic (plain struct); callers serialize access.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::error::SpeechError;
use crate::wav::encode_hex;

const ENTRY_EXTS: [&str; 6] = ["mp3", "opus", "aac", "flac", "wav", "pcm"];

/// One audio payload returned from the cache.
#[derive(Debug, Clone)]
pub struct CachedAudio {
    /// Raw encoded audio bytes.
    pub bytes: Vec<u8>,
    /// Container tag derived from the file extension (`mp3`, `wav`, …).
    pub format: String,
}

struct CacheEntry {
    path: PathBuf,
    size: u64,
    last_used: u64,
    format: String,
}

/// LRU on-disk speech cache. See module docs.
pub struct SpeechAudioCache {
    dir: PathBuf,
    entries: HashMap<String, CacheEntry>,
    tick: u64,
    max_entries: usize,
    max_bytes: u64,
    current_bytes: u64,
}

impl SpeechAudioCache {
    /// Default cache directory: `<dirs::data_dir()>/airi-qt/speech-cache`,
    /// falling back to the temp dir when the data dir cannot be resolved.
    #[must_use]
    pub fn default_cache_dir() -> PathBuf {
        dirs::data_dir()
            .map(|d| d.join("airi-qt").join("speech-cache"))
            .unwrap_or_else(|| std::env::temp_dir().join("airi-speech-cache"))
    }

    /// Open (and index) a cache directory, creating it if needed.
    ///
    /// Best-effort by design: entries that fail to read are dropped from the index,
    /// and opening a completely unreadable directory yields an empty cache rather
    /// than an error — losing the cache must never break TTS.
    #[must_use]
    pub fn open(dir: impl AsRef<Path>) -> Self {
        Self::open_with_caps(dir, 200, 50 * 1024 * 1024)
    }

    /// Open with explicit caps (used by tests).
    #[must_use]
    pub fn open_with_caps(dir: impl AsRef<Path>, max_entries: usize, max_bytes: u64) -> Self {
        let dir = dir.as_ref().to_path_buf();
        let _ = std::fs::create_dir_all(&dir);

        let mut entries = HashMap::new();
        let mut current_bytes = 0u64;
        let mut tick = 0u64;

        if let Ok(read_dir) = std::fs::read_dir(&dir) {
            for entry in read_dir.flatten() {
                let path = entry.path();
                let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
                if !is_file {
                    continue;
                }
                let Some(key) = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(str::to_string)
                else {
                    continue;
                };
                let Some(ext) = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.to_ascii_lowercase())
                else {
                    continue;
                };
                if !ENTRY_EXTS.contains(&ext.as_str()) {
                    continue;
                }
                let Ok(meta) = entry.metadata() else { continue };
                let size = meta.len();
                // Seed LRU order from mtime (fallback: insertion order).
                let mtime_tick = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                tick = tick.max(mtime_tick);
                entries.insert(
                    key,
                    CacheEntry {
                        path,
                        size,
                        last_used: mtime_tick,
                        format: ext,
                    },
                );
                current_bytes += size;
            }
        }

        let mut cache = Self {
            dir,
            entries,
            tick,
            max_entries,
            max_bytes,
            current_bytes,
        };
        cache.evict_to_limits(None);
        cache
    }

    /// Cache key for a synthesis request. See module docs for the field set.
    #[must_use]
    pub fn key_for(
        provider_id: &str,
        model: &str,
        voice: &str,
        format: &str,
        speed: Option<f32>,
        pitch: Option<f32>,
        text: &str,
    ) -> String {
        let mut hasher = Sha256::new();
        let payload = format!(
            "{}|{}|{}|{}|{:.3}|{:.3}|{}",
            provider_id.trim(),
            model.trim(),
            voice.trim(),
            format.trim().to_ascii_lowercase(),
            speed.unwrap_or(1.0),
            pitch.unwrap_or(0.0),
            text.trim()
        );
        hasher.update(payload.as_bytes());
        encode_hex(&hasher.finalize())
    }

    /// Number of entries currently indexed.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Total bytes currently indexed.
    #[must_use]
    pub fn total_bytes(&self) -> u64 {
        self.current_bytes
    }

    /// Whether the cache is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Look up a key, promoting it to most-recently-used.
    pub fn get(&mut self, key: &str) -> Option<CachedAudio> {
        let size = self.entries.get(key)?.size;
        let format = self.entries.get(key)?.format.clone();
        let path = self.entries.get(key)?.path.clone();
        match std::fs::read(&path) {
            Ok(bytes) => {
                self.tick += 1;
                if let Some(entry) = self.entries.get_mut(key) {
                    entry.last_used = self.tick;
                }
                Some(CachedAudio { bytes, format })
            }
            Err(_) => {
                // Dangling index entry — drop it and account for the loss.
                if let Some(entry) = self.entries.remove(key) {
                    self.current_bytes = self.current_bytes.saturating_sub(entry.size);
                }
                tracing::warn!(%size, "speech-cache: unreadable entry evicted from index");
                None
            }
        }
    }

    /// Insert (or replace) an entry, evicting LRU entries until limits hold.
    ///
    /// # Errors
    /// [`SpeechError::Cache`] on filesystem failure (callers may decide to proceed
    /// without caching — synthesis results are still valid).
    pub fn insert(&mut self, key: &str, format: &str, bytes: &[u8]) -> Result<(), SpeechError> {
        let ext = sanitize_ext(format);
        let path = self.dir.join(format!("{key}.{ext}"));
        let tmp = self
            .dir
            .join(format!("{key}.{ext}.tmp-{}", std::process::id()));
        std::fs::write(&tmp, bytes)
            .map_err(|err| SpeechError::Cache(format!("write {tmp:?}: {err}")))?;
        std::fs::rename(&tmp, &path).map_err(|err| {
            let _ = std::fs::remove_file(&tmp);
            SpeechError::Cache(format!("rename {tmp:?} -> {path:?}: {err}"))
        })?;

        self.tick += 1;
        self.current_bytes += bytes.len() as u64;
        if let Some(old) = self.entries.insert(
            key.to_string(),
            CacheEntry {
                path,
                size: bytes.len() as u64,
                last_used: self.tick,
                format: ext,
            },
        ) {
            self.current_bytes = self.current_bytes.saturating_sub(old.size);
        }
        self.evict_to_limits(Some(key));
        Ok(())
    }

    /// Remove every entry and every cache file. Best-effort on the filesystem side.
    pub fn clear(&mut self) {
        for entry in self.entries.values() {
            let _ = std::fs::remove_file(&entry.path);
        }
        self.entries.clear();
        self.current_bytes = 0;
    }

    /// Try to remove the cache directory entirely (best-effort).
    pub fn remove_dir_best_effort(&self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }

    fn evict_to_limits(&mut self, protect: Option<&str>) {
        while self.entries.len() > self.max_entries || self.current_bytes > self.max_bytes {
            let victim = self
                .entries
                .iter()
                .filter(|(key, _)| protect.is_none_or(|p| key.as_str() != p))
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(key, _)| key.clone());
            let Some(victim) = victim else { break };
            if let Some(entry) = self.entries.remove(&victim) {
                self.current_bytes = self.current_bytes.saturating_sub(entry.size);
                let _ = std::fs::remove_file(&entry.path);
                tracing::debug!(%victim, "speech-cache: evicted entry");
            }
        }
    }
}

fn sanitize_ext(format: &str) -> String {
    let clean: String = format
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    if ENTRY_EXTS.contains(&clean.as_str()) {
        clean
    } else {
        "bin".to_string()
    }
}
