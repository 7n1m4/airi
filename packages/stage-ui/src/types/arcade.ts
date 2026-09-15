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
