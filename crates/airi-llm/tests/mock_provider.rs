// SPDX-License-Identifier: GPL-3.0-or-later

//! Mock-server integration tests for the chat clients.
//!
//! Uses `mockito` to stand up an in-test HTTP provider. The SSE responses
//! exercise the incremental parser (partial lines, `\r\n`, provider-specific
//! frame shapes) end to end: `stream()` must surface typed deltas and the
//! terminal finish reason, and `models()` must parse each provider's wire
//! format.

use airi_llm::{
    build_client, ChatMessage, ChatRequest, LlmError, ProviderConfig, ProviderRegistry, Role,
};
use futures_util::StreamExt as _;
use mockito::{Matcher, Server};
use serde_json::json;

fn test_config(base_url: &str) -> ProviderConfig {
    ProviderConfig {
        api_key: Some("sk-test".into()),
        base_url: Some(base_url.into()),
        model: Some("test-model".into()),
        extra_json: serde_json::Map::new(),
    }
}

fn simple_request() -> ChatRequest {
    ChatRequest::new(
        "test-model",
        vec![ChatMessage {
            role: Role::User,
            content: "Say hi".into(),
            tool_call_id: None,
        }],
    )
}

async fn collect_text(
    stream: &mut airi_llm::ChatStream,
) -> (Vec<String>, Vec<String>, Vec<String>) {
    let mut deltas = Vec::new();
    let mut reasoning = Vec::new();
    let mut finishes = Vec::new();
    while let Some(item) = stream.next().await {
        let chunk = item.expect("stream item must be Ok");
        if !chunk.delta.is_empty() {
            deltas.push(chunk.delta);
        }
        if let Some(r) = chunk.reasoning {
            reasoning.push(r);
        }
        if let Some(f) = chunk.finish_reason {
            finishes.push(f);
        }
    }
    (deltas, reasoning, finishes)
}

#[tokio::test]
async fn openai_compatible_stream_emits_deltas_and_terminates_on_done() {
    let mut server = Server::new_async().await;
    let sse_body = concat!(
        "data: {\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Hello\"},\"finish_reason\":null}]}\n",
        "\n",
        "data: {\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" world\"},\"finish_reason\":null}]}\n",
        "\n",
        "data: {\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n",
        "\n",
        "data: [DONE]\n",
        "\n",
    );
    let mock = server
        .mock("POST", "/v1/chat/completions")
        .match_header("authorization", "Bearer sk-test")
        .match_body(Matcher::PartialJson(json!({
            "model": "test-model",
            "stream": true,
        })))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(sse_body)
        .create_async()
        .await;

    let reg = ProviderRegistry::new();
    let def = reg.get("openai-compatible").unwrap();
    let client = build_client(def, test_config(&format!("{}/v1", server.url()))).unwrap();

    let mut stream = client.stream(simple_request()).await.unwrap();
    let (deltas, _, finishes) = collect_text(&mut stream).await;

    assert_eq!(deltas, vec!["Hello", " world"]);
    assert_eq!(finishes, vec!["stop"]);
    mock.assert_async().await;
}

#[tokio::test]
async fn openai_compatible_stream_surfaces_reasoning_content() {
    let mut server = Server::new_async().await;
    let sse_body = concat!(
        "data: {\"id\":\"c1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"thinking\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"c1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"answer\"},\"finish_reason\":null}]}\n\n",
        "data: [DONE]\n\n",
    );
    let _mock = server
        .mock("POST", "/v1/chat/completions")
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(sse_body)
        .create_async()
        .await;

    let reg = ProviderRegistry::new();
    let def = reg.get("deepseek").unwrap();
    let client = build_client(def, test_config(&format!("{}/v1", server.url()))).unwrap();

    let mut stream = client.stream(simple_request()).await.unwrap();
    let (deltas, reasoning, _) = collect_text(&mut stream).await;

    assert_eq!(reasoning, vec!["thinking"]);
    assert_eq!(deltas, vec!["answer"]);
}

#[tokio::test]
async fn openai_compatible_models_parses_the_data_array() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/v1/models")
        .match_header("authorization", "Bearer sk-test")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            json!({
                "object": "list",
                "data": [
                    {"id": "model-a", "object": "model", "created": 1, "owned_by": "acme"},
                    {"id": "model-b", "object": "model", "created": 2, "owned_by": "acme"},
                ]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let reg = ProviderRegistry::new();
    let def = reg.get("openai-compatible").unwrap();
    let client = build_client(def, test_config(&format!("{}/v1", server.url()))).unwrap();

    let models = client.models().await.unwrap();
    let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, vec!["model-a", "model-b"]);
}

