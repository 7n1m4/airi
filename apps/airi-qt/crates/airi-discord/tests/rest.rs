// SPDX-License-Identifier: GPL-3.0-or-later

//! Integration tests for `airi-discord` — all against a local mockito
//! server. No live network, no real Discord.

use std::time::Duration;

use airi_discord::{DiscordError, DiscordRestClient};
use mockito::{Matcher, Server, ServerGuard};
use serde_json::json;

const TOKEN: &str = "super-secret-bot-token";
const AUTH: &str = "Bot super-secret-bot-token";

fn client(server: &ServerGuard) -> DiscordRestClient {
    DiscordRestClient::with_base_url(TOKEN, server.url()).expect("client builds against mock")
}

#[test]
fn get_gateway_url_parses_canned_response() {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/gateway/bot")
        .match_header("authorization", AUTH)
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_header("x-ratelimit-remaining", "4")
        .with_header("x-ratelimit-reset-after", "1.5")
        .with_body(
            json!({
                "url": "wss://gateway.discord.gg",
                "shards": 1,
                "session_start_limit": {
                    "total": 1000,
                    "remaining": 999,
                    "reset_after": 14_400_000_u64,
                    "max_concurrency": 1
                }
            })
            .to_string(),
        )
        .create();

    let mut c = client(&server);
    let gw = c.get_gateway_url().expect("canned response parses");
    assert_eq!(gw.url, "wss://gateway.discord.gg");
    assert_eq!(gw.shards, 1);
    assert_eq!(gw.session_start_limit.total, 1000);
    assert_eq!(gw.session_start_limit.remaining, 999);
    assert_eq!(gw.session_start_limit.reset_after, 14_400_000);
    assert_eq!(gw.session_start_limit.max_concurrency, 1);

    // Rate-limit headers from the same response are captured.
    let rl = c.last_rate_limit().expect("rate limit captured");
    assert_eq!(rl.remaining, Some(4));
    assert_eq!(rl.reset_after, Some(Duration::from_secs_f64(1.5)));
}

#[test]
fn get_current_bot_user_parses() {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/users/@me")
        .match_header("authorization", AUTH)
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            json!({
                "id": "123456789012345678",
                "username": "airi-bot",
                "discriminator": "0",
                "display_name": "AIRI",
                "avatar": "a_abc123",
                "bot": true
            })
            .to_string(),
        )
        .create();

    let mut c = client(&server);
    let user = c.get_current_bot_user().expect("canned response parses");
    assert_eq!(user.id, "123456789012345678");
    assert_eq!(user.username, "airi-bot");
    assert_eq!(user.discriminator, "0");
    assert_eq!(user.display_name.as_deref(), Some("AIRI"));
    assert_eq!(user.avatar.as_deref(), Some("a_abc123"));
    assert!(user.bot);
}

#[test]
fn get_current_bot_user_tolerates_missing_optional_fields() {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/users/@me")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json!({ "id": "42", "username": "bare-bot" }).to_string())
        .create();

    let mut c = client(&server);
    let user = c.get_current_bot_user().expect("sparse response parses");
    assert_eq!(user.display_name, None);
    assert_eq!(user.avatar, None);
    assert_eq!(user.discriminator, "");
    assert!(!user.bot);
}

#[test]
fn send_message_posts_correct_body_and_bot_auth_header() {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/channels/987654321/messages")
        .match_header("authorization", AUTH)
        .match_header(
            "content-type",
            Matcher::Regex("^application/json".to_string()),
        )
        .match_body(Matcher::PartialJson(
            json!({ "content": "hello from airi" }),
        ))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            json!({
                "id": "111222333444555666",
                "channel_id": "987654321",
                "content": "hello from airi",
                "timestamp": "2026-11-11T09:30:00.000000+00:00"
            })
            .to_string(),
        )
        // Mock asserts on drop: if the body or auth header did not match,
        // the request would 501 and this test would fail.
        .create();

    let mut c = client(&server);
    let msg = c
        .send_message("987654321", "hello from airi")
        .expect("message sends");
    assert_eq!(msg.id, "111222333444555666");
    assert_eq!(msg.channel_id, "987654321");
    assert_eq!(msg.content, "hello from airi");
    assert_eq!(msg.timestamp, "2026-11-11T09:30:00.000000+00:00");
}

#[test]
fn send_message_percent_encodes_channel_id() {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/channels/a%2Fb%3Fc/messages")
        .match_body(Matcher::PartialJson(json!({ "content": "hi" })))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            json!({
                "id": "1",
                "channel_id": "a/b?c",
                "content": "hi",
                "timestamp": "2026-11-11T00:00:00.000000+00:00"
            })
            .to_string(),
        )
        .create();

    let mut c = client(&server);
    c.send_message("a/b?c", "hi").expect("segment is encoded");
}

