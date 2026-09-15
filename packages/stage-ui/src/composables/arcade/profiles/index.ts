import type { ArcadeProfile } from '../../../types/arcade'

export const simCityProfile: ArcadeProfile = {
  id: 'simcity',
  name: 'SimCity (DOS Classic)',
  matchGame: (titleOrId: string) => {
    const s = titleOrId.toLowerCase()
    return s.includes('simcity') || s.includes('sim city')
  },
  systemPromptAddendum: `## SIMCITY (DOS) SPATIAL & STRATEGIC GUIDE:
- Layout:
  - Left Tool Palette (X: 15 to 110): Contains construction tools stacked vertically:
    • Bulldozer (top)
    • Road (paves transport routes)
    • Power Line / Wire (connects zones to electricity)
    • Residential Zone 'R' (homes)
    • Commercial Zone 'C' (stores / businesses)
    • Industrial Zone 'I' (factories / jobs)
    • Police & Fire Departments
    • Stadium & Park
    • Seaport & Airport
    • Power Plants (Coal / Nuclear)
  - Center/Right Map Viewport (X: 130 to 980, Y: 50 to 950): The isometric terrain where building occurs.
  - Top Bar: City Name, Funds ($), Date, and Speed indicators.
  - Bottom Status / Demand: R-C-I indicator bars (Green R, Blue C, Yellow I).
- Core Strategy:
  1. If fresh map with zero power: First select Coal Power Plant from tool palette, place it on the map.
  2. Run power lines from power plant toward flat land.
  3. Lay roads in grids or loops.
  4. Place Residential (R), Commercial (C), and Industrial (I) zones adjacent to roads and powered lines.
  5. Always observe the R-C-I demand bars to know what the city currently needs.
- Coordinate Norm: Return normalized coordinates [0, 1000] for clicking tool icons and map tiles.`,
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
