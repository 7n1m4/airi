// SPDX-License-Identifier: GPL-3.0-or-later

//! End-to-end test of the OpenAI-compatible transcription path against a
//! mock TCP server, plus VAD-capture-independent client behavior.

mod common;

use std::time::Duration;

use airi_stt::stt::{OpenAiTranscribeClient, SttClient, SttError, SttRequest};

use common::serve_once;

#[tokio::test]
async fn transcribe_pcm_roundtrip_against_mock_server() {
    let (base_url, captured) = serve_once(r#"{"text":"integration transcript"}"#);
    let client = OpenAiTranscribeClient::new(&base_url, Some("test-key".to_string()));

    // 0.25 s of a 440 Hz sine — real bytes through the WAV encoder + multipart.
    let pcm: Vec<i16> = (0..4000)
        .map(|i| {
            ((i as f32 * 440.0 * std::f32::consts::TAU / 16_000.0).sin() * 0.5 * i16::MAX as f32)
                as i16
        })
        .collect();
    let mut request = SttRequest::from_pcm(pcm.clone());
    request.language = Some("en".to_string());
    let text = client
        .transcribe_pcm(request)
        .await
        .expect("transcription must succeed");
    assert_eq!(text, "integration transcript");

    let captured = captured
        .recv_timeout(Duration::from_secs(10))
        .expect("mock server must receive the request");
    assert_eq!(captured.method, "POST");
    assert_eq!(captured.path, "/audio/transcriptions");
    assert_eq!(captured.header("authorization"), Some("Bearer test-key"));

    let content_type = captured
        .header("content-type")
        .expect("multipart content-type");
    assert!(
        content_type.starts_with("multipart/form-data; boundary="),
        "expected multipart/form-data with boundary, got: {content_type}"
    );

    // The multipart body: file part named audio.wav, model, response_format, language.
    assert!(captured.body_contains(b"name=\"file\"; filename=\"audio.wav\""));
    assert!(captured.body_contains(b"Content-Type: audio/wav"));
    assert!(captured.body_contains(b"RIFF"));
    assert!(captured.body_contains(b"name=\"model\""));
    assert!(captured.body_contains(b"whisper-1"));
    assert!(captured.body_contains(b"name=\"response_format\""));
    assert!(captured.body_contains(b"json"));
    assert!(captured.body_contains(b"name=\"language\""));
    // 44-byte WAV header + 2 bytes/sample must be present in the body.
    let body_len = captured.body.len();
    assert!(
        body_len > 44 + pcm.len() * 2,
        "body must contain the full WAV payload, got {body_len}"
    );
}

#[tokio::test]
async fn model_override_is_forwarded() {
    let (base_url, captured) = serve_once(r#"{"text":"ok"}"#);
    let client = OpenAiTranscribeClient::new(&base_url, None).with_model("whisper-large-v3-turbo");
    let request = SttRequest::from_pcm(vec![0; 1600]);
    let _ = client
        .transcribe_pcm(request)
        .await
        .expect("transcription must succeed");
    let captured = captured.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(captured.body_contains(b"whisper-large-v3-turbo"));
}

#[tokio::test]
async fn http_error_maps_to_provider_error() {
    let (base_url, _captured) =
        common::serve_once_with(401, "Unauthorized", r#"{"error":"bad api key"}"#);
    let client = OpenAiTranscribeClient::new(&base_url, Some("wrong-key".to_string()));
    let request = SttRequest::from_pcm(vec![0; 1600]);
    let err = client
        .transcribe_pcm(request)
        .await
        .expect_err("401 must fail");
    match err {
        SttError::Provider { status, body } => {
            assert_eq!(status, 401);
            assert!(body.contains("bad api key"));
        }
        other => panic!("expected SttError::Provider, got {other:?}"),
    }
}

#[tokio::test]
async fn empty_pcm_is_rejected_before_network() {
    let (base_url, captured) = serve_once(r#"{"text":"ok"}"#);
    let client = OpenAiTranscribeClient::new(&base_url, None);
    let err = client
        .transcribe_pcm(SttRequest::from_pcm(vec![]))
        .await
        .expect_err("empty PCM must be rejected");
    assert!(matches!(err, SttError::Config(_)));
    // The mock server should never have been contacted.
    assert!(captured.recv_timeout(Duration::from_millis(500)).is_err());
}

#[tokio::test]
async fn missing_text_field_is_protocol_error() {
    let (base_url, _captured) = serve_once(r#"{"unexpected": true}"#);
    let client = OpenAiTranscribeClient::new(&base_url, None);
    let err = client
        .transcribe_pcm(SttRequest::from_pcm(vec![0; 1600]))
        .await
        .expect_err("missing text field must fail");
    assert!(matches!(err, SttError::Protocol(_)));
}
