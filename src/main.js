import * as THREE from 'three/webgpu';
import {
  pass, renderOutput, screenUV, uniform, uv, time, sin, smoothstep, fract, atan,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import nipplejs from 'nipplejs';
import { buildWorld, heightAt, terrainNormal } from './world.js';
import { Player } from './player.js';
import { ChickenManager } from './chickens.js';
import { SpellManager } from './spells.js';
import { Pickups } from './pickups.js';
import { SFX } from './sfx.js';
import { UI } from './ui.js';

// phones: a 3×-DPI screen at the desktop pixel ratio plus a 4096² shadow map
// and the bloom chain is a memory/fillrate cliff. Cap harder on coarse pointers.
const IS_MOBILE = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
await renderer.init();
const backendName = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (fallback)';
console.log(`Fable lite — backend: ${backendName}`);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 700);

// --- juice: camera shake + hit-stop / slow-mo ---
const fx = {
  trauma: 0,
  timeScale: 1,
  _tsTimer: 0,
  shake(amount) { this.trauma = Math.min(1.1, this.trauma + amount); },
  hitStop(duration = 0.08, scale = 0.05) { this.timeScale = scale; this._tsTimer = duration; },
  slowMo(duration = 0.7, scale = 0.3) { this.timeScale = scale; this._tsTimer = duration; },
  update(rawDt) {
    if (this._tsTimer > 0) {
      this._tsTimer -= rawDt;
      if (this._tsTimer <= 0) this.timeScale = 1;
    }
    this.trauma = Math.max(0, this.trauma - rawDt * 1.5);
  },
};

const ui = new UI();
const sfx = new SFX();
const world = await buildWorld(scene, { mobile: IS_MOBILE });
const player = new Player(scene);
const chickens = new ChickenManager(scene, 24);
chickens.obstacles = world.obstacles;
player.onDeathLand = () => chickens.feathers.puff(player.position, 8);
const spells = new SpellManager(scene, chickens, ui, sfx, fx, world.collider);
const pickups = new Pickups(scene);

let camYaw = 0;
let camPitch = 0.72;

// --- post-processing: motion blur -> HDR bloom -> ACES tonemap -> vignette -> FXAA ---
const postProcessing = new THREE.PostProcessing(renderer);
postProcessing.outputColorTransform = false;
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode();
// rotation-driven motion blur: symmetric taps along the camera's angular velocity
const blurVecU = uniform(new THREE.Vector2(0, 0));
const BLUR_TAPS = 7;
let blurAcc = null;
for (let i = 0; i < BLUR_TAPS; i++) {
  const w = i / (BLUR_TAPS - 1) - 0.5;
  const tap = sceneColor.sample(screenUV.add(blurVecU.mul(w)));
  blurAcc = blurAcc ? blurAcc.add(tap) : tap;
}
const blurredScene = blurAcc.div(BLUR_TAPS);
const bloomNode = bloom(sceneColor, 0.55, 0.35, 0.82);
const graded = renderOutput(blurredScene.add(bloomNode));
const vignette = screenUV.sub(0.5).length().mul(1.25).pow(2.4).mul(0.42).oneMinus();
postProcessing.outputNode = fxaa(graded.mul(vignette));