#[test]
fn get_channel_parses_typed_channel() {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/channels/456")
        .match_header("authorization", AUTH)
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            json!({
                "id": "456",
                "type": 0,
                "name": "general",
                "topic": "the room where it happens",
                "position": 3
            })
            .to_string(),
        )
        .create();

    let mut c = client(&server);
    let ch = c.get_channel("456").expect("canned response parses");
    assert_eq!(ch.id, "456");
    assert_eq!(ch.channel_type, 0);
    assert_eq!(ch.name.as_deref(), Some("general"));
    assert_eq!(ch.topic.as_deref(), Some("the room where it happens"));
    assert_eq!(ch.position, Some(3));
}

#[test]
fn get_channel_tolerates_dm_shape_without_name() {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/channels/789")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json!({ "id": "789", "type": 1 }).to_string())
        .create();

    let mut c = client(&server);
    let ch = c.get_channel("789").expect("dm channel parses");
    assert_eq!(ch.channel_type, 1);
    assert_eq!(ch.name, None);
    assert_eq!(ch.topic, None);
    assert_eq!(ch.position, None);
}

#[test]
fn unauthorized_maps_to_unauthorized_variant() {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/users/@me")
        .with_status(401)
        .with_header("content-type", "application/json")
        .with_body(json!({ "message": "401: Unauthorized", "code": 0 }).to_string())
        .create();

    let mut c = client(&server);
    match c.get_current_bot_user() {
        Err(DiscordError::Unauthorized) => {}
        other => panic!("expected Unauthorized, got {other:?}"),
    }
}

#[test]
fn rate_limit_body_maps_to_typed_rate_limited() {
    let mut server = Server::new();
    let _mock = server
        .mock("POST", "/channels/123/messages")
        .with_status(429)
        .with_header("content-type", "application/json")
        .with_body(
            json!({
                "message": "You are being rate limited.",
                "retry_after": 2.5,
                "global": true
            })
            .to_string(),
        )
        .create();

    let mut c = client(&server);
    match c.send_message("123", "hi") {
        Err(DiscordError::RateLimited {
            retry_after,
            global,
        }) => {
            assert_eq!(retry_after, Duration::from_secs_f64(2.5));
            assert!(global);
        }
        other => panic!("expected RateLimited, got {other:?}"),
    }
}

#[test]
fn rate_limit_falls_back_to_header_when_body_has_no_retry_after() {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/gateway/bot")
        .with_status(429)
        .with_header("content-type", "application/json")
        .with_header("x-ratelimit-remaining", "0")
        .with_header("x-ratelimit-reset-after", "3.25")
        .with_body(json!({ "message": "You are being rate limited." }).to_string())
        .create();

    let mut c = client(&server);
    match c.get_gateway_url() {
        Err(DiscordError::RateLimited {
            retry_after,
            global,
        }) => {
            assert_eq!(retry_after, Duration::from_secs_f64(3.25));
            assert!(!global);
        }
        other => panic!("expected RateLimited, got {other:?}"),
    }
}

#[test]
fn server_error_maps_to_http_500() {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/channels/456")
        .with_status(500)
        .with_body("internal server error")
        .create();

    let mut c = client(&server);
    match c.get_channel("456") {
        Err(DiscordError::Http { status, message }) => {
            assert_eq!(status, 500);
            assert!(message.contains("internal server error"));
        }
        other => panic!("expected Http {{ status: 500, .. }}, got {other:?}"),
    }
}

#[test]
fn malformed_json_maps_to_decode() {
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/users/@me")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body("this is not json")
        .create();

    let mut c = client(&server);
    match c.get_current_bot_user() {
        Err(DiscordError::Decode(_)) => {}
        other => panic!("expected Decode, got {other:?}"),
    }
}

#[test]
fn debug_output_redacts_the_token() {
    let server = Server::new();
    let c = client(&server);
    let dbg = format!("{c:?}");
    assert!(
        dbg.contains("***"),
        "debug output should show a redaction marker: {dbg}"
    );
    assert!(
        !dbg.contains(TOKEN),
        "debug output must not leak the token: {dbg}"
    );
}

#[test]
fn error_display_never_contains_the_token() {
    // Even for a 401 with a hostile body, the Display string of the error
    // must not contain the token.
    let mut server = Server::new();
    let _mock = server
        .mock("GET", "/users/@me")
        .with_status(401)
        .with_body(format!("token was {TOKEN} oops"))
        .create();

    let mut c = client(&server);
    let err = c.get_current_bot_user().expect_err("must fail");
    let shown = format!("{err}");
    // Unauthorized deliberately discards the body; belt-and-braces check anyway.
    assert!(
        !shown.contains(TOKEN),
        "error display leaked the token: {shown}"
    );
}
