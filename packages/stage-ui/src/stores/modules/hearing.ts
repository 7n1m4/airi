// NOTICE: Phase 0A split — this module is a backward-compatible barrel only.
// Store DEFINITIONS live in single-store files so Pinia HMR IDs never collide:
// - useHearingStore -> ./hearing-store
// - useHearingSpeechInputPipeline -> ./hearing-speech-input-pipeline
// New code must import from the leaf paths; this barrel stays so the existing
// ~20 importers across stage-ui/stage-pages/tamagotchi/web/pocket keep working
// without a flag-day rename. See docs/project-hmr-resilience-architecture.md.
export * from './hearing-speech-input-pipeline'
export * from './hearing-store'
