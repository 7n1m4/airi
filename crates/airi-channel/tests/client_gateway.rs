// SPDX-License-Identifier: GPL-3.0-or-later

//! Integration test for the blocking gateway client. Spins the real server
//! on an ephemeral port and checks the Rust client can authenticate, call
//! read-only RPCs, and fail authentication cleanly.

use std::sync::Arc;

use airi_channel::{get_or_create_certs, tls_server_config};
use airi_channel::{ChannelConfig, ChannelServer, GatewayClient, GatewayClientError};

const TOKEN: &str = "client-gateway-test-token";

fn start_server() -> airi_channel::ServerHandle {
    let config = ChannelConfig {
        hostname: "127.0.0.1".to_string(),
        auth_token: TOKEN.to_string(),
        tls_config: None,
    };
    ChannelServer::bind("127.0.0.1", 0, &config)
        .expect("bind channel server")
        .spawn()
        .expect("spawn channel server")
}

#[test]
fn plain_ws_client_round_trip() {
    let handle = start_server();
    let port = handle.port();
    let mut client = GatewayClient::connect(&format!("ws://127.0.0.1:{port}/ws"), None)
        .expect("connect to channel server");

    client.authenticate(TOKEN).expect("authenticate");
    let ping = client.runtime_ping().expect("runtime.ping");
    assert!(ping.pong);
    assert!(ping.time > 0);
    let status = client.runtime_status().expect("runtime.status");
    assert_eq!(status.protocol, "airi-channel/1");
    assert_eq!(status.app, "airi-slint");
    assert!(status.uptime_seconds < 3600);

    client.close().expect("close gateway");
    handle.stop();
}

#[test]
fn bad_token_is_rejected_as_authentication_error() {
    let handle = start_server();
    let port = handle.port();
    let mut client = GatewayClient::connect(&format!("ws://127.0.0.1:{port}/ws"), None)
        .expect("connect to channel server");

    let err = client
        .authenticate("definitely-not-the-token")
        .expect_err("bad token must fail");
    assert!(
        matches!(err, GatewayClientError::Authentication { ref code, .. } if code == "invalid_token"),
        "expected invalid_token authentication error, got {err:?}"
    );

    handle.stop();
}

#[test]
fn wss_client_round_trip_with_generated_ca() {
    airi_channel::install_default_crypto_provider();
    let dir = tempfile::tempdir().expect("cert dir");
    let bundle = get_or_create_certs(
        dir.path(),
        &airi_channel::san_domains(&["localhost".to_string()]),
    )
    .expect("mint certs");
    let tls =
        Arc::new(tls_server_config(&bundle.cert_pem, &bundle.key_pem).expect("server config"));
    let config = ChannelConfig {
        hostname: "127.0.0.1".to_string(),
        auth_token: TOKEN.to_string(),
        tls_config: None,
    };
    let server =
        ChannelServer::bind_tls("127.0.0.1", 0, &config, tls).expect("bind TLS channel server");
    let server = server.spawn().expect("spawn TLS channel server");
    let port = server.port();

    let mut client = GatewayClient::connect(
        &format!("wss://localhost:{port}/ws"),
        Some(bundle.ca_cert_pem.as_bytes()),
    )
    .expect("connect over wss");
    client.authenticate(TOKEN).expect("authenticate over wss");
    let ping = client.runtime_ping().expect("runtime.ping over wss");
    assert!(ping.pong);

    client.close().expect("close TLS gateway");
    server.stop();
}