// --- aim reticle: arcane magic circle, color follows the selected spell ---
const aimColorU = uniform(new THREE.Color(0xffaa33));
const aimMat = new THREE.MeshBasicNodeMaterial({
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
});
{
  const c = uv().sub(0.5).mul(2);
  const r = c.length();
  const ang = atan(c.y, c.x).div(Math.PI * 2); // -0.5..0.5 turns
  const outer = smoothstep(0.035, 0.012, r.sub(0.94).abs());
  const dashes = smoothstep(0.5, 0.45, fract(ang.mul(10).sub(time.mul(0.35))).sub(0.5).abs());
  const midRing = smoothstep(0.06, 0.02, r.sub(0.72).abs()).mul(dashes);
  const innerDashes = smoothstep(0.5, 0.42, fract(ang.mul(18).add(time.mul(0.55))).sub(0.5).abs());
  const innerRing = smoothstep(0.045, 0.015, r.sub(0.48).abs()).mul(innerDashes);
  const glow = smoothstep(0.5, 0.0, r).mul(0.18);
  const pulse = sin(time.mul(3.5)).mul(0.12).add(0.88);
  aimMat.colorNode = aimColorU.mul(1.9);
  aimMat.opacityNode = outer.add(midRing).add(innerRing).add(glow).mul(pulse);
}
const aimRing = new THREE.Mesh(new THREE.CircleGeometry(1.15, 48), aimMat);
aimRing.frustumCulled = false;
aimRing.renderOrder = 3;
scene.add(aimRing);

// --- input state ---
const keys = new Set();
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true; // BVH accelerated
const aimPoint = new THREE.Vector3(5, 0, 5);
let selectedSpell = 'fireball';
let started = false;

const COOLDOWN_MAX = { fireball: 0.45, lightning: 1.1, earth: 1.4, kick: 0.45 };
const cooldowns = { fireball: 0, lightning: 0, earth: 0, kick: 0 };
const MANA_COST = { fireball: 12, lightning: 32, earth: 24 };
const stats = {
  mana: 100, manaMax: 100, manaRegen: 4, // slow — potions are the real refill
  stamina: 100, staminaMax: 100, exhausted: false,
  health: 100, healthMax: 100, sinceHurt: 99,
};

const SPELL_COLORS = { fireball: 0xffaa33, lightning: 0x7fb4ff, earth: 0x9a7b4f };

function selectSpell(name) {
  selectedSpell = name;
  ui.selectSpell(name);
  aimColorU.value.setHex(SPELL_COLORS[name]);
  player.setSpellColor(SPELL_COLORS[name]);
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === '1') selectSpell('fireball');
  if (k === '2') selectSpell('lightning');
  if (k === '3') selectSpell('earth');
  if (k === 'f' || k === ' ') kick();
  if (k === 'control') roll();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
// WoW-style controls: the cursor always aims at the ground; holding the
// right button drags the camera orbit
const ORBIT_SENS = 0.005;
let orbitDrag = null;

window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return; // touch has its own drag/tap handling
  if (orbitDrag && e.pointerId === orbitDrag.id) {
    camYaw -= (e.clientX - orbitDrag.x) * ORBIT_SENS;
    camPitch = Math.min(1.2, Math.max(0.38, camPitch + (e.clientY - orbitDrag.y) * ORBIT_SENS));
    orbitDrag.x = e.clientX;
    orbitDrag.y = e.clientY;
  }
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') return;
  if (e.button === 2) {
    orbitDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    renderer.domElement.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0 || !started) return;
  cast();
});
window.addEventListener('pointerup', (e) => {
  if (orbitDrag && e.pointerId === orbitDrag.id) orbitDrag = null;
});

// --- touch: drag on the world orbits the camera, a quick tap casts there ---
let pendingCast = false;
let touchDrag = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  touchDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
});
window.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch' || !touchDrag || e.pointerId !== touchDrag.id) return;
  const dx = e.clientX - touchDrag.x;
  const dy = e.clientY - touchDrag.y;
  touchDrag.moved += Math.abs(dx) + Math.abs(dy);
  camYaw -= dx * 0.006;
  camPitch = Math.min(1.2, Math.max(0.38, camPitch + dy * 0.006));
  touchDrag.x = e.clientX;
  touchDrag.y = e.clientY;
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'touch' || !touchDrag || e.pointerId !== touchDrag.id) return;
  const tap = performance.now() - touchDrag.t < 350 && touchDrag.moved < 14;
  touchDrag = null;
  if (tap && started) {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    pendingCast = true; // cast next tick, after the aim raycast sees the new pointer
  }
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function spendMana(cost) {
  if (stats.mana < cost) {
    ui.denyMana();
    ui.insufficientMana();
    sfx.tone({ type: 'square', from: 140, to: 90, duration: 0.15, gain: 0.12 });
    return false;
  }
  stats.mana -= cost;
  return true;
}

