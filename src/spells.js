import * as THREE from 'three/webgpu';
import {
  mix, time, vec3, positionLocal, positionWorld, mx_fractal_noise_float, mx_noise_float,
  sin, float, uniform, uv, smoothstep, saturate, normalView, normalLocal,
} from 'three/tsl';
import { heightAt, terrainNormal } from './world.js';
import { raycastWorld } from './collision.js';

const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3();

function rand(min, max) { return min + Math.random() * (max - min); }

// short-lived FX meshes skip culling so prewarm compiles their pipelines off-screen
function fxMesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

// no-op sound board for pipeline pre-warming
const SILENT = {
  fireball() {}, explosion() {}, lightning() {}, earth() {}, squawk() {}, bounce() {},
  chickenHit() {}, kickHit() {}, tauntKill() {},
  fireballLoop() { return null; }, stopLoop() {},
};

// --- shared TSL materials ---

// the fireball shell: noise gnaws at the silhouette while flames stream
// backwards along the flight axis; rim fades to embers, the heart runs white
function makeFireShellMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const p = positionLocal.mul(3.2).add(vec3(0, 0, time.mul(7)));
  const n = mx_fractal_noise_float(p).mul(0.5).add(0.5);
  const facing = normalView.z.abs();
  const heat = facing.pow(2.0).mul(n.mul(0.8).add(0.4));
  mat.colorNode = mix(vec3(1.0, 0.16, 0.01), vec3(1.0, 0.85, 0.35), heat).mul(heat.mul(2.4).add(0.6)).mul(1.7);
  mat.opacityNode = saturate(heat.mul(1.8).add(n.mul(0.4)).sub(0.15));
  mat.positionNode = positionLocal.add(normalLocal.mul(n.sub(0.5).mul(0.42)));
  return mat;
}

// explosion flames: same ragged-noise idea as the comet shell but pinned to
// deep reds and oranges at lower energy, so stacked additive tongues stay
// fiery instead of blowing out to white through the bloom
function makeExplosionFlameMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const p = positionLocal.mul(4.2).add(vec3(0, time.mul(-5), 0));
  const n = mx_fractal_noise_float(p).mul(0.5).add(0.5);
  const facing = normalView.z.abs();
  const heat = facing.pow(1.8).mul(n.mul(0.8).add(0.35));
  // HDR red-orange: bright enough to bloom, chroma pinned to fire
  mat.colorNode = mix(vec3(1.6, 0.12, 0.0), vec3(2.2, 0.95, 0.12), heat).mul(heat.mul(1.3).add(0.4));
  mat.opacityNode = saturate(heat.mul(1.6).add(n.mul(0.35)).sub(0.18));
  mat.positionNode = positionLocal.add(normalLocal.mul(n.sub(0.5).mul(0.5)));
  return mat;
}

function makeFireCoreMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const n = mx_noise_float(positionLocal.mul(6).add(vec3(0, 0, time.mul(9)))).mul(0.5).add(0.5);
  const facing = normalView.z.abs();
  mat.colorNode = mix(vec3(1.0, 0.55, 0.12), vec3(1.0, 0.97, 0.8), facing.pow(1.5)).mul(3.2);
  mat.opacityNode = facing.pow(1.2).mul(n.mul(0.3).add(0.7));
  return mat;
}

function makeBoltCoreMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const pulse = sin(time.mul(60)).mul(0.25).add(0.75);
  mat.colorNode = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 1.0, 1.0), pulse).mul(float(3.0));
  return mat;
}

function makeBoltGlowMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0x7fb4ff, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
}

const particleGeo = new THREE.SphereGeometry(0.1, 6, 5);
// HDR colors (>1) so even tiny embers cross the bloom threshold and glow —
// small and radiant, never big and washed out
const emberMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color(2.2, 0.8, 0.15), transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
// hot embers cool into emberMat's deep orange — two populations fake a grade
const emberHotMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color(2.6, 1.5, 0.5), transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const sparkMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color(2.8, 1.8, 0.7), transparent: true, opacity: 0.95,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
// ragged smoke: noise erodes the silhouette and breaks up the alpha so the
// puffs never read as plain gray spheres
const smokeGeo = new THREE.IcosahedronGeometry(0.16, 1);
const smokeMat = (() => {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const n = mx_fractal_noise_float(positionLocal.mul(2.4).add(time.mul(0.5))).mul(0.5).add(0.5);
  mat.colorNode = mix(vec3(0.08, 0.08, 0.09), vec3(0.34, 0.32, 0.29), n);
  mat.opacityNode = smoothstep(0.3, 0.75, n).mul(0.55);
  mat.positionNode = positionLocal.add(normalLocal.mul(n.sub(0.5).mul(0.6)));
  return mat;
})();