#[tokio::test]
async fn openai_compatible_provider_error_body_maps_to_provider_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("POST", "/v1/chat/completions")
        .with_status(401)
        .with_header("content-type", "application/json")
        .with_body(r#"{"error":{"message":"invalid api key"}}"#)
        .create_async()
        .await;

    let reg = ProviderRegistry::new();
    let def = reg.get("openai-compatible").unwrap();
    let client = build_client(def, test_config(&format!("{}/v1", server.url()))).unwrap();

    let err = match client.stream(simple_request()).await {
        Ok(_) => panic!("expected provider error"),
        Err(e) => e,
    };
    match err {
        LlmError::Provider(msg) => assert!(msg.contains("401"), "unexpected message: {msg}"),
        other => panic!("expected Provider error, got {other:?}"),
    }
}

#[tokio::test]
async fn anthropic_stream_emits_text_and_stop_reason() {
    let mut server = Server::new_async().await;
    let sse_body = concat!(
        "event: message_start\n",
        "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_mock\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-mock\",\"content\":[],\"stop_reason\":null,\"usage\":{\"input_tokens\":3,\"output_tokens\":1}}}\n",
        "\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n",
        "\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n",
        "\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" there\"}}\n",
        "\n",
        "event: content_block_stop\n",
        "data: {\"type\":\"content_block_stop\",\"index\":0}\n",
        "\n",
        "event: message_delta\n",
        "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\",\"stop_sequence\":null},\"usage\":{\"output_tokens\":2}}\n",
        "\n",
        "event: message_stop\n",
        "data: {\"type\":\"message_stop\"}\n",
        "\n",
    );
    let mock = server
        .mock("POST", "/v1/messages")
        .match_header("x-api-key", "sk-test")
        .match_header("anthropic-version", "2023-06-01")
        .match_body(Matcher::PartialJson(json!({
            "model": "test-model",
            "stream": true,
            "max_tokens": 4096,
        })))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(sse_body)
        .create_async()
        .await;

    let reg = ProviderRegistry::new();
    let def = reg.get("anthropic").unwrap();
    // Base URL override to point at the mock; path stays /v1/messages.
    let client = build_client(def, test_config(&format!("{}/v1", server.url()))).unwrap();

    let mut stream = client.stream(simple_request()).await.unwrap();
    let (deltas, _, finishes) = collect_text(&mut stream).await;

    assert_eq!(deltas, vec!["Hi", " there"]);
    assert_eq!(finishes, vec!["end_turn"]);
    mock.assert_async().await;
}

#[tokio::test]
async fn anthropic_models_parses_the_data_array() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/v1/models")
        .match_header("x-api-key", "sk-test")
        .match_header("anthropic-version", "2023-06-01")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            json!({
                "data": [
                    {"id": "claude-mock-1", "display_name": "Claude Mock 1", "created_at": "2024-10-22T00:00:00Z"},
                ],
                "has_more": false,
                "first_id": "claude-mock-1",
                "last_id": "claude-mock-1",
            })
            .to_string(),
        )
        .create_async()
        .await;

    let reg = ProviderRegistry::new();
    let def = reg.get("anthropic").unwrap();
    let client = build_client(def, test_config(&format!("{}/v1", server.url()))).unwrap();

    let models = client.models().await.unwrap();
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "claude-mock-1");
}

#[tokio::test]
async fn gemini_stream_emits_text_and_finish_reason() {
    let mut server = Server::new_async().await;
    let sse_body = concat!(
        "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"Hello\"}]},\"index\":0}],\"usageMetadata\":{\"promptTokenCount\":4,\"candidatesTokenCount\":1,\"totalTokenCount\":5}}\n",
        "\n",
        "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\" from gemini\"}]},\"index\":0}]}\n",
        "\n",
        "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"\"}]},\"finishReason\":\"STOP\",\"index\":0}]}\n",
        "\n",
    );
    let mock = server
        .mock(
            "POST",
            "/v1beta/models/test-model:streamGenerateContent?alt=sse",
        )
        .match_header("x-goog-api-key", "sk-test")
        .match_body(Matcher::PartialJson(json!({
            "contents": [{ "role": "user", "parts": [{ "text": "Say hi" }] }],
        })))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(sse_body)
        .create_async()
        .await;

    let reg = ProviderRegistry::new();
    let def = reg.get("google-generative-ai").unwrap();
    let client = build_client(def, test_config(&format!("{}/v1beta", server.url()))).unwrap();

    let mut req = simple_request();
    req.model = "test-model".into();
    let mut stream = client.stream(req).await.unwrap();
    let (deltas, _, finishes) = collect_text(&mut stream).await;

    assert_eq!(deltas, vec!["Hello", " from gemini"]);
    assert_eq!(finishes, vec!["STOP"]);
    mock.assert_async().await;
}

