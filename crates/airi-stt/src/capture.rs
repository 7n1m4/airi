// SPDX-License-Identifier: GPL-3.0-or-later

//! Microphone capture via `cpal`: 16 kHz mono f32 → s16 PCM.
//!
//! Frames are delivered as [`PcmChunk`]s of `chunk_samples` (default 512 —
//! 32 ms at 16 kHz, the Silero VAD window) on a `broadcast` channel
//! (`capture.rx`). Peak/RMS levels are tracked per chunk and exposed via
//! [`AudioCapture::level`] / [`AudioCapture::level_handle`] for a future UI
//! meter.
//!
//! ## Linux capture notes (ALSA / PulseAudio / PipeWire)
//!
//! `cpal` talks to ALSA directly. On modern desktops PulseAudio or PipeWire
//! exposes an ALSA compatibility layer, so the device named `default`
//! (or `sysdefault`) usually routes into the sound server and honours
//! whichever microphone the user selected there. If you see
//! `UnsupportedConfig`/`StreamTypeNotSupported`, check:
//!
//! - Device names with `arecord -l` (hardware, e.g. `hw:1,0`) vs `pactl list sources`
//!   (Pulse, e.g. `alsa_input.usb-...`). cpal reports ALSA names.
//! - 16 kHz mono is what this crate requests. Most ALSA/Pulse devices accept
//!   it (Pulse resamples transparently). If a device truly cannot do 16 kHz,
//!   [`CaptureError::UnsupportedSampleRate`] is returned — resampling is out
//!   of scope for now (TODO: rubato-based resample fallback).
//! - Permissions: with Pulse/PipeWire no special group membership is needed.
//!   With raw ALSA the user may need to be in the `audio` group, or have a
//!   Pulse/PipeWire session. In VMs/containers without `/dev/snd` capture
//!   devices, [`AudioCapture::start`] errors and hardware-dependent tests skip.
//!
//! Capture is pull-free: the cpal callback thread pushes chunks into the
//! broadcast channel; slow subscribers lag and drop chunks (capacity 64).

use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use thiserror::Error;
use tokio::sync::broadcast;

/// Default sample rate: 16 kHz mono (what Silero VAD and most STT APIs want).
pub const DEFAULT_SAMPLE_RATE: u32 = 16_000;
/// Default chunk size in samples: 512 (32 ms at 16 kHz — the VAD window).
pub const DEFAULT_CHUNK_SAMPLES: usize = 512;

/// One chunk of captured audio with pre-computed levels.
#[derive(Debug, Clone)]
pub struct PcmChunk {
    /// Signed 16-bit little-endian mono samples.
    pub samples: Vec<i16>,
    /// Sample rate (always [`DEFAULT_SAMPLE_RATE`] today).
    pub sample_rate: u32,
    /// Monotonic sequence number assigned at capture time.
    pub seq: u64,
    /// Peak absolute amplitude in [0, 1] (f32 domain, pre quantization).
    pub peak: f32,
    /// Root mean square amplitude in [0, 1] (f32 domain, pre quantization).
    pub rms: f32,
}

/// Latest input level, shared with the UI later.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct AudioLevel {
    pub peak: f32,
    pub rms: f32,
    /// Sequence number of the chunk this level was computed from.
    pub seq: u64,
}

/// Capture configuration.
#[derive(Debug, Clone, PartialEq)]
pub struct CaptureConfig {
    /// Exact cpal input device name. `None` → default input device.
    pub device_name: Option<String>,
    /// Target sample rate; only [`DEFAULT_SAMPLE_RATE`] is supported today.
    pub sample_rate: u32,
    /// Samples per emitted chunk ([`DEFAULT_CHUNK_SAMPLES`] = VAD window).
    pub chunk_samples: usize,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            device_name: None,
            sample_rate: DEFAULT_SAMPLE_RATE,
            chunk_samples: DEFAULT_CHUNK_SAMPLES,
        }
    }
}

#[derive(Debug, Error)]
pub enum CaptureError {
    #[error("input device '{0}' not found")]
    DeviceNotFound(String),
    #[error("no default input device available")]
    NoDefaultDevice,
    #[error("could not enumerate input devices: {0}")]
    Enumerate(String),
    #[error("device does not support {0} Hz; set a matching rate or check the sound server")]
    UnsupportedSampleRate(u32),
    #[error("unsupported sample format: {0} (only f32 and i16 are supported)")]
    UnsupportedSampleFormat(String),
    #[error("could not read device supported configs: {0}")]
    SupportedConfigs(String),
    #[error("failed to build input stream: {0}")]
    BuildStream(String),
    #[error("failed to start input stream: {0}")]
    PlayStream(String),
    #[error("capture configuration invalid: {0}")]
    InvalidConfig(String),
}