// ---------------------------------------------------------------------------
// pooled ground decals — scorch marks with a noise dissolve + ember front.
// pooled so every pipeline compiles once at startup, never mid-fight.
// ---------------------------------------------------------------------------

class ScorchPool {
  constructor(scene, size = 10) {
    this.scene = scene;
    this.items = [];
    const geo = new THREE.CircleGeometry(1, 24);
    for (let i = 0; i < size; i++) {
      const progress = uniform(-0.3);
      const charU = uniform(new THREE.Color(0x14100c));
      const emberU = uniform(new THREE.Color(1.4, 0.45, 0.08));
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      const r = uv().sub(0.5).length().mul(2);
      const n = mx_fractal_noise_float(positionWorld.mul(2.4)).mul(0.5).add(0.5);
      const shape = smoothstep(1.0, 0.45, r.add(n.mul(0.5).sub(0.25)));
      const alive = smoothstep(progress, progress.add(0.16), n);
      const edge = alive.mul(smoothstep(progress.add(0.3), progress.add(0.16), n)).mul(saturate(progress.add(0.3)));
      mat.colorNode = mix(charU, emberU.mul(3), edge);
      mat.opacityNode = shape.mul(alive).mul(0.9);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      this.items.push({ mesh, progress, charU, emberU, age: 0, life: 8, active: false });
    }
  }

  spawn(point, size, charHex = 0x14100c, ember = [1.4, 0.45, 0.08]) {
    const s = this.items.find((i) => !i.active) ?? this.items.reduce((a, b) => (a.age > b.age ? a : b));
    s.active = true;
    s.age = 0;
    s.progress.value = -0.3;
    s.charU.value.setHex(charHex);
    s.emberU.value.setRGB(...ember);
    terrainNormal(point.x, point.z, _n);
    s.mesh.quaternion.setFromUnitVectors(_zAxis, _n);
    // pre-warm casts happen far below the map — don't snap those to the surface
    const y = point.y < -100 ? point.y : heightAt(point.x, point.z) + 0.04;
    s.mesh.position.set(point.x, y, point.z);
    s.mesh.scale.setScalar(size);
    s.mesh.visible = true;
  }

