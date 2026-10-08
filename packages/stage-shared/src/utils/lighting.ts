export interface Vector3Like {
  x: number
  y: number
  z: number
}

export interface DirectionalOrbitOptions {
  /**
   * Center target point in world coordinates that the light aims at.
   * Defaults to { x: 0, y: 1.0, z: 0 } (typical avatar chest/head level).
   */
  target?: Vector3Like
  /**
   * Distance of the directional light source from the target.
   * Defaults to 3.0.
   */
  distance?: number
}

/**
 * Computes spherical position and target coordinates for a directional light
 * orbiting around an avatar.
 *
 * - rotation.x: Pitch in degrees (e.g. > 0 raises light higher above avatar, < 0 lowers it)
 * - rotation.y: Yaw in degrees (e.g. > 0 orbits right, < 0 orbits left)
 * - At rotation (0, 0), the light originates in front (+Z) of the avatar, illuminating the front face.
 */
export function computeDirectionalLightOrbit(
  rotation: { x: number, y: number },
  options: DirectionalOrbitOptions = {},
): { position: Vector3Like, target: Vector3Like } {
  const target = options.target ?? { x: 0, y: 1.0, z: 0 }
  const distance = options.distance ?? 3.0

  const radX = (rotation.x * Math.PI) / 180
  const radY = (rotation.y * Math.PI) / 180

  // Spherical coordinate computation with +Z forward as baseline:
  // x = target.x + dist * cos(pitch) * sin(yaw)
  // y = target.y + dist * sin(pitch)
  // z = target.z + dist * cos(pitch) * cos(yaw)
  const x = target.x + distance * Math.cos(radX) * Math.sin(radY)
  const y = target.y + distance * Math.sin(radX)
  const z = target.z + distance * Math.cos(radX) * Math.cos(radY)

  return {
    position: {
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      z: Number(z.toFixed(4)),
    },
    target: {
      x: target.x,
      y: target.y,
      z: target.z,
    },
  }
}