/// A running capture session. Drop or [`AudioCapture::stop`] to end capture.
pub struct AudioCapture {
    /// Subscribe to PCM chunks (shared broadcast; lag drops chunks).
    pub rx: broadcast::Receiver<PcmChunk>,
    config: CaptureConfig,
    device_name: String,
    level: Arc<Mutex<AudioLevel>>,
    seq: Arc<std::sync::atomic::AtomicU64>,
    stream: Option<cpal::Stream>,
}

impl std::fmt::Debug for AudioCapture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AudioCapture")
            .field("device_name", &self.device_name)
            .field("level", &self.level())
            .finish_non_exhaustive()
    }
}

impl AudioCapture {
    /// Start capture. Returns immediately; chunks flow on [`Self::rx`].
    pub fn start(config: CaptureConfig) -> Result<Self, CaptureError> {
        if config.sample_rate != DEFAULT_SAMPLE_RATE {
            // Honest error rather than silently resampling.
            return Err(CaptureError::UnsupportedSampleRate(config.sample_rate));
        }
        if config.chunk_samples == 0 {
            return Err(CaptureError::InvalidConfig(
                "chunk_samples must be > 0".into(),
            ));
        }

        let host = cpal::default_host();
        let devices = candidate_devices(&host, config.device_name.as_deref())?;
        let mut last_error = CaptureError::NoDefaultDevice;
        for device in devices {
            match Self::start_on_device(device, &config) {
                Ok(capture) => return Ok(capture),
                Err(error) => {
                    tracing::warn!("input device candidate failed: {error}");
                    last_error = error;
                }
            }
        }
        Err(last_error)
    }

    /// Build and start capture on one specific device.
    fn start_on_device(device: cpal::Device, config: &CaptureConfig) -> Result<Self, CaptureError> {
        let device_name = device
            .description()
            .map(|d| d.name().to_string())
            .unwrap_or_else(|_| "<unknown>".to_string());

        // Prefer: f32, mono (or stereo that we downmix), 16 kHz expressible.
        let supported: Vec<cpal::SupportedStreamConfigRange> = device
            .supported_input_configs()
            .map_err(|e| CaptureError::SupportedConfigs(e.to_string()))?
            .collect();

        let rate_16k: Vec<&cpal::SupportedStreamConfigRange> = supported
            .iter()
            .filter(|r| {
                (r.channels() == 1 || r.channels() == 2)
                    && r.min_sample_rate() <= DEFAULT_SAMPLE_RATE
                    && r.max_sample_rate() >= DEFAULT_SAMPLE_RATE
            })
            .collect();
        let pick = rate_16k
            .iter()
            .find(|r| r.channels() == 1 && r.sample_format() == cpal::SampleFormat::F32)
            .or_else(|| {
                rate_16k
                    .iter()
                    .find(|r| r.sample_format() == cpal::SampleFormat::F32)
            })
            .or_else(|| {
                rate_16k
                    .iter()
                    .find(|r| r.channels() == 1 && r.sample_format() == cpal::SampleFormat::I16)
            })
            .or_else(|| {
                rate_16k
                    .iter()
                    .find(|r| r.sample_format() == cpal::SampleFormat::I16)
            })
            .copied();
        let supported_config = match pick {
            Some(r) => (*r)
                .try_with_sample_rate(DEFAULT_SAMPLE_RATE)
                .ok_or(CaptureError::UnsupportedSampleRate(DEFAULT_SAMPLE_RATE))?,
            None => {
                if rate_16k.is_empty() {
                    return Err(CaptureError::UnsupportedSampleRate(DEFAULT_SAMPLE_RATE));
                }
                return Err(CaptureError::UnsupportedSampleFormat(format!(
                    "{:?}",
                    rate_16k[0].sample_format()
                )));
            }
        };
        let channels = supported_config.channels();
        let sample_format = supported_config.sample_format();

        let stream_config: cpal::StreamConfig = supported_config.into();
        let (tx, rx) = broadcast::channel(64);
        let level = Arc::new(Mutex::new(AudioLevel::default()));
        let seq = Arc::new(std::sync::atomic::AtomicU64::new(0));

        let err_fn = |e| tracing::error!("cpal input stream error: {e}");

        let stream = match sample_format {
            cpal::SampleFormat::F32 => {
                let tx = tx.clone();
                let level = Arc::clone(&level);
                let seq = Arc::clone(&seq);
                let ch = channels as usize;
                let chunk_samples = config.chunk_samples;
                let mut acc: Vec<f32> = Vec::with_capacity(chunk_samples * 2);
                device.build_input_stream(
                    stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        ingest_samples(data, |s| s, ch, &mut acc, chunk_samples, &tx, &level, &seq);
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let tx = tx.clone();
                let level = Arc::clone(&level);
                let seq = Arc::clone(&seq);
                let ch = channels as usize;
                let chunk_samples = config.chunk_samples;
                let mut acc: Vec<f32> = Vec::with_capacity(chunk_samples * 2);
                device.build_input_stream(
                    stream_config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        ingest_samples(
                            data,
                            |s| f32::from(s) / 32768.0,
                            ch,
                            &mut acc,
                            chunk_samples,
                            &tx,
                            &level,
                            &seq,
                        );
                    },
                    err_fn,
                    None,
                )
            }
            other => {
                return Err(CaptureError::UnsupportedSampleFormat(format!("{other:?}")));
            }
        }
        .map_err(|e| CaptureError::BuildStream(e.to_string()))?;

        stream
            .play()
            .map_err(|e| CaptureError::PlayStream(e.to_string()))?;

        Ok(Self {
            rx,
            config: config.clone(),
            device_name,
            level,
            seq,
            stream: Some(stream),
        })
    }