  update(dt) {
    for (const s of this.items) {
      if (!s.active) continue;
      s.age += dt;
      const t = s.age / s.life;
      s.progress.value = -0.3 + Math.max(0, (t - 0.35) / 0.65) * 1.6;
      if (s.age >= s.life) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// pooled impact shockwaves — expanding noise-broken energy ring
// ---------------------------------------------------------------------------

class WavePool {
  constructor(scene, size = 8) {
    this.scene = scene;
    this.items = [];
    const geo = new THREE.CircleGeometry(1, 32);
    for (let i = 0; i < size; i++) {
      const progress = uniform(0);
      const colorU = uniform(new THREE.Color(0xffbb66));
      const mat = new THREE.MeshBasicNodeMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const r = uv().sub(0.5).length().mul(2);
      const n = mx_noise_float(positionWorld.mul(2.6)).mul(0.5).add(0.5);
      const band = smoothstep(0.22, 0.0, r.sub(progress).abs());
      const trail = smoothstep(0.0, 0.5, progress.sub(r)).mul(0.25); // faint afterglow inside the ring
      const fade = saturate(progress.oneMinus()).pow(1.3);
      mat.colorNode = colorU.mul(2.4);
      mat.opacityNode = band.add(trail).mul(n.mul(0.7).add(0.3)).mul(fade);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.items.push({ mesh, progress, colorU, age: 0, life: 0.5, active: false });
    }
  }

  spawn(point, hex, size = 5, life = 0.5) {
    const w = this.items.find((i) => !i.active) ?? this.items.reduce((a, b) => (a.age > b.age ? a : b));
    w.active = true;
    w.age = 0;
    w.life = life;
    w.progress.value = 0;
    w.colorU.value.setHex(hex);
    terrainNormal(point.x, point.z, _n);
    w.mesh.quaternion.setFromUnitVectors(_zAxis, _n);
    const y = point.y < -100 ? point.y : heightAt(point.x, point.z) + 0.08;
    w.mesh.position.set(point.x, y, point.z);
    w.mesh.scale.setScalar(size);
    w.mesh.visible = true;
  }

  update(dt) {
    for (const w of this.items) {
      if (!w.active) continue;
      w.age += dt;
      w.progress.value = Math.min(1, w.age / w.life);
      if (w.age >= w.life) {
        w.active = false;
        w.mesh.visible = false;
      }
    }
  }
}

// ---------------------------------------------------------------------------

export class SpellManager {
  constructor(scene, chickens, ui, sfx, fx, collider = null) {
    this.scene = scene;
    this.chickens = chickens;
    this.ui = ui;
    this.sfx = sfx;
    this.fx = fx;
    this.collider = collider;
    this.quiet = false;
    this.fireballs = [];
    this.particles = [];
    this.bolts = [];
    this.earthSpikes = [];
    this.fireShellMat = makeFireShellMaterial();
    this.fireCoreMat = makeFireCoreMaterial();
    this.explFlameMat = makeExplosionFlameMaterial();
    this.fireShellGeo = new THREE.SphereGeometry(0.34, 24, 18);
    this.fireCoreGeo = new THREE.SphereGeometry(0.17, 14, 12);
    this.debrisGeo = new THREE.DodecahedronGeometry(0.09);
    this.boltCoreMat = makeBoltCoreMaterial();
    this.boltGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    this.scorches = new ScorchPool(scene);
    this.waves = new WavePool(scene);

    // fixed pool of lights: adding/removing lights at runtime changes the
    // lighting layout and forces shader rebuilds (the old explosion hitch)
    this.lightPool = [];
    for (let i = 0; i < 8; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 1.6);
      scene.add(light);
      this.lightPool.push({ light, inUse: false });
    }

    this.spikeMat = new THREE.MeshStandardMaterial({ color: 0x7d6e58, roughness: 1, flatShading: true });
    this.spikeGeo = new THREE.ConeGeometry(0.34, 1.5, 5);
    const p = this.spikeGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setX(i, p.getX(i) + rand(-0.05, 0.05));
      p.setZ(i, p.getZ(i) + rand(-0.05, 0.05));
    }
    this.spikeGeo.computeVertexNormals();
  }

  get S() { return this.quiet ? SILENT : this.sfx; }
  get F() { return this.quiet ? null : this.fx; }

  acquireLight(hex, intensity, distance, decay, position) {
    let slot = this.lightPool.find((s) => !s.inUse);
    if (!slot) slot = this.lightPool[0]; // steal the oldest
    slot.inUse = true;
    slot.light.color.setHex(hex);
    slot.light.intensity = intensity;
    slot.light.distance = distance;
    slot.light.decay = decay;
    slot.light.position.copy(position);
    return slot;
  }

  releaseLight(slot) {
    if (!slot) return;
    slot.light.intensity = 0;
    slot.inUse = false;
  }

  // fire one of everything far below the map so every pipeline compiles at load
  prewarm() {
    this.quiet = true;
    const deep = -300;
    this.castFireball(new THREE.Vector3(0, deep, 0), new THREE.Vector3(6, deep, 6));
    this.castLightning(new THREE.Vector3(0, deep, 0));
    this.castEarth(new THREE.Vector3(6, deep, 0));
    this.explode(new THREE.Vector3(-6, deep, 0));
    this.chickens.feathers.burst(new THREE.Vector3(0, deep, 0), 3);
    this.chickens.feathers.puff(new THREE.Vector3(0, deep, 0), 2);
  }

  // ---------- fireball ----------

  castFireball(origin, target) {
    // comet: a white-hot core inside a flame shell, both stretched along flight
    const mesh = new THREE.Group();
    const shell = fxMesh(this.fireShellGeo, this.fireShellMat);
    shell.scale.set(1, 1, 1.8);
    const core = fxMesh(this.fireCoreGeo, this.fireCoreMat);
    core.scale.set(1, 1, 1.5);
    core.position.z = 0.06;
    mesh.add(shell, core);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const dir = _v.copy(target).setY(target.y + 0.25).sub(origin).normalize();
    mesh.quaternion.setFromUnitVectors(_zAxis, dir);
    this.fireballs.push({
      mesh,
      lightSlot: this.acquireLight(0xff6622, 40, 9, 1.6, origin),
      loop: this.S.fireballLoop(),
      vel: dir.clone().multiplyScalar(17),
      spin: rand(6, 12),
      target: target.clone(),
      traveled: 0,
      trailTimer: 0,
    });
    this.F?.shake(0.12);

    const muzzle = fxMesh(particleGeo, sparkMat);
    muzzle.position.copy(origin);
    this.scene.add(muzzle);
    this.particles.push({ kind: 'muzzle', mesh: muzzle, age: 0, life: 0.14 });
  }

  explode(point) {
    this.S.explosion();
    this.F?.shake(0.5);
    const hit = this.chickens.blast(point, 3.8, 11, this.S);
    if (hit >= 3 && !this.quiet) {
      this.ui.toast('FOWL PLAY! ×' + hit, true);
      this.fx?.slowMo(0.8, 0.3);
    }

    const flashPos = point.clone();
    flashPos.y += 0.6;
    this.particles.push({ kind: 'light', slot: this.acquireLight(0xff7722, 110, 14, 1.5, flashPos), base: 110, age: 0, life: 0.3 });

    // a scatter of small, fast flame wisps — never one big ball
    for (let i = 0; i < 16; i++) {
      const s = fxMesh(this.fireShellGeo, this.explFlameMat);
      s.position.copy(point).add(new THREE.Vector3(rand(-0.5, 0.5), rand(0.1, 0.9), rand(-0.5, 0.5)));
      s.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      this.scene.add(s);
      const sa = Math.random() * Math.PI * 2;
      const ss = rand(2, 6.5);
      this.particles.push({
        kind: 'shell', mesh: s, age: 0, life: rand(0.16, 0.32), base: rand(0.1, 0.24),
        vel: new THREE.Vector3(Math.cos(sa) * ss, rand(1, 4.5), Math.sin(sa) * ss),
        gravity: -2,
      });
    }

    // embers and sparks spawn pre-scattered along their own velocity —
    // stacking them all on one point flashed into a huge white ball at t=0
    const emberSpawn = (mat, scaleMin, scaleMax, lifeMin, lifeMax, spMin, spMax, gravity) => {
      const a = Math.random() * Math.PI * 2;
      const elev = rand(0.15, 1.0);
      const sp = rand(spMin, spMax);
      const vel = new THREE.Vector3(Math.cos(a) * sp * (1 - elev * 0.6), sp * elev, Math.sin(a) * sp * (1 - elev * 0.6));
      const p = fxMesh(particleGeo, mat);
      p.position.copy(point).addScaledVector(vel, rand(0.02, 0.07));
      p.scale.setScalar(rand(scaleMin, scaleMax));
      this.scene.add(p);
      this.particles.push({ kind: 'ember', mesh: p, age: 0, life: rand(lifeMin, lifeMax), vel, gravity });
    };
    // hot embers: bright, fast, gone in a blink
    for (let i = 0; i < 56; i++) emberSpawn(emberHotMat, 0.05, 0.13, 0.18, 0.45, 6, 16, 14);
    // cooling embers: deep orange, smaller, drift and linger
    for (let i = 0; i < 72; i++) emberSpawn(emberMat, 0.04, 0.11, 0.45, 1.0, 3, 10, 11);
    // fast spark streaks, stretched along their velocity
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const elev = rand(0.2, 1.0);
      const sp = rand(9, 19);
      const vel = new THREE.Vector3(Math.cos(a) * sp * (1 - elev * 0.5), sp * elev, Math.sin(a) * sp * (1 - elev * 0.5));
      const p = fxMesh(particleGeo, sparkMat);
      p.position.copy(point).addScaledVector(vel, rand(0.02, 0.06));
      this.scene.add(p);
      this.particles.push({ kind: 'spark', mesh: p, age: 0, life: rand(0.25, 0.55), vel, gravity: 24 });
    }
    for (let i = 0; i < 18; i++) {
      const p = fxMesh(smokeGeo, smokeMat);
      p.position.copy(point).add(new THREE.Vector3(rand(-0.7, 0.7), rand(0.2, 1.1), rand(-0.7, 0.7)));
      p.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      p.scale.setScalar(rand(0.4, 0.85));
      this.scene.add(p);
      this.particles.push({
        kind: 'smoke', mesh: p, age: 0, life: rand(0.8, 1.5),
        vel: new THREE.Vector3(rand(-0.7, 0.7), rand(1.5, 3.2), rand(-0.7, 0.7)),
        gravity: -1,
      });
    }
    this.waves.spawn(point, 0xd96f2e, 4.2, 0.45);
    this.waves.spawn(point, 0xa54218, 2.4, 0.32);
    this.scorches.spawn(point, 1.8);
  }