#[tokio::test]
async fn gemini_models_strips_the_models_prefix() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/v1beta/models")
        .match_header("x-goog-api-key", "sk-test")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            json!({
                "models": [
                    {"name": "models/gemini-mock-1", "displayName": "Gemini Mock 1", "inputTokenLimit": 1000000},
                ]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let reg = ProviderRegistry::new();
    let def = reg.get("google-generative-ai").unwrap();
    let client = build_client(def, test_config(&format!("{}/v1beta", server.url()))).unwrap();

    let models = client.models().await.unwrap();
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "gemini-mock-1");
}

#[tokio::test]
async fn unsupported_providers_report_unsupported_at_call_time() {
    let reg = ProviderRegistry::new();
    for id in [
        "amazon-bedrock",
        "laya-local",
        "openjev-local",
        "typesafe-ai",
    ] {
        let def = reg.get(id).unwrap();
        let client = build_client(def, ProviderConfig::default()).unwrap();

        let models_err = client.models().await.unwrap_err();
        assert!(
            matches!(models_err, LlmError::UnsupportedProvider(_)),
            "{id}: expected UnsupportedProvider, got {models_err:?}"
        );

        let stream_err = match client.stream(simple_request()).await {
            Ok(_) => panic!("expected unsupported-provider error"),
            Err(e) => e,
        };
        assert!(
            matches!(stream_err, LlmError::UnsupportedProvider(_)),
            "{id}: expected UnsupportedProvider, got {stream_err:?}"
        );
    }
}

#[tokio::test]
async fn ollama_builds_without_api_key() {
    let reg = ProviderRegistry::new();
    let def = reg.get("ollama").unwrap();
    // No api_key in config; local providers must build fine.
    let client = build_client(
        def,
        ProviderConfig {
            api_key: None,
            base_url: Some("http://127.0.0.1:11434/v1".into()),
            model: Some("llama3".into()),
            extra_json: serde_json::Map::new(),
        },
    )
    .unwrap();
    assert_eq!(client.id(), "ollama");
}

#[tokio::test]
async fn openai_compatible_request_carries_typed_tools() {
    let mut server = Server::new_async().await;
    let sse_body = "data: [DONE]\n\n";
    let mock = server
        .mock("POST", "/v1/chat/completions")
        .match_body(Matcher::PartialJson(json!({
            "tools": [{
                "type": "function",
                "function": {
                    "name": "get_time",
                    "description": "Get the current time",
                    "parameters": { "type": "object", "properties": {} },
                },
            }],
        })))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(sse_body)
        .expect(1)
        .create_async()
        .await;

    let reg = ProviderRegistry::new();
    let def = reg.get("openai-compatible").unwrap();
    let client = build_client(def, test_config(&format!("{}/v1", server.url()))).unwrap();

    let mut req = simple_request();
    req.tools = vec![airi_llm::ToolSpec::new(
        "get_time",
        "Get the current time",
        r#"{"type":"object","properties":{}}"#,
    )];
    let mut stream = client.stream(req).await.unwrap();
    let (deltas, _, _) = collect_text(&mut stream).await;
    assert!(deltas.is_empty());
    mock.assert_async().await;
}

#[tokio::test]
async fn invalid_tool_schema_fails_before_any_request() {
    let reg = ProviderRegistry::new();
    let def = reg.get("openai-compatible").unwrap();
    let client = build_client(def, test_config("http://127.0.0.1:1/v1")).unwrap();

    let mut req = simple_request();
    req.tools = vec![airi_llm::ToolSpec::new("bad_tool", "Broken", "{not json")];
    let err = match client.stream(req).await {
        Ok(_) => panic!("expected InvalidConfig"),
        Err(e) => e,
    };
    assert!(matches!(err, LlmError::InvalidConfig(_)));
}
