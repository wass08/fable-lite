# Fable lite 🐔⚡🔥

A tiny Fable-inspired sandbox built with **Three.js WebGPU renderer** and **TSL** (Three Shading Language). Fling fireballs, call down lightning, and — most importantly — kick chickens into the stratosphere.

**▶ Play now: https://wass08.github.io/fable-lite/**

(Chrome/Edge get WebGPU; everywhere else falls back to WebGL2. Works on phones too.)

## Play

```bash
npm install
npm run dev          # add --host to open it on your phone over the LAN
```

### Desktop

| Input | Action |
| --- | --- |
| Mouse | Aim — the cursor places the target reticle on the ground |
| Right-drag | Orbit the camera (yaw + pitch) |
| Wheel | Zoom in / out |
| W A S D | Move (camera-relative) |
| Shift | Sprint (drains stamina) |
| Ctrl | Dodge roll (i-frames, costs stamina) |
| Left click | Cast the selected spell at the cursor |
| 1 / 2 / 3 | Select Fireball / Lightning / Earth |
| F or Space | Kick (stand close to a chicken, face it) |

### Mobile

Left joystick moves (push to the edge to sprint), drag the world to orbit the camera,
tap to cast at that spot, the 🌀 button rolls, and tapping a spell icon switches spells.

Punt distance is tracked — chase the record. Spell hits are **lethal**: blasted chickens die where they land — and every death calls in reinforcements from the meadow's edge. The more you kill, the bigger the flock (capped at 56). Chickens come in four sizes, from the classic up to the colossus — big ones fly shorter when punted, peck harder, and reach farther.

**Beware the flock's wrath.** Every act of chicken violence is remembered. Punt enough birds and nearby chickens turn — red glowing eyes, full sprint, pecking at your shins. Dodge-roll through them, fight back, or get pecked to death.

## Tech

- **Terrain**: CPU value-noise heightfield (`heightAt`) displacing a 200×200 plane — rolling meadows, distant hills crowned with an instanced horizon forest; everything (walkers, projectiles, decals, camera) samples it
- **Collisions**: `three-mesh-bvh` — capsule shapecast vs a merged static collider (trunks/rocks/pillars) for the wizard, BVH `raycastFirst` for fireballs, BVH-accelerated terrain picking for the cursor
- **Camera**: real third-person mouse-look — pointer lock, yaw/pitch orbit, A/D strafe with the wizard facing the camera heading, crosshair aim onto the terrain (cursor-aim fallback where pointer lock is unavailable)
- **No-hitch FX**: pooled scorch decals, shockwaves, and a fixed pool of 8 point lights (adding/removing lights forces shader rebuilds) — every pipeline pre-warmed with silent casts below the map at load

- `three/webgpu` `WebGPURenderer`, 4K PCF-soft shadows, ACES tone mapping
- **TSL post-processing** (`THREE.PostProcessing`): HDR bloom → tonemap → vignette → FXAA
- **TSL node materials**:
  - ground — layered fractal noise: lush/meadow/dry/dirt patches + micro-shading
  - fireball — scrolling fractal fire noise (HDR, feeds the bloom)
  - lightning core — time-driven flicker pulse
  - grass — 12,000 instanced curved blades, two-frequency wind via `positionNode`, per-instance hue from `instanceIndex`
  - scorch decals — noise-shaped splats that burn away with a glowing dissolve front (per-decal `uniform` progress)
  - rocks/ruins — procedural moss on upward faces (`normalWorld`), trees — world-space canopy color noise
  - staff crystal — pulsing emissive that follows the selected spell color, flashes on cast
  - sky dome — gradient + sun disc + drifting fractal-noise clouds
- **Juice**: trauma-based camera shake, hit-stop on impacts, slow-mo on multi-chicken blasts and record punts, muzzle flashes, chicken white hit-flash, dust puffs on bounces, squash & stretch on the kick, floating combat text
- **UI**: Cinzel/Crimson Pro RPG HUD — radial cooldown sweeps on circular spell slots, mana bar with deny shake, animated toasts, glass panels
- **Trees & foliage**: [ez-tree](https://github.com/dgreenheck/ez-tree) procedural trees — 5 generated variants (oak/ash/aspen presets) **fully instanced** into ~10 draw calls for 220+ trees (46 collidable in the meadow + a dense treeline on the hills) plus 24 instanced bushes; its GLSL leaf wind is WebGL-only, so leaves get a TSL `positionNode` sway (per-instance phase) + faked up-normals for even canopy lighting. Bare `three` imports are aliased to `three/webgpu` so ez-tree and the addons share one copy
- **Grass, rocks & flowers**: the GLB assets from the ez-tree example app — 14k instanced textured grass tufts with noise patchiness, TSL wind and per-instance green tinting; 3 draco-compressed rock models instanced across meadow and hills; GLB flower clones
- **Audio**: [howler.js](https://howlerjs.com) sound banks round-robin the recorded variations in `public/sfx` with per-play pitch/volume jitter (kicks, chicken hits, spell explosions, mage kill-taunts, ambient clucking); the fireball carries a looping flight whoosh; `public/music/main-theme.mp3` loops under play, swells during combat, and ducks under the death sting
- Mana economy: fireball 12 / earth 24 / lightning 32, regenerating 17 per second; stamina for sprint + roll; health with regen after 5s
- Chicken revenge AI: flock-wide wrath counter recruits nearby birds into red-eyed attackers that chase and peck
- Procedural everything: wizard (robe, hat, beard, staff with crystal), chickens, trees, rocks, ruins — zero external assets
- Hand-rolled physics (gravity, bounces, blast impulses) and WebAudio-synthesized SFX

## Smoke test

With the dev server running on port 5199:

```bash
npm run dev -- --port 5199 &
npm run smoke
```

Boots the game headless in Chromium (WebGPU enabled), casts both spells, punts a chicken, asserts the score increments, and fails on any console error. Screenshots land in `scripts/`.