    /// The resolved input device name (for diagnostics/UI).
    pub fn device_name(&self) -> &str {
        &self.device_name
    }

    /// The configuration this capture was started with.
    pub fn config(&self) -> &CaptureConfig {
        &self.config
    }

    /// Latest input level (peak/RMS of the last emitted chunk).
    pub fn level(&self) -> AudioLevel {
        *self.level.lock().expect("audio level mutex poisoned")
    }

    /// Shared handle to the level meter (clone for a UI poller).
    pub fn level_handle(&self) -> Arc<Mutex<AudioLevel>> {
        Arc::clone(&self.level)
    }

    /// Total chunks emitted so far.
    pub fn chunks_emitted(&self) -> u64 {
        self.seq.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Stop capture. The broadcast channel closes after the last in-flight chunk.
    pub fn stop(mut self) {
        if let Some(stream) = self.stream.take() {
            drop(stream);
        }
    }
}

impl Drop for AudioCapture {
    fn drop(&mut self) {
        if let Some(stream) = self.stream.take() {
            drop(stream);
        }
    }
}

/// Default-device candidates for [`AudioCapture::start`], in preference order.
///
/// Explicit `device_name` → exactly one candidate. Otherwise:
/// PulseAudio, PipeWire, then any device that can do 16 kHz mono f32/i16
/// (null/discarding devices and ALSA rate-converter plugins are excluded),
/// then the host default as a last resort. Each candidate is tried in turn —
/// devices that advertise a config but fail to build a stream are skipped.
fn candidate_devices(
    host: &cpal::Host,
    device_name: Option<&str>,
) -> Result<Vec<cpal::Device>, CaptureError> {
    let devices: Vec<cpal::Device> = host
        .input_devices()
        .map_err(|e| CaptureError::Enumerate(e.to_string()))?
        .collect();

    let name_of = |d: &cpal::Device| {
        d.description()
            .map(|d| d.name().to_string())
            .unwrap_or_default()
    };

    if let Some(name) = device_name {
        return devices
            .into_iter()
            .find(|d| name_of(d) == name)
            .map(|d| vec![d])
            .ok_or_else(|| CaptureError::DeviceNotFound(name.to_string()));
    }

    let mut out: Vec<cpal::Device> = Vec::new();
    let mut push = |d: cpal::Device| {
        if !out.iter().any(|existing| name_of(existing) == name_of(&d)) {
            out.push(d);
        }
    };

    // Sound servers first — they respect the user's desktop mic selection.
    for key in ["PulseAudio", "PipeWire"] {
        if let Some(d) = devices.iter().find(|d| name_of(d).contains(key)) {
            push(d.clone());
        }
    }
    // Then anything that can actually capture 16 kHz mono.
    for d in &devices {
        let name = name_of(d);
        if name.contains("Discard")
            || name.contains("Rate Converter")
            || name.contains("Open Sound System")
            || name.contains("JACK")
        {
            continue;
        }
        if supports_16k_mono(d) {
            push(d.clone());
        }
    }
    if let Some(d) = host.default_input_device() {
        push(d);
    }
    Ok(out)
}

fn supports_16k_mono(device: &cpal::Device) -> bool {
    device
        .supported_input_configs()
        .map(|configs| {
            configs.into_iter().any(|r| {
                r.channels() == 1
                    && r.min_sample_rate() <= DEFAULT_SAMPLE_RATE
                    && r.max_sample_rate() >= DEFAULT_SAMPLE_RATE
                    && matches!(
                        r.sample_format(),
                        cpal::SampleFormat::F32 | cpal::SampleFormat::I16
                    )
            })
        })
        .unwrap_or(false)
}

/// Downmix → accumulate → quantize to s16 → emit fixed-size chunks.
/// `to_f32` normalizes one sample into f32 [-1, 1]. Mono inputs are extended
/// in-place (no intermediate buffer); stereo frames are averaged.
#[allow(clippy::too_many_arguments)]
fn ingest_samples<S: Copy>(
    input: &[S],
    to_f32: impl Fn(S) -> f32,
    channels: usize,
    acc: &mut Vec<f32>,
    chunk_samples: usize,
    tx: &broadcast::Sender<PcmChunk>,
    level: &Arc<Mutex<AudioLevel>>,
    seq: &Arc<std::sync::atomic::AtomicU64>,
) {
    if channels == 1 {
        acc.extend(input.iter().map(|&s| to_f32(s)));
    } else {
        for frame in input.chunks_exact(channels) {
            let sum: f32 = frame.iter().map(|&s| to_f32(s)).sum();
            acc.push(sum / channels as f32);
        }
    }

    while acc.len() >= chunk_samples {
        let mut peak = 0.0f32;
        let mut sum_sq = 0.0f32;
        let mut samples = Vec::with_capacity(chunk_samples);
        for &s in acc.iter().take(chunk_samples) {
            peak = peak.max(s.abs());
            sum_sq += s * s;
            samples.push((s.clamp(-1.0, 1.0) * 32767.0).round() as i16);
        }
        acc.drain(..chunk_samples);
        let rms = (sum_sq / chunk_samples as f32).sqrt();
        let chunk_seq = seq.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        {
            let mut guard = level.lock().expect("audio level mutex poisoned");
            *guard = AudioLevel {
                peak,
                rms,
                seq: chunk_seq,
            };
        }
        // Lagging receivers are fine — broadcast just drops for them.
        let _ = tx.send(PcmChunk {
            samples,
            sample_rate: DEFAULT_SAMPLE_RATE,
            seq: chunk_seq,
            peak,
            rms,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_16k_rate_honestly() {
        let err = AudioCapture::start(CaptureConfig {
            sample_rate: 48_000,
            ..CaptureConfig::default()
        })
        .expect_err("non-16 kHz capture must error, not silently resample");
        assert!(matches!(err, CaptureError::UnsupportedSampleRate(48_000)));
    }

    #[test]
    fn rejects_zero_chunk_size() {
        let err = AudioCapture::start(CaptureConfig {
            chunk_samples: 0,
            ..CaptureConfig::default()
        })
        .expect_err("zero chunk size must error");
        assert!(matches!(err, CaptureError::InvalidConfig(_)));
    }

    #[test]
    fn ingest_downmixes_stereo_and_quantizes() {
        let (tx, mut rx) = broadcast::channel(4);
        let level = Arc::new(Mutex::new(AudioLevel::default()));
        let seq = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let mut acc = Vec::new();
        // 2 stereo frames → 1 mono sample each at max amplitude.
        ingest_samples(
            &[1.0f32, 1.0, -1.0, -1.0, 0.5, -0.5, 0.0, 0.0],
            |s| s,
            2,
            &mut acc,
            4,
            &tx,
            &level,
            &seq,
        );
        // Only 4 mono samples accumulated: 1.0, -1.0, 0.0, 0.0 → one chunk.
        let chunk = rx.try_recv().expect("a chunk must be emitted");
        assert_eq!(chunk.samples.len(), 4);
        assert_eq!(chunk.samples[0], 32767);
        assert_eq!(chunk.samples[1], -32767);
        assert_eq!(chunk.samples[2], 0);
        assert!(chunk.peak > 0.99);
        assert!(chunk.rms > 0.0);
        assert_eq!(level.lock().unwrap().seq, 0);
        assert_eq!(seq.load(std::sync::atomic::Ordering::Relaxed), 1);
    }

    /// Hardware smoke: starts real capture for ~1 s if an input device exists.
    /// Skips (passes) on machines without a capture device (e.g. CI VMs).
    #[test]
    fn capture_from_default_device_smoke() {
        let config = CaptureConfig::default();
        let mut capture = match AudioCapture::start(config) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("skipping capture smoke test: no usable input device: {e}");
                return;
            }
        };
        // Drain chunks for ~1 second.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
        let mut got = 0usize;
        while std::time::Instant::now() < deadline {
            match capture.rx.try_recv() {
                Ok(_) => got += 1,
                Err(broadcast::error::TryRecvError::Empty) => {
                    std::thread::sleep(std::time::Duration::from_millis(5))
                }
                Err(broadcast::error::TryRecvError::Lagged(n)) => {
                    eprintln!("subscriber lagged by {n} chunks (expected under load)");
                }
                Err(broadcast::error::TryRecvError::Closed) => break,
            }
        }
        eprintln!(
            "captured {got} chunks from device '{}'",
            capture.device_name()
        );
        let level = capture.level();
        eprintln!("level: peak={:.4} rms={:.4}", level.peak, level.rms);
        capture.stop();
        // On a working device we should see roughly 31 chunks/s; tolerate noise.
        assert!(
            got <= 40,
            "impossible chunk rate, something is double-counting"
        );
    }
}