function onPickup(kind) {
  if (kind === 'mana') {
    stats.mana = Math.min(stats.manaMax, stats.mana + 40);
    floatTextAt(player.position, '+40 MANA', 'mana');
    sfx.pickupMana();
  } else {
    stats.health = Math.min(stats.healthMax, stats.health + 35);
    floatTextAt(player.position, '+35 HEALTH', 'heal');
    sfx.pickupHealth();
  }
}

function cast() {
  if (player.isRolling || cooldowns[selectedSpell] > 0) return;
  if (!spendMana(MANA_COST[selectedSpell])) return;
  cooldowns[selectedSpell] = COOLDOWN_MAX[selectedSpell];
  player.startCast();
  if (selectedSpell === 'fireball') spells.castFireball(player.castOrigin(), aimPoint);
  else if (selectedSpell === 'lightning') spells.castLightning(aimPoint.clone());
  else if (selectedSpell === 'earth') spells.castEarth(aimPoint.clone());
}

function roll() {
  if (!started || player.isRolling || stats.stamina < 15) return;
  // roll where the player is steering; fall back to facing when standing still
  const dir = moveWorld.lengthSq() > 0.0001
    ? moveWorld.clone().normalize()
    : player.forward();
  if (player.startRoll(dir)) {
    stats.stamina = Math.max(0, stats.stamina - 20);
    sfx.roll();
  }
}

function kick() {
  if (!started || cooldowns.kick > 0 || player.isRolling) return;
  cooldowns.kick = COOLDOWN_MAX.kick;
  player.startKick();
  ui.flashKick();
  sfx.kick();
  const fwd = player.forward();
  const victim = chickens.nearest(player.position, 2.3, (c) => {
    if (c.state === 'flying') return false;
    const to = c.position.clone().sub(player.position).setY(0).normalize();
    return to.dot(fwd) > 0.25; // roughly in front
  });
  if (victim) {
    const dir = victim.position.clone().sub(player.position).setY(0).normalize();
    victim.launch(new THREE.Vector3(dir.x * 13, 8.5, dir.z * 13), player.position, false);
    chickens.feathers.burst(victim.position.clone().add(new THREE.Vector3(0, 0.4, 0)), 12);
    sfx.kickHit();
    sfx.chickenHit();
    fx.shake(0.4);
    fx.hitStop(0.09, 0.02);
    chickens.provoke(1, player.position);
    ui.toast(['BWOK!!', 'POULTRY IN MOTION!', 'HEN SOLO!', 'CLUCK THIS!'][Math.floor(Math.random() * 4)]);
  }
}

const _proj = new THREE.Vector3();
function floatTextAt(worldPos, text, cls) {
  _proj.copy(worldPos).y += 1;
  _proj.project(camera);
  if (_proj.z > 1) return;
  ui.floatText(text, (_proj.x * 0.5 + 0.5) * window.innerWidth, (-_proj.y * 0.5 + 0.5) * window.innerHeight, cls);
}

function onChickenLanded(chicken, dist) {
  if (dist < 2) return;
  const record = ui.addKick(dist);
  floatTextAt(chicken.position, `${dist.toFixed(1)} m`, record ? 'record' : '');
  if (record) {
    ui.toast(`PUNTED ${dist.toFixed(1)} m — NEW RECORD!`, true);
    fx.slowMo(0.5, 0.35);
  }
}

