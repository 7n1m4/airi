# Stage-Mate External Asset Sources & Provenance Manifest

This document records the exact provenance, sources, and original repository locations for third-party Unity Asset Store packages removed from the repository during open-source licensing hygiene.

If these assets are ever needed again for local development or custom builds, they can be acquired from the original sources listed below.

---

## 1. Modern Guns - Handgun (by Nokobot)

* **Package Name**: Modern Guns - Handgun (v1.2)
* **Author / Publisher**: Nokobot
* **Unity Asset Store URL**: [Modern Guns Pack](https://assetstore.unity.com/packages/3d/props/guns/modern-guns-pack-63076)
* **Support Email**: `Support@nokobot.com`
* **Website**: `http://assets.nokobot.net/unity` / `https://nokobot.com`
* **Original Repository Paths**:
  - `apps/stage-mate/unity-src/Assets/Gunslinger/Nokobot/`
  - `apps/stage-mate/unity-src/Assets/Gunslinger/Nokobot.meta`
  - `apps/stage-mate/unity-src/Assets/Resources/Gunslinger/M1911 Handgun_Black (Shooting).prefab`
  - `apps/stage-mate/unity-src/Assets/Resources/Gunslinger/M1911 Handgun_Silver (Shooting).prefab`
* **Original Asset Contents**:
  - `M1911 Handgun.fbx` (1,479 Tris, 2048px PBR textures: Albedo, MetallicSmoothness, Normal)
  - `M1911 Magazine.fbx` (84 Tris, 1024px textures)
  - `45ACP Bullet.fbx` (136 Tris, 512px textures)
  - `SimpleShoot.cs` (C# shoot & casing release controller)
  - Muzzle flash particle effect and shooting animation (`M1911@Fire.anim`)
  - Universal Render Pipeline (URP) materials package (`ModernGuns_Handgun_v1.2_URP.unitypackage`)
* **Code Integration**:
  - Referenced in `apps/stage-mate/unity-src/Patches/AvatarHandlers/AvatarMouseTracking.cs` via optional `Resources.Load<GameObject>("Gunslinger/M1911...")`. If absent, the engine falls back to `Gunslinger/Cat Gun Shooting` or empty list without throwing errors.

---

## 2. Low Poly Animals FREE

* **Package Name**: Low Poly Animals - FREE (`animals_free.unitypackage`)
* **Package GUID**: `52922c72bb67af34e90f3a901710cc57`
* **Unity Asset Store**: Search for "Low Poly Animals FREE" on the Unity Asset Store.
* **Original Repository Paths**:
  - `apps/stage-mate/unity-src/Assets/Gunslinger/Animals_FREE/`
  - `apps/stage-mate/unity-src/Assets/Gunslinger/Animals_FREE.meta`
  - `apps/stage-mate/unity-src/Assets/Gunslinger/animals_free.unitypackage.meta`
* **Original Asset Contents**:
  - Low-poly FBX animal models:
    - `Chicken_001.fbx`
    - `Deer_001.fbx`
    - `Dog_001.fbx`
    - `Horse_001.fbx`
    - `Kitty_001.fbx`
    - `Pinguin_001.fbx`
    - `Tiger_001.fbx`
  - Shared palette texture (`Texture.png`) and material (`Color.mat`).
  - Overview demo scene (`Overview.unity`).
* **Code Integration**:
  - Standalone decorative demo assets with zero runtime C# script dependencies in StageMate.
