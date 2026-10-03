/**
 * Speech segment playback bridge (cross-window).
 *
 * Re-exported here (rather than imported from `services/speech/bus` directly)
 * because this `libs/*` surface is what downstream apps resolve. The host
 * (ControlStripHost) posts per-slice audio-start events; thin clients
 * (rehearsal room, actor stage) subscribe to release held cues at the exact
 * spoken moment. See `services/speech/bus.ts` for the bus contract.
 */
export {
  getSpeechBusContext,
  speechSegmentPlaybackEvent,
} from '../../services/speech/bus'
export type { SpeechSegmentPlaybackPayload } from '../../services/speech/bus'
