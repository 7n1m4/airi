export type GameEngineType = 'jsdos' | 'html5-canvas' | 'emulator'

export interface GameActionClick {
  type: 'click'
  x: number // Normalized 0-1000
  y: number // Normalized 0-1000
  label?: string
  button?: 'left' | 'right' | 'middle'
}

export interface GameActionDrag {
  type: 'drag'
  fromX: number // Normalized 0-1000
  fromY: number // Normalized 0-1000
  toX: number // Normalized 0-1000
  toY: number // Normalized 0-1000
  label?: string
}

export interface GameActionKeyPress {
  type: 'key_press'
  key: string // e.g. "ArrowUp", "Enter", "Space", "y"
  durationMs?: number
  label?: string
}

export interface GameActionTypeText {
  type: 'type_text'
  text: string
  label?: string
}

export interface GameActionWait {
  type: 'wait'
  durationMs: number
  label?: string
}

export type GameAction
  = | GameActionClick
    | GameActionDrag
    | GameActionKeyPress
    | GameActionTypeText
    | GameActionWait

export interface TurnPlan {
  plan: string
  spoken_commentary: string
  emotion?: string // e.g. 'excited', 'smug', 'thoughtful', 'worried', 'focused'
  actions: GameAction[]
  executed?: boolean
}

export type TurnState = 'idle' | 'capturing' | 'thinking' | 'executing' | 'interrupted'

export interface CursorState {
  visible: boolean
  x: number // Normalized 0-1000
  y: number // Normalized 0-1000
  activeActionLabel?: string
  clicking: boolean
  pinging: boolean
}

export interface GameAdapter {
  id: string
  title: string
  engine: GameEngineType
  captureFrame: () => Promise<string | null> // Returns data URL or null
  getCanvasElement: () => HTMLCanvasElement | null
  executeClick: (normX: number, normY: number, button?: 'left' | 'right' | 'middle') => Promise<void>
  executeDrag?: (fromNormX: number, fromNormY: number, toNormX: number, toNormY: number) => Promise<void>
  executeKeyPress: (key: string, durationMs?: number) => Promise<void>
  executeTypeText: (text: string) => Promise<void>
  duckAudio?: (duck: boolean) => void
}

export interface ArcadeProfile {
  id: string
  name: string
  matchGame: (titleOrId: string) => boolean
  systemPromptAddendum: string
}

// ==========================================
// 5-Stage Guided Studio Architecture Types
// ==========================================

export type ArcadeStudioStage = 'hub' | 'provisioning' | 'calibration' | 'review' | 'arena'

export type ScreenMotionArchitecture
  = | 'fixed_single_screen'
    | 'flip_screen_rooms'
    | 'smooth_scrolling_camera'
    | 'first_person_or_3d'
    | 'static_ui_or_turn_based'

export type RecommendedSystem
  = | 'system1_reflex'
    | 'system2_strategy'
    | 'system2_narrative'
    | 'unsupported_utility'

export type GameplayPace
  = | 'turn_based'
    | 'real_time_calm'
    | 'real_time_fast'
    | 'real_time_intense'

export type PrimaryController
  = | 'keyboard_only'
    | 'mouse_only'
    | 'hybrid_keyboard_mouse'
    | 'gamepad_compatible'

export type CompanionPersonaPreset
  = | 'hype_coach'
    | 'strategic_advisor'
    | 'zen_co_pilot'
    | 'snarky_backseater'
    | 'methodical_tactician'

export type System1EngineChoice = 'laya_local' | 'jev_cloud' | 'disabled'

export interface ArcadeProvisioningConfig {
  system1Engine: System1EngineChoice
  system2Model: string
  companionPersona: CompanionPersonaPreset
  commentaryVerbosity?: 'quiet' | 'balanced' | 'chatty'
}

// Mini-Program Synthesizer Spec
export type MiniProgramAction = 'up' | 'down' | 'left' | 'right' | 'space' | 'enter' | 'none'

export interface MiniProgramDefinition {
  id: string
  gameId: string
  version: number
  code: string // Complete executable JS body: `function evaluateGameState(prevFrame, currFrame, telemetry): Action`
  inputSpec: {
    keys: string[]
    intervalMs: number
  }
  detectedGrid?: {
    rows: number
    cols: number
    cellSize: number
  }
  playerColor?: string
  targetColor?: string
}

export interface CalibrationTelemetryTrace {
  timestamp: number
  durationMs: number
  framesCaptured: number
  keyEvents: Array<{
    key: string
    timestamp: number
    type: 'down' | 'up'
  }>
  motionEntropy: number
  identifiedArchitecture: ScreenMotionArchitecture
}

export interface AcquiredGameKnowledge {
  gameId: string
  gameTitle: string
  acquiredAt: number
  lastPlayedAt: number
  motionArchitecture: ScreenMotionArchitecture
  recommendedSystem: RecommendedSystem
  gameplayPace: GameplayPace
  primaryGenre?: string
  primaryController?: PrimaryController
  persona: CompanionPersonaPreset
  system1Engine: System1EngineChoice
  system2Model?: string
  strategySummary: string
  rulesAddendum?: string
  miniProgram?: MiniProgramDefinition
  calibrationTrace?: CalibrationTelemetryTrace
  playCount: number
  highScore?: number
}

export interface CatalogGameClassification {
  recommended_system?: RecommendedSystem
  screen_motion_architecture?: ScreenMotionArchitecture
  gameplay_pace?: GameplayPace
  primary_genre?: string
  primary_controller?: PrimaryController
  companion_role?: string
}

export interface CatalogGame {
  identifier: string
  title: string
  year?: number | string
  downloads?: number
  description?: string
  thumbnailUrl?: string
  bundleUrl?: string
  isCached?: boolean
  hasAcquiredKnowledge?: boolean
  classification?: CatalogGameClassification
}
