import type { ArcadeProfile } from '../../../types/arcade'

export const simCityProfile: ArcadeProfile = {
  id: 'simcity',
  name: 'SimCity (DOS Classic)',
  matchGame: (titleOrId: string) => {
    const s = titleOrId.toLowerCase()
    return s.includes('simcity') || s.includes('sim city')
  },
  systemPromptAddendum: `## SIMCITY (DOS CLASSIC) FACTUAL INTERFACE & TOOLBAR GROUNDING:
- Left Tool Palette (2 Columns x 7 Rows):
  - Column 1 (Left, ~X: 45) | Column 2 (Right, ~X: 85):
    • Row 1 (~Y: 125): Bulldozer ($1) (Clears rubble/trees/land) | Road ($10) (Paved transport)
    • Row 2 (~Y: 165): Power Lines ($5) (Carries power across tiles) | Rail ($20) (High capacity transit)
    • Row 3 (~Y: 205): Park ($10) (Boosts land value) | Residential Zone ($100) (3x3 'R' housing)
    • Row 4 (~Y: 245): Commercial Zone ($100) (3x3 'C' stores) | Industrial Zone ($100) (3x3 'I' factories/jobs)
    • Row 5 (~Y: 285): Police Dept ($500) (Reduces crime) | Fire Dept ($500) (Controls fires)
    • Row 6 (~Y: 325): Stadium ($3,000) (Recreation) | Seaport ($3,000) (Waterfront commerce)
    • Row 7 (~Y: 365): Airport ($10,000) (Air commerce) | Power Plant (Coal $3,000 / Nuclear $5,000)
- Essential City Mechanics:
  • Power Plants: Clicking the Power Plant icon (Row 7, Right) allows building Coal or Nuclear plants (4x4 tiles).
  • Zones (R, C, I): Standard zones are 3x3 tiles. They require road access and electricity to develop.
  • Power Distribution: Connected zones conduct electricity among touching neighbors. Wires are needed across open ground.
  • Active Tool Feedback: The bottom-left blue status line shows the currently selected tool name and price.
  • Status & Demands: Top message bar displays Funds ($), Date, and citizen alerts. The R-C-I meter indicates demand.
- Main Map Viewport: The playable terrain canvas spans roughly X: 140 to 970, Y: 110 to 920.
- Normalized Coordinates: Return coordinates in the range [0, 1000] (0 = top/left, 1000 = bottom/right).`,
}

export const game2048Profile: ArcadeProfile = {
  id: '2048',
  name: '2048 (Number Tile Merge)',
  matchGame: (titleOrId: string) => {
    const s = titleOrId.toLowerCase()
    return s.includes('2048')
  },
  systemPromptAddendum: `## 2048 PUZZLE STRATEGY GUIDE:
- Layout: 4x4 grid of numeric tiles.
- Actions: Keyboard swipes using Arrow keys ('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight').
- Optimal Strategy:
  1. Choose a primary anchor corner (typically Bottom-Left or Top-Left).
  2. Keep your highest value tile locked in that anchor corner at all times.
  3. Never swipe in the opposite direction of your corner anchor unless forced with zero valid moves.
  4. Chain consecutive descending numbers along the outer wall (e.g. 128 -> 64 -> 32 -> 16).
  5. Choose the single best swipe direction for the current state.`,
}

export const genericTurnBasedProfile: ArcadeProfile = {
  id: 'generic',
  name: 'Generic Turn-Based & Point-and-Click',
  matchGame: () => true,
  systemPromptAddendum: `## GAMEPLAY INTERACTION GUIDELINES:
- Carefully inspect the active game screenshot.
- Identify menus, dialogue options, HUD elements, unit selections, or board coordinates.
- Calculate normalized coordinates [0, 1000] for mouse clicks (X: 0 = left edge, 1000 = right edge; Y: 0 = top edge, 1000 = bottom edge).
- When keyboard controls are required, use standardized key names ('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space', 'Escape', 'y', 'n').
- Keep commentary authentic, entertaining, and in-character.`,
}

export const arcadeProfiles: ArcadeProfile[] = [
  simCityProfile,
  game2048Profile,
  genericTurnBasedProfile,
]

export function resolveArcadeProfile(gameTitleOrId: string): ArcadeProfile {
  return arcadeProfiles.find(p => p.matchGame(gameTitleOrId)) || genericTurnBasedProfile
}
