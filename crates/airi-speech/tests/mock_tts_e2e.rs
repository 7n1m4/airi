// SPDX-License-Identifier: GPL-3.0-or-later

//! Mock-TTS-server end-to-end test.
//!
//! Spins up a local `mockito` HTTP server that answers `POST /audio/speech` with a
//! canned WAV (~500 ms of a 440 Hz sine). The request body is checked against the
//! expected OpenAI-compatible shape. The pipeline feeds the bytes through a capture
//! sink; the test asserts:
//!
//! 1. synthesis happened exactly once across two speaks (second was served from cache),
//! 2. playback committed to the sink and every sample landed in the capture buffer,
//! 3. ≥ 3 lip-sync amplitude events fired,
//! 4. Started/Done lifecycle events fired,
//! 5. the cache directory holds the WAV on disk.

use std::sync::Arc;

use airi_speech::{
    build_tts_client, CaptureSinkFactory, SpeechAudioCache, SpeechEvent, SpeechPipeline,
    SynthesizeOptions, TtsProviderConfig,
};

fn sine_wav(seconds: f32) -> Vec<u8> {
    let sample_rate = 24_000u32;
    let channels = 1u16;
    let n = (seconds * sample_rate as f32) as usize;
    let mut pcm = Vec::with_capacity(n * 2);
    for i in 0..n {
        let t = i as f32 / sample_rate as f32;
        let sample = (t * 440.0 * 2.0 * std::f32::consts::PI).sin() * 0.6;
        let value = (sample * i16::MAX as f32) as i16;
        pcm.extend_from_slice(&value.to_le_bytes());
    }
    airi_speech::wav_from_pcm16(&pcm, sample_rate, channels)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mock_tts_server_end_to_end() {
    let wav_bytes = sine_wav(0.5);
    assert!(wav_bytes.len() > 44);

    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/v1/audio/speech")
        .match_header(
            "authorization",
            mockito::Matcher::Exact("Bearer test-key".to_string()),
        )
        .match_body(mockito::Matcher::PartialJsonString(
            r#"{"model":"tts-1","input":"hello world","voice":"alloy"}"#.to_string(),
        ))
        .with_status(200)
        .with_header("content-type", "audio/wav")
        .with_body(wav_bytes)
        .expect(1)
        .create_async()
        .await;

    let client = build_tts_client(TtsProviderConfig {
        id: "openai-audio-speech".to_string(),
        kind: None,
        api_key: Some("test-key".to_string()),
        base_url: Some(format!("{}/v1/", server.url())),
        model: Some("tts-1".to_string()),
        voice: Some("alloy".to_string()),
        extra: Default::default(),
    })
    .expect("client builds");

    let temp_dir = tempfile::tempdir().expect("tempdir");
    let cache = SpeechAudioCache::open(temp_dir.path().join("speech-cache"));
    let sink = Arc::new(CaptureSinkFactory::new());
    let pipeline = SpeechPipeline::new(client, cache, sink.clone(), "e2e");

    let mut events = pipeline.subscribe();

    // First speak: hits the network.
    let sentence_id = pipeline
        .speak("hello world", "alloy", &SynthesizeOptions::default())
        .await
        .expect("speak succeeds");

    // Drain the event bus until Done for our sentence (bounded).
    let mut amplitudes = 0usize;
    let mut saw_started = false;
    let mut saw_done = false;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    while !saw_done {
        let next = tokio::time::timeout_at(deadline, events.recv());
        match next.await {
            Ok(Ok(SpeechEvent::Started { sentence_id: id })) => {
                assert_eq!(id, sentence_id);
                saw_started = true;
            }
            Ok(Ok(SpeechEvent::Amplitude { level })) => {
                assert!((0.0..=1.0).contains(&level));
                amplitudes += 1;
            }
            Ok(Ok(SpeechEvent::Done {})) => saw_done = true,
            Ok(Ok(SpeechEvent::Error { message })) => panic!("unexpected error event: {message}"),
            Ok(Ok(SpeechEvent::Aborted {})) => panic!("unexpected abort"),
            Ok(Err(_)) | Err(_) => panic!("event bus closed or timed out before Done"),
        }
    }

    assert!(saw_started, "Started must fire");
    assert!(saw_done, "Done must fire");
    assert!(
        amplitudes >= 3,
        "expected ≥ 3 amplitude events, got {amplitudes}"
    );

    // Capture sink received the decoded samples. 500 ms @ 24 kHz ≈ 12_000.
    let sample_count = sink.sample_count();
    assert!(
        (10_000..=14_000).contains(&sample_count),
        "capture sink should hold ~12_000 samples, got {sample_count}"
    );

    // Second speak with identical input: must be served from cache (mock still expects 1 hit).
    let _sentence_id_2 = pipeline
        .speak("hello world", "alloy", &SynthesizeOptions::default())
        .await
        .expect("cached speak succeeds");
    let mut saw_done_2 = false;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    while !saw_done_2 {
        match tokio::time::timeout_at(deadline, events.recv()).await {
            Ok(Ok(SpeechEvent::Done {})) => saw_done_2 = true,
            Ok(Ok(_)) => {}
            Ok(Err(_)) | Err(_) => panic!("event bus closed or timed out before cached Done"),
        }
    }
    assert!(saw_done_2);

    mock.assert_async().await; // exactly one HTTP call across both speaks (expect(1))

    // Cache landed on disk with one entry.
    let stats = pipeline.cache_stats().await;
    assert_eq!(stats.entries, 1, "cache must hold exactly one entry");
    assert!(stats.bytes > 0);
    let on_disk = temp_dir
        .path()
        .join("speech-cache")
        .read_dir()
        .expect("cache dir exists")
        .count();
    assert_eq!(on_disk, 1, "cache dir must contain the WAV entry");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn provider_error_surfaces_as_error_event() {
    let mut server = mockito::Server::new_async().await;
    let _mock = server
        .mock("POST", "/v1/audio/speech")
        .match_body(mockito::Matcher::Any)
        .with_status(500)
        .with_body("upstream exploded")
        .expect(1)
        .create_async()
        .await;

    let client = build_tts_client(TtsProviderConfig {
        id: "openai-audio-speech".to_string(),
        kind: None,
        api_key: Some("test-key".to_string()),
        base_url: Some(format!("{}/v1/", server.url())),
        model: Some("tts-1".to_string()),
        voice: Some("alloy".to_string()),
        extra: Default::default(),
    })
    .expect("client builds");

    let temp_dir = tempfile::tempdir().expect("tempdir");
    let cache = SpeechAudioCache::open(temp_dir.path().join("speech-cache"));
    let sink = Arc::new(CaptureSinkFactory::new());
    let pipeline = SpeechPipeline::new(client, cache, sink, "e2e-err");

    let mut events = pipeline.subscribe();
    let err = pipeline
        .speak("hi", "alloy", &SynthesizeOptions::default())
        .await
        .expect_err("speak must fail");
    assert!(
        err.to_string().contains("500"),
        "error must carry status: {err}"
    );

    let saw_error = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut found = false;
        while !found {
            if let Ok(SpeechEvent::Error { message }) = events.recv().await {
                assert!(message.contains("500"));
                found = true;
            }
        }
        found
    })
    .await
    .unwrap_or(false);
    assert!(saw_error, "an Error event must fire");
}

