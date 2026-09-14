# Discord Gateway & Connected Surfaces

![Discord Gateway & Connected Surfaces](/showcase/hero-10-discord-surfaces.avif)

The **Discord Gateway & Connected Surfaces** subsystem bridges AIRI directly into Discord servers, group chats, and direct messages. Featuring dual execution targets — **Local PC Gateway** and **Cloudflare Workers 24/7 Edge Relay** — it enables characters to participate in text and voice channels, analyze image attachments via VLM, and run autonomously around the clock without keeping your desktop on.

---

## Dual Execution: Local Gateway vs Cloud Relay

![Discord Bot Connection Deck](/showcase/discord-bot-connection.avif)

AIRI supports two distinct deployment modes based on your infrastructure needs:
- **Local (This PC) Mode**: The bot connects directly from your desktop app. Commands and voice audio route through your local LLM and TTS pipeline, with immediate sync to your active desktop stage.
- **Cloud Relay Studio**: Deploys a stateless, 24/7 character instance to Cloudflare Workers with Edge KV memory. Your companion responds on Discord even when your computer is shut down.

![Cloud Relay Studio & Cloudflare Edge Engine](/showcase/discord-cloud-relay-studio.avif)

---

## Access & Channel Routing Matrix

![Access & Context Routing Table](/showcase/discord-access-routing-table.avif)

Granular routing controls ensure characters only speak when and where intended:
- **Global Fallback Modes**: Strict Deny Unassigned, Shared Fallback Character, or Isolated Memory Fallback.
- **Per-Channel Character Mapping**: Bind specific character cards to individual channels (`#general`, `#gaming`, `#lounge`) with dedicated trigger rules (Mentions only vs All messages).
- **Owner Security & DM Isolation**: Restricts administrative commands to authorized Discord user IDs.

---

## 1-Click Cloudflare Edge Deployment

AIRI includes a guided wizard to package and publish characters to Cloudflare Workers:

### Step 1: Session History Seeding

![Edge Deployment: Session Selection Modal](/showcase/discord-cloudflare-deploy-modal.avif)

- Select which local conversation timeline seeds the character's cloud memory, ensuring conversational continuity between desktop and Discord.

### Step 2: Edge Configuration & Prompt Preview

![Edge Deployment: Configuration Modal](/showcase/discord-cloudflare-config-modal.avif)

- Configure root subdomain handles (`character.workers.dev`).
- Choose edge-optimized models (Cloudflare Workers AI, OpenRouter, DeepSeek).
- Live preview of the assembled system prompt with Discord formatting directives and tool capabilities.

---

## Key Capabilities

- **Dual Target Execution**: Seamless switching between Local Desktop Gateway and 24/7 Cloudflare Edge Workers.
- **Per-Channel Routing Table**: Map different characters and memory pools to specific server channels.
- **VLM Image Intake**: Analyzes user image uploads and screenshots shared in Discord chat.
- **1-Click Edge Deployment**: Automated bundle compilation and publishing to Cloudflare Workers.
- **Interactive Simulation Sandbox**: Test bot replies and channel directives inside settings before going live.
- **Owner Authorization Matrix**: Strict permission gates protecting companion settings from unauthorized users.
