//! stage-qt: native Qt Quick 3D VRM desktop-pet renderer for AIRI.
//!
//! Rust core (VRM parsing, skeleton, springbones, expressions, lip-sync,
//! stage protocol) + QML scene + a thin C++ shell (`src/cpp/`) for the
//! Qt Quick 3D pieces cxx-qt cannot express from Rust.

// SPDX-License-Identifier: GPL-3.0-or-later

#![deny(missing_docs)]

pub mod cxxqt_object;
pub mod protocol;
pub mod vrm;

use cxx_qt::casting::Upcast;
use cxx_qt_lib::{QGuiApplication, QQmlApplicationEngine, QQmlEngine, QUrl};
use std::pin::Pin;
use std::process::ExitCode;

/// Command-line + environment configuration.
#[derive(Debug, Default)]
pub struct Cli {
    /// WebSocket URL of the AIRI stage server.
    pub ws_url: String,
    /// Auth token for `module:authenticate`.
    pub token: String,
    /// Optional local VRM path to load standalone.
    pub model: Option<String>,
}

impl Cli {
    /// Parse `--ws-url`, `--token`, `--model` (and `STAGE_QT_WS_URL` env).
    /// Unknown flags are ignored (AIRI spawns us with only `--token`).
    pub fn parse(args: impl Iterator<Item = String>) -> Self {
        let mut cli = Cli::default();
        let mut it = args.peekable();
        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--ws-url" => {
                    if let Some(v) = it.next() {
                        cli.ws_url = v;
                    }
                }
                "--token" => {
                    if let Some(v) = it.next() {
                        cli.token = v;
                    }
                }
                "--model" => {
                    if let Some(v) = it.next() {
                        cli.model = Some(v);
                    }
                }
                _ if arg.starts_with("--ws-url=") => {
                    cli.ws_url = arg["--ws-url=".len()..].to_string();
                }
                _ if arg.starts_with("--token=") => {
                    cli.token = arg["--token=".len()..].to_string();
                }
                _ if arg.starts_with("--model=") => {
                    cli.model = Some(arg["--model=".len()..].to_string());
                }
                _ => {}
            }
        }
        if cli.ws_url.is_empty() {
            cli.ws_url = std::env::var("STAGE_QT_WS_URL")
                .unwrap_or_else(|_| "ws://127.0.0.1:6171".to_string());
        }
        if cli.token.is_empty() {
            // Mirrors the stage-mate harness default: the production server
            // accepts this dev token or the token from server-channel-config.
            cli.token = std::env::var("AIRI_AUTH_TOKEN")
                .or_else(|_| std::env::var("MATE_AUTH_TOKEN"))
                .unwrap_or_else(|_| "mate-stage-dev-token".to_string());
        }
        cli
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse(std::env::args().skip(1));

    let mut app = QGuiApplication::new();
    let mut engine = QQmlApplicationEngine::new();

    if let Some(engine) = engine.as_mut() {
        engine.load(&QUrl::from(
            "qrc:/qt/qml/com/airi/stageqt/qml/Main.qml",
        ));
    }

    if let Some(engine) = engine.as_mut() {
        let engine: Pin<&mut QQmlEngine> = engine.upcast_pin();
        engine
            .on_quit(|_| {
                eprintln!("[stage-qt] QML quit");
            })
            .release();
    }

    let ws_url = cli.ws_url.clone();
    let token = cli.token.clone();
    let standalone = cli.model.clone();

    // Stage client lives on its own tokio runtime (spawned thread) so the Qt
    // event loop stays free. Inbound messages are logged here in step 2;
    // later steps dispatch them into the scene/engines.
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
        {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[stage-qt] failed to build tokio runtime: {e}");
                return;
            }
        };
        if let Some(path) = standalone {
            eprintln!("[stage-qt] standalone model: {path}");
        }
        rt.block_on(protocol::socket::run(ws_url, token, |msg| {
            eprintln!("[stage-qt] rx {}: {}", msg.r#type, {
                match msg.effective_data() {
                    Some(d) => d.to_string(),
                    None => String::new(),
                }
            });
        }));
    });

    eprintln!("[stage-qt] starting, ws-url={} model={:?}", cli.ws_url, cli.model);

    if let Some(app) = app.as_mut() {
        app.exec();
    }
    ExitCode::SUCCESS
}