struct StashSink {
    stashed: std::sync::Mutex<Option<airi_speech::BoxedSource>>,
}

impl StashSink {
    fn new() -> Self {
        Self {
            stashed: std::sync::Mutex::new(None),
        }
    }
}

impl airi_speech::SpeechSinkFactory for StashSink {
    fn play(
        &self,
        source: airi_speech::BoxedSource,
        _sentence_id: &str,
    ) -> Result<(), airi_speech::SpeechError> {
        *self.stashed.lock().unwrap() = Some(source);
        Ok(())
    }

    fn stop(&self) {
        // Drop the stashed source: the sentence never completes naturally.
        let _ = self.stashed.lock().unwrap().take();
    }

    fn is_available(&self) -> bool {
        true
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_current_aborts_playback() {
    let mut server = mockito::Server::new_async().await;
    let _mock = server
        .mock("POST", "/v1/audio/speech")
        .match_body(mockito::Matcher::Any)
        .with_status(200)
        .with_header("content-type", "audio/wav")
        .with_body(sine_wav(1.0))
        .create_async()
        .await;

    let client = build_tts_client(TtsProviderConfig {
        id: "openai-audio-speech".to_string(),
        kind: None,
        api_key: Some("test-key".to_string()),
        base_url: Some(format!("{}/v1/", server.url())),
        model: Some("tts-1".to_string()),
        voice: Some("alloy".to_string()),
        extra: Default::default(),
    })
    .expect("client builds");

    let temp_dir = tempfile::tempdir().expect("tempdir");
    let cache = SpeechAudioCache::open(temp_dir.path().join("speech-cache"));
    let sink = Arc::new(StashSink::new());
    let pipeline = SpeechPipeline::new(client, cache, sink, "e2e-abort");

    let mut events = pipeline.subscribe();
    let sentence_id = pipeline
        .speak("hello world", "alloy", &SynthesizeOptions::default())
        .await
        .expect("speak succeeds");

    let aborted = pipeline
        .cancel_current()
        .expect("in-flight sentence is aborted");
    assert_eq!(aborted, sentence_id);

    let saw_started = std::sync::Mutex::new(false);
    let saw_aborted = std::sync::Mutex::new(false);
    let saw_done = std::sync::Mutex::new(false);
    let drain = async {
        loop {
            match events.recv().await {
                Ok(SpeechEvent::Started { .. }) => *saw_started.lock().unwrap() = true,
                Ok(SpeechEvent::Aborted {}) => *saw_aborted.lock().unwrap() = true,
                Ok(SpeechEvent::Done {}) => *saw_done.lock().unwrap() = true,
                Ok(_) => {}
                Err(_) => break,
            }
            if *saw_aborted.lock().unwrap() && *saw_started.lock().unwrap() {
                break;
            }
        }
    };
    tokio::time::timeout(std::time::Duration::from_secs(5), drain)
        .await
        .expect("Aborted fires in time");
    assert!(*saw_started.lock().unwrap(), "Started fired");
    assert!(
        *saw_aborted.lock().unwrap(),
        "Aborted fired after cancel_current"
    );
    assert!(
        !*saw_done.lock().unwrap(),
        "Done must NOT fire for an aborted sentence"
    );
}
