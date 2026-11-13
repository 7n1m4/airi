---
title: Configuring the AIRI Gateway
description: How the local WebSocket gateway works, where the authentication token lives, and how to pair external companion apps.
---

# Configuring the AIRI Gateway

The **AIRI Gateway** is a local WebSocket server on port `6121` that lets external clients — VS Code extensions, custom Python scripts, and (soon) the unified Rust native app — securely connect, stream audio, and interact with your AIRI instance.

On Linux, the gateway is hosted by the **AIRI daemon** (`airi-daemon`, D-Bus name `org.moeru.airi.Daemon1`); the desktop app connects to it as a thin client and does not bind the port itself. On other platforms, the desktop app hosts the gateway in-process ("in-app fallback"). Behavior is the same; only ownership differs.

:::warning
The old **Stage Pocket** (Android/iOS Capacitor app) was purged in November 2026 and no longer exists. Pairing instructions below apply to any client that implements the AIRI gateway wire protocol (`airi-gateway` / `airi-channel`).
:::

---

## 1. Gateway Security & Authentication

The gateway enforces a mandatory authentication handshake on every connection. A client that does not authenticate receives nothing and is closed with code `1008`.

### Application Gateway Key (Auth Token)

On first run the daemon generates a strong random token. Any client connecting must pass it as `authToken` in the WebSocket initialization handshake.

### Finding Your Gateway Token

1. **Settings UI**: open **Settings → System → Connection**. The **Auth Token** field holds the client-side copy the settings page uses.
2. **Daemon-hosted (Linux)**: `<data>/airi-slint/server-channel/config.json` — read the `"authToken"` field (file is `0600`).
3. **In-app fallback (macOS/Windows)**: `<userData>/server-channel-config.json` — same `"authToken"` field.

### Rotating the Gateway Token

Rotating invalidates all previously paired clients; each must re-pair.

- **Linux (daemon)**: `busctl --user call org.moeru.airi.Daemon1 /org/moeru/airi/Daemon1 org.moeru.airi.Daemon1 RegenerateGatewayToken`
- **In-app fallback**: restart the app after deleting the `authToken` line from `server-channel-config.json`; a fresh token is minted on next boot.

---

## 2. Hostname Binding & LAN Pairing

Loopback is the safe default. Binding beyond loopback forces TLS with a locally minted CA — plaintext WebSocket is never served to the network.

| Binding Address | Access Scope | Security Level |
| :--- | :--- | :--- |
| `127.0.0.1` *(Default)* | Local PC only | **High** |
| `0.0.0.0` | Local network (LAN) | **Required: `wss://`** — daemon mints a local CA; clients must install/trust `websocket-ca-cert.pem` (CA distribution UX is not finalized) |

:::note
Changing the hostname/TLS mode is a daemon Apply operation (`ApplyGatewayConfig` on `org.moeru.airi.Daemon1`). The settings page derives its WebSocket URL from the daemon-reported flag; a blank **WebSocket URL** field means "derive from gateway settings".
:::

### Pairing a Custom Client on Your LAN

1. Set the daemon hostname to `0.0.0.0` (via the settings page or `ApplyGatewayConfig` with a new `hostname`).
2. Export/install the CA certificate the daemon reports (`caCertPath`) on the client machine.
3. Point the client at `wss://<your-PC-IP>:6121/ws` with your **Gateway Auth Token**.