function onPeck(chicken) {
  if (player.isRolling) return; // rolled clean through the ambush
  if (!started || stats.health <= 0) return; // already down — one death is enough
  // gentler per-peck damage — the whole flock attacks at once now
  stats.health = Math.max(0, stats.health - Math.round(2 + 2 * chicken.size));
  stats.sinceHurt = 0;
  ui.hurt();
  sfx.peck();
  fx.shake(0.15);
  if (stats.health <= 0) die();
}

const KILL_TOASTS = { 5: 'THE FLOCK STIRS…', 15: 'THE FLOCK GROWS ANGRIER', 30: 'THEY ARE LEGION', 50: 'CLUCKPOCALYPSE' };

function onKamikaze(chicken) {
  spells.explode(chicken.position.clone());
  floatTextAt(chicken.position, 'BAWK-BOOM!', 'zap');
  const d = chicken.position.distanceTo(player.position);
  if (started && stats.health > 0 && !player.isRolling && d < 4.2) {
    stats.health = Math.max(0, stats.health - Math.round(26 * (1 - d / 4.2) + 6));
    stats.sinceHurt = 0;
    ui.hurt();
    fx.shake(0.6);
    if (stats.health <= 0) die();
  }
}

function onChickenKilled(chicken) {
  ui.addSlain();
  sfx.tauntKill();
  floatTextAt(chicken.position, '+1 SLAIN', 'zap');
  chickens.provoke(2, chicken.position);
  // loot: mana flasks are common, health flasks a rare blessing
  const r = Math.random();
  if (r < 0.08) pickups.spawn('health', chicken.position);
  else if (r < 0.45) pickups.spawn('mana', chicken.position);
  const toast = KILL_TOASTS[chickens.killCount];
  if (toast) ui.toast(toast, true);
}

function die() {
  if (!started) return; // several same-frame pecks must not stack death screens
  started = false;
  player.startDeath();
  fx.slowMo(1.2, 0.15);
  sfx.duckMusic();
  sfx.mageDie();
  ui.showDeath(() => {
    stats.health = stats.healthMax;
    stats.mana = stats.manaMax;
    stats.stamina = stats.staminaMax;
    stats.exhausted = false;
    chickens.calmAll();
    player.position.set(0, heightAt(0, 0), 0);
    player.revive();
    started = true;
    sfx.resumeMusic();
  });
}

// --- third-person camera: mouse-look orbit (yaw + pitch + wheel zoom) ---
let camDist = 11;
let camDistTarget = 11;
let camFollowY = 0;
window.addEventListener('wheel', (e) => {
  camDistTarget = Math.min(18, Math.max(4.5, camDistTarget + e.deltaY * 0.008));
}, { passive: true });
const camF = new THREE.Vector3();
const camR = new THREE.Vector3();
const moveWorld = new THREE.Vector3();
const aimNormal = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);

// x/z track the player rigidly — no rubber-band frame lag; only y eases,
// so the walk bob doesn't pump the camera
function placeCamera(dt) {
  camFollowY = dt === undefined
    ? player.position.y
    : camFollowY + (player.position.y - camFollowY) * (1 - Math.exp(-14 * dt));
  const cp = Math.cos(camPitch);
  const sp = Math.sin(camPitch);
  camera.position.set(
    player.position.x - Math.sin(camYaw) * cp * camDist,
    camFollowY + 2.6 + sp * camDist,
    player.position.z - Math.cos(camYaw) * cp * camDist,
  );
  const camFloor = heightAt(camera.position.x, camera.position.z) + 0.6;
  if (camera.position.y < camFloor) camera.position.y = camFloor;
  // look past the wizard, slightly low, so he sits in the lower half of the
  // frame and never hides a far-away cursor
  camera.lookAt(
    player.position.x + Math.sin(camYaw) * 3.5,
    camFollowY + 1.05,
    player.position.z + Math.cos(camYaw) * 3.5,
  );
}

placeCamera();