  // ---------- lightning ----------

  castLightning(target) {
    this.S.lightning();
    if (!this.quiet) this.ui.screenFlash(0.3);
    this.F?.shake(0.65);
    this.chickens.zap(target, 3);
    const hit = this.chickens.blast(target, 3, 9, this.S, 1.1);
    if (hit >= 2 && !this.quiet) this.ui.toast('EXTRA CRISPY! ×' + hit, true);
    this.scorches.spawn(target, 1.3, 0x10141c, [0.5, 0.7, 1.6]);
    this.waves.spawn(target, 0x86b4ff, 4.5, 0.4);

    const group = new THREE.Group();
    this.scene.add(group);
    const lightPos = target.clone();
    lightPos.y += 2;

    const glowMat = makeBoltGlowMaterial();
    const bolt = {
      group, lightSlot: this.acquireLight(0xa8c8ff, 200, 24, 1.4, lightPos), glowMat, age: 0, life: 0.38, rebuild: 0,
      top: target.clone().add(new THREE.Vector3(rand(-3, 3), 22, rand(-3, 3))),
      target: target.clone(),
      meshes: [],
    };
    this.buildBolt(bolt);
    this.bolts.push(bolt);

    // arcing spark streaks plus a haze of small embers
    for (let i = 0; i < 16; i++) {
      const p = fxMesh(particleGeo, sparkMat);
      p.position.copy(target);
      this.scene.add(p);
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        kind: 'spark', mesh: p, age: 0, life: rand(0.25, 0.6),
        vel: new THREE.Vector3(Math.cos(a) * rand(2, 7), rand(6, 14), Math.sin(a) * rand(2, 7)),
        gravity: 26,
      });
    }
    for (let i = 0; i < 12; i++) {
      const p = fxMesh(particleGeo, sparkMat);
      p.position.copy(target);
      p.scale.setScalar(rand(0.3, 0.7));
      this.scene.add(p);
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        kind: 'ember', mesh: p, age: 0, life: rand(0.3, 0.7),
        vel: new THREE.Vector3(Math.cos(a) * rand(1, 4), rand(5, 11), Math.sin(a) * rand(1, 4)),
        gravity: 16,
      });
    }
  }

  boltPoints(from, to, segments, jitter) {
    const pts = [from.clone()];
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const p = from.clone().lerp(to, t);
      const amp = jitter * Math.sin(t * Math.PI);
      p.x += rand(-amp, amp);
      p.z += rand(-amp, amp);
      pts.push(p);
    }
    pts.push(to.clone());
    return pts;
  }

  segmentMesh(bolt, a, b, radius, material) {
    const mesh = fxMesh(this.boltGeo, material);
    const dir = _v.subVectors(b, a);
    const len = dir.length();
    mesh.scale.set(radius, len, radius);
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(_up, dir.normalize());
    bolt.group.add(mesh);
    bolt.meshes.push(mesh);
  }

  buildBolt(bolt) {
    for (const m of bolt.meshes) bolt.group.remove(m);
    bolt.meshes.length = 0;

    const main = this.boltPoints(bolt.top, bolt.target, 14, 2.2);
    for (let i = 0; i < main.length - 1; i++) {
      this.segmentMesh(bolt, main[i], main[i + 1], 0.055, this.boltCoreMat);
      this.segmentMesh(bolt, main[i], main[i + 1], 0.2, bolt.glowMat);
    }
    for (let bIdx = 0; bIdx < 2; bIdx++) {
      const start = main[3 + Math.floor(Math.random() * (main.length - 6))];
      const end = start.clone().add(new THREE.Vector3(rand(-4, 4), -rand(2, Math.max(1, (start.y - bolt.target.y) * 0.6)), rand(-4, 4)));
      end.y = Math.max(end.y, bolt.target.y);
      const branch = this.boltPoints(start, end, 6, 1.0);
      for (let i = 0; i < branch.length - 1; i++) {
        this.segmentMesh(bolt, branch[i], branch[i + 1], 0.03, this.boltCoreMat);
      }
    }
  }

  // ---------- earth ----------

  castEarth(target) {
    this.S.earth();
    this.F?.shake(0.55);
    const hit = this.chickens.blast(target, 3.4, 10, this.S, 1.5);
    if (hit >= 3 && !this.quiet) {
      this.ui.toast('CHICKEN GEYSER! ×' + hit, true);
      this.fx?.slowMo(0.7, 0.3);
    }
    this.scorches.spawn(target, 1.9, 0x2b2118, [1.2, 0.7, 0.25]);
    this.waves.spawn(target, 0xc9a86a, 4.8, 0.5);

    const group = new THREE.Group();
    group.position.copy(target);
    this.scene.add(group);
    const spikes = [];
    const count = 7;
    for (let i = 0; i < count; i++) {
      const center = i === 0;
      const mesh = fxMesh(this.spikeGeo, this.spikeMat);
      const a = (i / (count - 1)) * Math.PI * 2;
      const r = center ? 0 : rand(1.2, 1.9);
      const lx = Math.cos(a) * r;
      const lz = Math.sin(a) * r;
      const baseY = target.y < -100 ? 0 : heightAt(target.x + lx, target.z + lz) - target.y;
      mesh.position.set(lx, baseY, lz);
      mesh.rotation.y = rand(0, Math.PI);
      if (!center) {
        mesh.rotation.x = Math.sin(a) * 0.25;
        mesh.rotation.z = -Math.cos(a) * 0.25;
      }
      mesh.castShadow = true;
      mesh.scale.set(center ? 1.5 : 1, 0.001, center ? 1.5 : 1);
      group.add(mesh);
      spikes.push({ mesh, baseY, delay: center ? 0 : 0.04 + (i / count) * 0.1, h: center ? 2 : rand(0.9, 1.4) });
    }
    this.earthSpikes.push({ group, spikes, age: 0, life: 1.6 });

    for (let i = 0; i < 12; i++) {
      const p = fxMesh(smokeGeo, smokeMat);
      p.position.copy(target).add(new THREE.Vector3(rand(-1.2, 1.2), 0.1, rand(-1.2, 1.2)));
      p.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      p.scale.setScalar(rand(0.8, 1.7));
      this.scene.add(p);
      this.particles.push({
        kind: 'smoke', mesh: p, age: 0, life: rand(0.5, 1),
        vel: new THREE.Vector3(rand(-1, 1), rand(2, 4.5), rand(-1, 1)),
        gravity: 3,
      });
    }
    // tumbling rock debris thrown out by the eruption
    for (let i = 0; i < 14; i++) {
      const p = fxMesh(this.debrisGeo, this.spikeMat);
      p.position.copy(target).add(new THREE.Vector3(rand(-0.6, 0.6), 0.3, rand(-0.6, 0.6)));
      this.scene.add(p);
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        kind: 'debris', mesh: p, age: 0, life: rand(0.6, 1.1), base: rand(0.5, 1.3),
        vel: new THREE.Vector3(Math.cos(a) * rand(2, 6), rand(5, 10), Math.sin(a) * rand(2, 6)),
        gravity: 22,
        spin: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)),
      });
    }
  }

  // ---------- update ----------

  update(dt) {
    // fireballs
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      const step = f.vel.length() * dt;
      const worldHit = raycastWorld(this.collider, f.mesh.position, f.vel, step + 0.3);
      f.mesh.position.addScaledVector(f.vel, dt);
      f.traveled += step;
      f.mesh.rotateZ(f.spin * dt); // spin around the travel axis — animates the flame noise
      f.lightSlot.light.position.copy(f.mesh.position);
      f.lightSlot.light.intensity = 30 + Math.sin(f.traveled * 4) * 12;

      f.trailTimer -= dt;
      if (f.trailTimer <= 0) {
        f.trailTimer = 0.016;
        const p = fxMesh(particleGeo, emberMat);
        p.position.copy(f.mesh.position).add(new THREE.Vector3(rand(-0.12, 0.12), rand(-0.12, 0.12), rand(-0.12, 0.12)));
        p.scale.setScalar(rand(0.35, 0.8));
        this.scene.add(p);
        this.particles.push({
          kind: 'trail', mesh: p, age: 0, life: 0.3,
          vel: new THREE.Vector3(rand(-0.4, 0.4), rand(0.3, 1.2), rand(-0.4, 0.4)), gravity: 0,
        });
      }

      const pos = f.mesh.position;
      const hitChicken = this.chickens.nearest(pos, 0.75, (c) => c.state !== 'flying');
      const reachedTarget = pos.distanceTo(f.target) < 0.5;
      const hitGround = pos.y <= (this.quiet ? -1000 : heightAt(pos.x, pos.z) + 0.22);
      if (hitGround || worldHit || f.traveled > 45 || hitChicken || reachedTarget || this.quiet) {
        const at = worldHit ? worldHit.point.clone() : pos.clone();
        if (!this.quiet) at.y = Math.max(at.y, heightAt(at.x, at.z) + 0.1);
        this.scene.remove(f.mesh);
        this.releaseLight(f.lightSlot);
        this.S.stopLoop(f.loop);
        this.fireballs.splice(i, 1);
        this.explode(at);
      }
    }

    // lightning bolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += dt;
      b.rebuild -= dt;
      if (b.rebuild <= 0 && b.age < b.life * 0.75) {
        b.rebuild = 0.05;
        this.buildBolt(b);
      }
      const k = 1 - b.age / b.life;
      b.lightSlot.light.intensity = Math.max(0, k) * (120 + Math.random() * 120);
      b.glowMat.opacity = 0.3 * Math.max(0, k);
      if (b.age >= b.life) {
        this.scene.remove(b.group);
        this.releaseLight(b.lightSlot);
        b.glowMat.dispose();
        this.bolts.splice(i, 1);
      }
    }

    // earth spikes: erupt with overshoot, hold, sink back
    for (let i = this.earthSpikes.length - 1; i >= 0; i--) {
      const e = this.earthSpikes[i];
      e.age += dt;
      const sinkStart = e.life - 0.5;
      for (const s of e.spikes) {
        let k;
        if (e.age < sinkStart) {
          const t = Math.min(1, Math.max(0, (e.age - s.delay) / 0.2));
          const c1 = 1.70158;
          const c3 = c1 + 1;
          k = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        } else {
          k = 1 - (e.age - sinkStart) / 0.5;
        }
        k = Math.max(0.001, k);
        s.mesh.scale.y = k * s.h;
        s.mesh.position.y = s.baseY + (1.5 * k * s.h) / 2 - 0.08;
      }
      if (e.age >= e.life) {
        this.scene.remove(e.group);
        this.earthSpikes.splice(i, 1);
      }
    }

    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      const k = Math.max(0, 1 - p.age / p.life);
      if (p.kind === 'light') {
        p.slot.light.intensity = p.base * k;
        if (p.age >= p.life) { this.releaseLight(p.slot); this.particles.splice(i, 1); }
        continue;
      }
      if (p.kind === 'muzzle') {
        p.mesh.scale.setScalar(0.5 + (p.age / p.life) * 3);
        if (p.age >= p.life) { this.scene.remove(p.mesh); this.particles.splice(i, 1); }
        continue;
      }
      p.vel.y -= (p.gravity ?? 0) * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.kind === 'shell') {
        // rapid expansion, then each flame tongue eats itself
        const t = p.age / p.life;
        const grow = (0.4 + 1.5 * (1 - Math.pow(1 - t, 3))) * (p.base ?? 1);
        const collapse = t > 0.65 ? Math.max(0.001, 1 - (t - 0.65) / 0.35) : 1;
        p.mesh.scale.setScalar(grow * collapse);
      } else if (p.kind === 'spark') {
        // streak: stretch along the velocity
        const sp = p.vel.length();
        if (sp > 0.01) p.mesh.quaternion.setFromUnitVectors(_up, _v.copy(p.vel).divideScalar(sp));
        const w = 0.08 * k + 0.02;
        p.mesh.scale.set(w, Math.min(0.7, sp * 0.045) * k + 0.04, w);
      } else if (p.kind === 'debris') {
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.y += p.spin.y * dt;
        p.mesh.rotation.z += p.spin.z * dt;
        p.mesh.scale.setScalar(Math.max(0.001, p.base * Math.min(1, k * 3)));
      } else {
        const grow = p.kind === 'smoke' ? 1 + p.age * 1.5 : k;
        p.mesh.scale.setScalar(Math.max(0.001, grow));
        if (p.kind === 'smoke') p.mesh.scale.multiplyScalar(k * 2.4);
      }
      if (p.age >= p.life) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }

    this.scorches.update(dt);
    this.waves.update(dt);
  }
}
