# Documentation Archive

This directory contains historical handoffs, point-in-time model reviews, completed upstream sync reports, and resolved bug investigations staged for review.

| Document | Category | Context / Notes |
| :--- | :--- | :--- |
| `[[project-hmr-resilience-sol-review]]` | Model Review Snapshot | Point-in-time review notes from Sol on HMR architecture. |
| `[[project-hmr-resilience-kimi-review]]` | Model Review Snapshot | Point-in-time review notes from Kimi on HMR architecture. |
| `[[project-provider-store-phase1-handoff]]` | Completed Phase Handoff | Phase 1 safe restructuring handoff report. |
| `[[project-provider-store-phase2-handoff]]` | Completed Phase Handoff | Phase 2 lifecycle decomposition handoff report. |
| `[[project-provider-store-phase3-handoff]]` | Completed Phase Handoff | Phase 3 multi-instance engine handoff report. |
| `[[project-provider-store-phase4-handoff]]` | Completed Phase Handoff | Phase 4 Provider Studio UI handoff report. |
| `[[project-provider-store-phase5-handoff]]` | Completed Phase Handoff | Phase 5 defensive recovery handoff report. |
| `[[handoff-live2d-dsl-phase2]]` | Completed Phase Handoff | Phase 2 Live2D DSL handoff report. |
| `[[project-upstream-sync-alpha15-alpha22]]` | Historical Upstream Sync Log | Old upstream alpha.15 -> alpha.22 sync log. |
| `[[project-upstream-sync-alpha15-alpha22-v2]]` | Historical Upstream Sync Log | Old upstream alpha.15 -> alpha.22 (Take 2) sync log. |
| `[[project-upstream-sync-report-alpha22-to-latest]]` | Historical Upstream Sync Log | Historical alpha.22 -> latest sync report. |
| `[[project-squat-1622-report]]` | Historical Upstream Sync Log | Historical PR #1622 squatting report. |
| `[[project-selective-upstream-sync-phase-a-buy-in]]` | Historical Upstream Sync Log | Historical Phase A buy-in memo. |
| `[[project-selective-upstream-sync-phase-b-buy-in]]` | Historical Upstream Sync Log | Historical Phase B buy-in memo. |
| `[[project-selective-upstream-sync-p1-file-manifest]]` | Historical Upstream Sync Log | Historical P1 file manifest. |
| `[[bugfix-apply-btn-race]]` | Resolved Bug Report | Resolved model disappearance race condition report. |
| `[[journal-the-reasoning-content-bug]]` | Resolved Bug Report | Resolved DeepSeek reasoning_content speech bug post-mortem. |
| `[[linux-wayland-chat-cpu-spikes]]` | Resolved Bug Report | Resolved Linux Wayland CPU spike diagnostic memo. |
| `[[pr-summary]]` | Historical Upstream Sync Log | Upstream PR snapshot (#1861-#1895). |
| `[[proposal-onboarding-overhaul]]` | Superseded Proposal | Historical Post-V2 Advanced Setup Lab proposal superseded and unified into `[[project-onboarding-modernize]]`. |
| `[[AIRI-Mind-Map-Design-Review]]` | Model Review Snapshot | Point-in-time peer review (2026-09-24) of the Mind Map visualization proposals; living design in `design-mind-map.md`. |
| `[[architecture-chat-orchestrator-decomposition]]` | Completed Phase Handoff | Chat orchestrator decomposition plan, all phases 0–5 verified complete. |
| `[[design-actor-token-sync-postmortem]]` | Model Review Snapshot | Root-cause validation review of `design-journal-actor-token-sync.md`; the design doc it validated stays in production docs. |
| `[[design-expression-emoji-mapping]]` | Deprecated / Shelved | Early Control Strip expression popover, deprecated in favor of ModelCustomizer; kept for redesign context. |
| `[[design-tamagotchi-chatbox-ux-improvements]]` | Completed Plan | Finalized UX improvement checklist, items executed. |
| `[[orbital-settings-topology-handoff]]` | Completed Phase Handoff | Handoff for the Orbital Settings Topology playground build. |
| `[[project-positioning-store-migration]]` | Completed Phase Handoff | Positioning store migration plan with progress log; migration shipped. |
| `[[proposal-acting-sidebar]]` | Implemented Proposal | Rehearsal Room sidebar proposal; shipped — referenced as live by `proposal-ninja-swap-interceptor.md`. |
| `[[sentence-sync-streaming-tts-architecture-review]]` | Model Review Snapshot | Architecture review verdict on `design-contextual-streaming-tts-and-sentence-sync.md`. |
| `[[project-mobile-revamp]]` | Superseded Proposal | Capacitor web-tech mobile purged 2026-11-13; replacement is the unified Rust native app (`proposal-unified-rust-native-app.md`). |

## `qt-port/` — the Qt Quick port (2026, superseded by the Slint port)

The full dated build log of the Qt Quick desktop port: architecture decisions,
lane handoffs, audits and the MMD/Spine renderer work. The crate was renamed
`crates/airi-qt` → `crates/airi-slint` and retargeted from Qt6/cxx-qt to Slint
on 2026-11-13; the QML tree and the cxx-qt bridges were deleted. These notes
describe the port as it was built, so they stay here as the record.

Current state lives in `docs/port-manifest/` and `crates/airi-slint/`.