// --- sun shadow frustum follows the player, snapped to the shadow-map texel
// grid (in light space) so the edges never shimmer as it recenters ---
const SUN_DIR = new THREE.Vector3(30, 45, 18).normalize();
const SUN_RIGHT = new THREE.Vector3().crossVectors(SUN_DIR, new THREE.Vector3(0, 1, 0)).normalize();
const SUN_UP = new THREE.Vector3().crossVectors(SUN_RIGHT, SUN_DIR).normalize();
const SHADOW_TEXEL = 84 / world.shadowSize; // frustum width / map size
const _sunC = new THREE.Vector3();
function updateSunFollow() {
  const p = player.position;
  const r = Math.round(p.dot(SUN_RIGHT) / SHADOW_TEXEL) * SHADOW_TEXEL;
  const u = Math.round(p.dot(SUN_UP) / SHADOW_TEXEL) * SHADOW_TEXEL;
  _sunC.set(0, 0, 0)
    .addScaledVector(SUN_RIGHT, r)
    .addScaledVector(SUN_UP, u)
    .addScaledVector(SUN_DIR, p.dot(SUN_DIR));
  world.sun.target.position.copy(_sunC);
  world.sun.position.copy(_sunC).addScaledVector(SUN_DIR, 60);
}

const clock = new THREE.Clock();
const inputVec = { x: 0, z: 0 };
const touchMove = { x: 0, z: 0, force: 0 };
let ambienceTimer = 5;

// motion blur from yaw only — pitch is the aim-distance control when locked
// and must stay sharp. A dead zone keeps slow pans crisp; intensity ramps
// with rotation speed and only saturates on a real whip-pan.
let prevCamYaw = camYaw;
const blurTarget = new THREE.Vector2();
function updateMotionBlur(rawDt) {
  let dYaw = camYaw - prevCamYaw;
  dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
  prevCamYaw = camYaw;
  const speed = Math.abs(dYaw) / Math.max(rawDt, 1e-3); // rad/s
  const t = Math.min(1, Math.max(0, speed - 1.6) / 7);
  blurTarget.set(Math.pow(t, 1.6) * 0.05 * Math.sign(dYaw), 0);
  blurVecU.value.lerp(blurTarget, 1 - Math.exp(-14 * rawDt));
}

