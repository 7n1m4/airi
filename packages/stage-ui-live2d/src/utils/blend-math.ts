/**
 * Evaluates Live2D Cubism parameter blend modes: Add, Multiply, and Overwrite.
 *
 * @param baseVal Current baseline value of the parameter
 * @param rawVal Target value specified in the expression (.exp3.json)
 * @param intensity Multiplier (0.0 - 1.0, default 1.0)
 * @param blend Blend mode ('Add' | 'Multiply' | 'Overwrite')
 * @returns Evaluated parameter value
 */
export function evaluateLive2dBlend(
  baseVal: number,
  rawVal: number,
  intensity: number = 1,
  blend: string = 'Overwrite',
): number {
  if (blend === 'Add') {
    return baseVal + (rawVal * intensity)
  }
  if (blend === 'Multiply') {
    return baseVal * (rawVal * intensity)
  }
  return rawVal * intensity
}
