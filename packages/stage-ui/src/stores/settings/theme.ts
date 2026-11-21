import { useLocalStorageManualReset } from '@proj-anima/stage-shared/composables'
import { converter } from 'culori'
import { defineStore } from 'pinia'

export const DEFAULT_THEME_COLORS_HUE = 220.44
export const DEFAULT_THEME_COLORS_CHROMA_MULTIPLIER = 1.0

const convert = converter('oklch')
export const getHueFrom = (color?: string) => color ? convert(color)?.h : DEFAULT_THEME_COLORS_HUE

export function getEffectiveChroma(hue: number, multiplier = 1.0) {
  return (0.18 + Math.cos((hue * Math.PI) / 180) * 0.04) * multiplier
}

export const useSettingsTheme = defineStore('settings-theme', () => {
  const themeColorsHue = useLocalStorageManualReset<number>('settings/theme/colors/hue', DEFAULT_THEME_COLORS_HUE)
  const themeColorsHueDynamic = useLocalStorageManualReset<boolean>('settings/theme/colors/hue-dynamic', false)
  const themeColorsChromaMultiplier = useLocalStorageManualReset<number>('settings/theme/colors/chroma-multiplier', DEFAULT_THEME_COLORS_CHROMA_MULTIPLIER)

  function setThemeColorsHue(hue = DEFAULT_THEME_COLORS_HUE) {
    themeColorsHue.value = hue
    themeColorsHueDynamic.value = false
  }

  function setThemeColorsChromaMultiplier(multiplier = DEFAULT_THEME_COLORS_CHROMA_MULTIPLIER) {
    themeColorsChromaMultiplier.value = Math.max(0, Math.min(2.0, multiplier))
  }

  function applyPrimaryColorFrom(color?: string, multiplier?: number) {
    setThemeColorsHue(getHueFrom(color))
    if (typeof multiplier === 'number') {
      setThemeColorsChromaMultiplier(multiplier)
    }
  }

  /**
   * Check if a color is currently selected based on its hue value
   * @param hexColor Hex color code to check
   * @returns True if the color's hue matches the current theme hue
   */
  function isColorSelectedForPrimary(hexColor?: string) {
    // If dynamic coloring is enabled, no preset color is manually selected
    if (themeColorsHueDynamic.value)
      return false

    // Convert hex color to OKLCH
    const h = getHueFrom(hexColor)
    if (h === undefined || h === null)
      return false

    // Compare hue values with a tolerance for floating point / gamut conversion
    const hueDifference = Math.abs(h - themeColorsHue.value)
    return hueDifference < 1.5 || hueDifference > 358.5
  }

  function resetState() {
    themeColorsHue.reset()
    themeColorsHueDynamic.reset()
    themeColorsChromaMultiplier.reset()
  }

  return {
    themeColorsHue,
    themeColorsHueDynamic,
    themeColorsChromaMultiplier,
    setThemeColorsHue,
    setThemeColorsChromaMultiplier,
    applyPrimaryColorFrom,
    isColorSelectedForPrimary,
    resetState,
  }
})