function tick() {
  const rawDt = Math.min(clock.getDelta(), 0.05);
  fx.update(rawDt);
  const dt = rawDt * fx.timeScale;

  for (const k in cooldowns) {
    cooldowns[k] = Math.max(0, cooldowns[k] - rawDt);
    ui.setCooldown(k, cooldowns[k] / COOLDOWN_MAX[k]);
  }

  // --- resources ---
  stats.mana = Math.min(stats.manaMax, stats.mana + stats.manaRegen * rawDt);
  stats.sinceHurt += rawDt;
  if (stats.sinceHurt > 5 && stats.health > 0) {
    stats.health = Math.min(stats.healthMax, stats.health + 3 * rawDt);
  }

  inputVec.x = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0) + touchMove.x;
  inputVec.z = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0) + touchMove.z;
  const moving = inputVec.x !== 0 || inputVec.z !== 0;

  // camera-relative movement (right = forward x up, screen-right)
  camF.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  camR.set(-camF.z, 0, camF.x);
  moveWorld.set(0, 0, 0).addScaledVector(camR, inputVec.x).addScaledVector(camF, -inputVec.z);

  // sprint drains stamina; hitting empty forces a breather until 25%
  if (stats.exhausted && stats.stamina > 25) stats.exhausted = false;
  const sprinting = (keys.has('shift') || touchMove.force > 0.92) && moving && !stats.exhausted && !player.isRolling;
  if (sprinting) {
    stats.stamina = Math.max(0, stats.stamina - 26 * rawDt);
    if (stats.stamina <= 0) stats.exhausted = true;
  } else {
    stats.stamina = Math.min(stats.staminaMax, stats.stamina + 16 * rawDt);
  }

  ui.setMana(stats.mana / stats.manaMax);
  ui.setHealth(stats.health / stats.healthMax);
  ui.setStamina(stats.stamina / stats.staminaMax);

  // aim: raycast the cursor onto the terrain (BVH-accelerated)
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(world.ground);
  if (hits.length) {
    aimPoint.copy(hits[0].point);
    const d = _proj.copy(aimPoint).sub(player.position).setY(0);
    if (d.length() > 40) {
      d.setLength(40);
      aimPoint.copy(player.position).add(d);
      aimPoint.y = heightAt(aimPoint.x, aimPoint.z);
    }
  }
  terrainNormal(aimPoint.x, aimPoint.z, aimNormal);
  aimRing.quaternion.setFromUnitVectors(_zAxis, aimNormal);
  aimRing.position.set(aimPoint.x, heightAt(aimPoint.x, aimPoint.z) + 0.07, aimPoint.z);

  // a queued touch tap casts now that the aim raycast has caught up
  if (pendingCast) {
    pendingCast = false;
    if (started) cast();
  }

  if (started) {
    player.update(dt, moveWorld, aimPoint, sprinting ? 9.5 : 6, world.collider, null);
    chickens.update(dt, player.position, sfx, onChickenLanded, onPeck, onChickenKilled, onKamikaze);
    pickups.update(dt, player.position, onPickup);

    // ambient clucking + combat-aware music
    ambienceTimer -= rawDt;
    if (ambienceTimer <= 0) {
      ambienceTimer = 4 + Math.random() * 6;
      if (chickens.nearest(player.position, 26, () => true)) sfx.ambience();
    }
    sfx.setCombat(chickens.angryCount > 0);
  } else if (player.dead) {
    player.updateDeath(dt); // the fall plays through the death slow-mo
  }
  spells.update(dt); // always — pre-warm effects run behind the intro

  camDist += (camDistTarget - camDist) * (1 - Math.exp(-10 * rawDt));
  placeCamera(rawDt);
  updateSunFollow();
  updateMotionBlur(rawDt);

  // trauma shake: squared falloff, positional + roll
  const t2 = fx.trauma * fx.trauma;
  if (t2 > 0.0001) {
    camera.position.x += (Math.random() * 2 - 1) * t2 * 0.45;
    camera.position.y += (Math.random() * 2 - 1) * t2 * 0.35;
    camera.rotation.z += (Math.random() * 2 - 1) * t2 * 0.03;
  }

  postProcessing.render();
}

selectSpell('fireball');
spells.prewarm();
setTimeout(() => { spells.quiet = false; }, 1500);

// --- mobile: virtual joystick + tappable HUD ---
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
ui.bindActions({ onSpell: selectSpell, onKick: kick, onRoll: roll });
if (IS_TOUCH) {
  ui.enableTouch();
  const zone = document.createElement('div');
  zone.id = 'stick';
  document.body.appendChild(zone);
  const stick = nipplejs.create({
    zone, mode: 'static', position: { left: '50%', top: '50%' },
    size: 120, color: '#c9a14f', restOpacity: 0.6, fadeTime: 150,
  });
  // nipplejs 1.x calls handlers with a single event object {type,target,data};
  // the joystick vector lives at evt.data.vector
  stick.on('move', (evt) => {
    const d = evt.data;
    if (!d || !d.vector) return;
    touchMove.x = d.vector.x;
    touchMove.z = -d.vector.y; // push up = forward
    touchMove.force = d.force; // shove the stick to the edge to sprint
  });
  stick.on('end', () => { touchMove.x = 0; touchMove.z = 0; touchMove.force = 0; });
}

ui.showIntro(() => {
  started = true;
  spells.quiet = false;
  sfx.ensure();
  sfx.startMusic();
});

renderer.setAnimationLoop(tick);

// debug/test handle
window.__game = {
  player, chickens, spells, ui, fx, stats, pickups,
  __touchMove: touchMove,
  setCam(yaw, pitch) { camYaw = yaw; camPitch = pitch; },
};
