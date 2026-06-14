import * as THREE from 'three/webgpu';
import { WORLD_RADIUS, heightAt } from './world.js';

const GRAVITY = 24;
const _v = new THREE.Vector3();
const _red = new THREE.Color(0xc81d0a);

function rand(min, max) { return min + Math.random() * (max - min); }

// --- feather particles, shared pool ---
class FeatherPool {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.geo = new THREE.PlaneGeometry(0.13, 0.2);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xfff6e8, side: THREE.DoubleSide });
  }

  // soft dust puffs for ground impacts
  puff(pos, count = 4) {
    if (!this.dustMat) {
      this.dustMat = new THREE.MeshBasicMaterial({ color: 0x9b8a6c, transparent: true, opacity: 0.45, depthWrite: false });
      this.dustGeo = new THREE.SphereGeometry(0.16, 6, 5);
    }
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.dustGeo, this.dustMat);
      mesh.frustumCulled = false;
      mesh.position.copy(pos).add(new THREE.Vector3(rand(-0.2, 0.2), 0.08, rand(-0.2, 0.2)));
      this.scene.add(mesh);
      this.items.push({
        kind: 'dust', mesh,
        vel: new THREE.Vector3(rand(-1.2, 1.2), rand(0.6, 1.6), rand(-1.2, 1.2)),
        spin: new THREE.Vector3(),
        base: rand(0.8, 1.6),
        life: rand(0.4, 0.7),
        age: 0,
      });
    }
  }

  burst(pos, count = 10) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.frustumCulled = false;
      mesh.position.copy(pos);
      mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      this.scene.add(mesh);
      this.items.push({
        mesh,
        vel: new THREE.Vector3(rand(-2.5, 2.5), rand(1.5, 4), rand(-2.5, 2.5)),
        spin: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)),
        life: rand(0.8, 1.5),
        age: 0,
      });
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      f.age += dt;
      f.vel.y -= 5 * dt; // feathers fall slowly
      f.vel.multiplyScalar(1 - 1.5 * dt);
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.rotation.x += f.spin.x * dt;
      f.mesh.rotation.y += f.spin.y * dt;
      f.mesh.rotation.z += f.spin.z * dt;
      const k = Math.max(0, 1 - f.age / f.life);
      if (f.kind === 'dust') {
        // grow then dissolve
        f.mesh.scale.setScalar(f.base * Math.sin(Math.min(1, f.age / f.life) * Math.PI));
      } else {
        f.mesh.scale.setScalar(k);
      }
      if (f.age >= f.life || (f.kind !== 'dust' && f.mesh.position.y < heightAt(f.mesh.position.x, f.mesh.position.z) + 0.02)) {
        this.scene.remove(f.mesh);
        this.items.splice(i, 1);
      }
    }
  }
}

// --- a single procedural chicken ---
class Chicken {
  constructor(scene, pool, size = 1) {
    this.scene = scene;
    this.pool = pool;
    this.size = size;
    this.group = new THREE.Group();
    this.group.scale.setScalar(size);

    const white = new THREE.MeshStandardMaterial({ color: 0xf5efe2, roughness: 0.9 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd6452b, roughness: 0.8 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xe09a2b, roughness: 0.8 });
    this.materials = [white, red, orange];
    this.baseColors = this.materials.map((m) => m.color.clone());

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), white);
    body.scale.set(0.85, 0.8, 1.1);
    body.position.y = 0.38;
    body.castShadow = true;
    this.group.add(body);

    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), white);
    tail.position.set(0, 0.55, -0.32);
    tail.scale.set(0.7, 1.1, 0.7);
    tail.castShadow = true;
    this.group.add(tail);

    this.head = new THREE.Group();
    this.head.position.set(0, 0.62, 0.26);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), white);
    skull.position.y = 0.1;
    skull.castShadow = true;
    this.head.add(skull);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 6), orange);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.1, 0.18);
    this.head.add(beak);
    const comb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), red);
    comb.position.set(0, 0.26, 0.02);
    comb.scale.set(0.5, 1, 1.2);
    this.head.add(comb);
    const wattle = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), red);
    wattle.position.set(0, 0.0, 0.14);
    wattle.scale.set(0.6, 1.3, 0.8);
    this.head.add(wattle);
    // eyes — beady, until they glow red with vengeance
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0x16120e, roughness: 0.3 });
    this.eyes = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), this.eyeMat);
      eye.position.set(side * 0.09, 0.14, 0.1);
      this.head.add(eye);
      this.eyes.push(eye);
    }
    this.group.add(this.head);

    this.wingL = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), white);
    this.wingL.position.set(0.26, 0.42, 0);
    this.wingL.scale.set(0.35, 0.8, 1);
    this.wingL.castShadow = true;
    this.group.add(this.wingL);
    this.wingR = this.wingL.clone();
    this.wingR.position.x = -0.26;
    this.group.add(this.wingR);

    const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.2, 5);
    this.legL = new THREE.Group();
    this.legL.position.set(0.1, 0.2, 0.05);
    const shinL = new THREE.Mesh(legGeo, orange);
    shinL.position.y = -0.1;
    this.legL.add(shinL);
    const footL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.16), orange);
    footL.position.set(0, -0.2, 0.04);
    this.legL.add(footL);
    this.group.add(this.legL);
    this.legR = this.legL.clone();
    this.legR.position.x = -0.1;
    this.group.add(this.legR);

    scene.add(this.group);

    this.state = 'wander';
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.timer = rand(0, 2);
    this.walkPhase = rand(0, 10);
    this.charTime = 0;
    this.flashTime = 0;
    this.kickOrigin = null;
    this.airDist = 0;
    this.anger = 0;
    this.peckTimer = rand(0.3, 0.9);
    this.peckAnim = 0;
    this.lethal = false;
    this.kamiDelay = -1;
    this.kamiState = null;
    this.kamiTimer = 0;
    this.pickTarget();
  }

  enrage(duration = 12) {
    if (this.state === 'flying') return;
    if (this.anger <= 0) this.peckTimer = rand(0.25, 0.9); // stagger the mob's first pecks
    this.anger = Math.max(this.anger, duration);
    this.state = 'attack';
    this.eyeMat.color.setHex(0xff2a10);
    this.eyeMat.emissive.setHex(0xff2a10);
    this.eyeMat.emissiveIntensity = 3;
    for (const e of this.eyes) e.scale.setScalar(1.5);
    // some birds answer the call with a martyr's resolve
    if (!this.kamiState && this.kamiDelay < 0 && Math.random() < 0.35) {
      this.kamiDelay = rand(1.5, 6);
    }
  }

  calm() {
    this.anger = 0;
    this.kamiDelay = -1;
    this.kamiState = null;
    this.group.scale.setScalar(this.size);
    this.group.rotation.z = 0;
    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i].color.copy(this.baseColors[i]);
      this.materials[i].emissive.setHex(0x000000);
      this.materials[i].emissiveIntensity = 1;
    }
    this.eyeMat.color.setHex(0x16120e);
    this.eyeMat.emissive.setHex(0x000000);
    this.eyeMat.emissiveIntensity = 1;
    for (const e of this.eyes) e.scale.setScalar(1);
    if (this.state === 'attack') {
      this.state = 'wander';
      this.pickTarget();
    }
  }

  get position() { return this.group.position; }

  pickTarget() {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (WORLD_RADIUS - 4);
    this.target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  }

  launch(vel, origin, lethal = false) {
    if (this.anger > 0 || this.kamiState) this.calm(); // knocked the fight (and the fuse) out of it
    this.state = 'flying';
    this.flashTime = 0.22;
    this.lethal = lethal;
    this.vel.copy(vel).multiplyScalar(1 / Math.sqrt(this.size));
    this.spin.set(rand(-10, 10), rand(-12, 12), rand(-10, 10));
    this.kickOrigin = (origin ?? this.position).clone();
    this.kickOrigin.y = 0;
    this.airDist = 0;
    const floor = heightAt(this.position.x, this.position.z);
    if (this.position.y < floor + 0.1) this.position.y = floor + 0.1;
  }

  char() {
    this.charTime = 3;
    for (const m of this.materials) m.color.setHex(0x2a2522);
  }

  update(dt, playerPos, sfx, onLanded, onPeck, onBoom) {
    const g = this.group;

    if (this.peckAnim > 0) {
      this.peckAnim -= dt;
      this.head.rotation.x = Math.sin(Math.max(0, this.peckAnim) / 0.22 * Math.PI) * 1.1;
    }

    // white impact flash
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      const k = Math.max(0, this.flashTime / 0.22);
      for (const m of this.materials) m.emissive.setScalar(k * 0.9);
    }

    if (this.charTime > 0) {
      this.charTime -= dt;
      const k = 1 - Math.max(0, Math.min(1, this.charTime / 3));
      for (let i = 0; i < this.materials.length; i++) {
        this.materials[i].color.copy(this.baseColors[i]).lerp(new THREE.Color(0x2a2522), 1 - k);
      }
    }

    if (this.state === 'flying') {
      this.vel.y -= GRAVITY * dt;
      g.position.addScaledVector(this.vel, dt);
      g.rotation.x += this.spin.x * dt;
      g.rotation.y += this.spin.y * dt;
      g.rotation.z += this.spin.z * dt;
      const floor = heightAt(g.position.x, g.position.z);
      if (g.position.y <= floor) {
        g.position.y = floor;
        if (Math.abs(this.vel.y) > 4) {
          this.vel.y *= -0.45;
          this.vel.x *= 0.7;
          this.vel.z *= 0.7;
          this.spin.multiplyScalar(0.7);
          sfx.bounce();
          this.pool?.puff(g.position, 4);
        } else {
          // settled
          _v.copy(g.position).setY(0);
          const dist = this.kickOrigin ? _v.distanceTo(this.kickOrigin) : 0;
          g.rotation.set(0, g.rotation.y, 0);
          this.state = 'dazed';
          this.timer = rand(1.2, 2.2);
          this.vel.set(0, 0, 0);
          this.pool?.puff(g.position, 3);
          onLanded?.(this, dist, this.lethal);
          this.lethal = false;
        }
      }
      return;
    }

    if (this.state === 'dazed') {
      this.timer -= dt;
      // wobble while seeing stars
      g.rotation.z = Math.sin(this.timer * 12) * 0.15;
      if (this.timer <= 0) {
        g.rotation.z = 0;
        this.state = 'wander';
        this.pickTarget();
      }
      return;
    }

    // --- attack: chase the wizard, peck his shins ---
    if (this.state === 'attack') {
      this.anger -= dt;
      this.walkPhase += dt;
      if (this.anger <= 0 && !this.kamiState) {
        this.calm();
        return;
      }
      const to = _v.copy(playerPos).sub(g.position);
      to.y = 0;
      const d = to.length();
      const targetAngle = Math.atan2(to.x, to.z);
      let da = targetAngle - g.rotation.y;
      da = Math.atan2(Math.sin(da), Math.cos(da));

      // --- kamikaze fuse: crouch and glow red, then a screaming sprint ---
      if (this.kamiState === 'windup') {
        g.rotation.y += da * Math.min(1, 12 * dt);
        this.kamiTimer -= dt;
        const k = 1 - Math.max(0, this.kamiTimer / 1.35);
        const throb = 0.5 + 0.5 * Math.sin(this.walkPhase * 34);
        for (let i = 0; i < this.materials.length; i++) {
          this.materials[i].color.copy(this.baseColors[i]).lerp(_red, k);
          this.materials[i].emissive.setHex(0xff1a00);
          this.materials[i].emissiveIntensity = k * (0.4 + throb);
        }
        g.scale.setScalar(this.size * (1 + k * 0.22));
        g.rotation.z = Math.sin(this.walkPhase * 60) * 0.12 * k;
        g.position.y = heightAt(g.position.x, g.position.z);
        if (this.kamiTimer <= 0) {
          this.kamiState = 'rush';
          this.kamiTimer = 3.5;
          g.rotation.z = 0;
        }
        return;
      }
      if (this.kamiState === 'rush') {
        this.kamiTimer -= dt;
        g.rotation.y += da * Math.min(1, 14 * dt);
        g.position.addScaledVector(to.normalize(), 8.5 * dt);
        const swing = Math.sin(this.walkPhase * 34);
        this.legL.rotation.x = swing * 1.1;
        this.legR.rotation.x = -swing * 1.1;
        const throb = 0.6 + 0.4 * Math.sin(this.walkPhase * 50);
        for (const m of this.materials) m.emissiveIntensity = throb * 1.6;
        g.position.y = heightAt(g.position.x, g.position.z) + Math.abs(swing) * 0.06;
        if (d < 0.9 + 0.35 * this.size || this.kamiTimer <= 0) onBoom?.(this);
        return;
      }
      if (this.kamiDelay >= 0) {
        // hold at zero until the wizard is in range — the fuse never fizzles
        this.kamiDelay = Math.max(0, this.kamiDelay - dt);
        if (this.kamiDelay === 0 && d < 14) {
          this.kamiDelay = -1;
          this.kamiState = 'windup';
          this.kamiTimer = 1.35;
          sfx.kamikaze?.();
        }
      }

      g.rotation.y += da * Math.min(1, 9 * dt);
      if (d > 0.7 + 0.35 * this.size) {
        g.position.addScaledVector(to.normalize(), (3.6 - 0.5 * (this.size - 1)) * dt);
        const swing = Math.sin(this.walkPhase * 24);
        this.legL.rotation.x = swing * 0.8;
        this.legR.rotation.x = -swing * 0.8;
        g.position.y = heightAt(g.position.x, g.position.z) + Math.abs(swing) * 0.04;
      } else {
        this.legL.rotation.x = 0;
        this.legR.rotation.x = 0;
        g.position.y = heightAt(g.position.x, g.position.z);
        this.peckTimer -= dt;
        if (this.peckTimer <= 0) {
          this.peckTimer = 0.75;
          this.peckAnim = 0.22;
          onPeck?.(this);
        }
      }
      return;
    }

    // --- wander ---
    this.timer -= dt;
    this.walkPhase += dt;

    // flee the hero if too close
    const toPlayer = _v.copy(g.position).sub(playerPos);
    toPlayer.y = 0;
    const playerDist = toPlayer.length();
    let speed = 1.3;
    if (playerDist < 3) {
      this.target.copy(g.position).addScaledVector(toPlayer.normalize(), 6);
      const tr = Math.hypot(this.target.x, this.target.z);
      if (tr > WORLD_RADIUS - 3) this.target.multiplyScalar((WORLD_RADIUS - 4) / tr);
      speed = 3.2;
      this.timer = Math.max(this.timer, 0.5);
    } else if (this.timer <= 0) {
      this.timer = rand(2, 5);
      if (Math.random() < 0.35) {
        // peck instead of walking
        this.target.copy(g.position);
      } else {
        this.pickTarget();
      }
    }

    const toTarget = _v.copy(this.target).sub(g.position);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist > 0.3) {
      const targetAngle = Math.atan2(toTarget.x, toTarget.z);
      let da = targetAngle - g.rotation.y;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      g.rotation.y += da * Math.min(1, 6 * dt);
      g.position.addScaledVector(toTarget.normalize(), speed * dt);
      const swing = Math.sin(this.walkPhase * (speed > 2 ? 22 : 13));
      this.legL.rotation.x = swing * 0.7;
      this.legR.rotation.x = -swing * 0.7;
      this.head.position.z = 0.26 + Math.abs(swing) * 0.05;
      g.position.y = heightAt(g.position.x, g.position.z) + Math.abs(swing) * 0.03;
    } else {
      this.legL.rotation.x = 0;
      this.legR.rotation.x = 0;
      g.position.y = heightAt(g.position.x, g.position.z);
      // pecking head bob
      this.head.rotation.x = Math.max(0, Math.sin(this.walkPhase * 6)) * 0.9;
    }
  }
}

const MAX_CHICKENS = 56;

function rollSize() {
  const t = Math.random();
  if (t < 0.5) return 1;                  // the classic
  if (t < 0.8) return rand(1.25, 1.5);    // plump
  if (t < 0.95) return rand(1.6, 1.95);   // hefty
  return rand(2.1, 2.4);                  // the colossus
}

export class ChickenManager {
  constructor(scene, count = 24) {
    this.scene = scene;
    this.feathers = new FeatherPool(scene);
    this.chickens = [];
    this.wrath = 0;
    this.killCount = 0;
    this.spawnQueue = 0;
    this.spawnTimer = 0;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = rand(5, WORLD_RADIUS - 10);
      this.spawnAt(Math.cos(a) * r, Math.sin(a) * r);
    }
  }

  spawnAt(x, z, size = rollSize()) {
    const c = new Chicken(this.scene, this.feathers, size);
    c.position.set(x, heightAt(x, z), z);
    c.group.rotation.y = rand(0, Math.PI * 2);
    this.chickens.push(c);
    return c;
  }

  // every death calls in reinforcements — the flock multiplies
  kill(chicken, onKill) {
    const i = this.chickens.indexOf(chicken);
    if (i < 0) return;
    this.feathers.burst(chicken.position.clone().add(new THREE.Vector3(0, 0.4, 0)), 18 + chicken.size * 6);
    this.feathers.puff(chicken.position, 5);
    this.scene.remove(chicken.group);
    this.chickens.splice(i, 1);
    this.killCount++;
    const reinforcements = 2 + (this.killCount % 5 === 0 ? 1 : 0);
    this.spawnQueue += Math.min(reinforcements, Math.max(0, MAX_CHICKENS - this.chickens.length - this.spawnQueue));
    onKill?.(chicken);
  }

  // the first act of chicken violence raises the entire flock at once —
  // there is no measured escalation, only consequences
  provoke(amount, point) {
    this.wrath = Math.min(10, this.wrath + amount);
    for (const c of this.chickens) {
      if (c.state !== 'flying' && c.anger <= 0) c.enrage(10 + Math.random() * 8);
    }
  }

  calmAll() {
    this.wrath = 0;
    for (const c of this.chickens) c.calm();
  }

  get angryCount() {
    return this.chickens.filter((c) => c.anger > 0).length;
  }

  // launch all chickens within radius of point, away from it
  blast(point, radius, power, sfx, upward = 0.55) {
    let hit = 0;
    for (const c of this.chickens) {
      if (c.state === 'flying') continue;
      const d = c.position.distanceTo(point);
      if (d < radius) {
        const falloff = 1 - (d / radius) * 0.6;
        const dir = _v.copy(c.position).sub(point);
        dir.y = 0;
        if (dir.lengthSq() < 0.01) dir.set(rand(-1, 1), 0, rand(-1, 1));
        dir.normalize();
        c.launch(new THREE.Vector3(
          dir.x * power * falloff,
          power * upward * falloff + 3,
          dir.z * power * falloff,
        ), point, true); // spell hits are lethal on landing
        this.feathers.burst(c.position.clone().add(new THREE.Vector3(0, 0.4, 0)), 8);
        sfx.chickenHit();
        hit++;
      }
    }
    if (hit > 0) this.provoke(hit, point);
    return hit;
  }

  zap(point, radius) {
    for (const c of this.chickens) {
      if (c.position.distanceTo(point) < radius) c.char();
    }
  }

  nearest(point, maxDist, predicate) {
    let best = null;
    let bestD = maxDist;
    for (const c of this.chickens) {
      if (predicate && !predicate(c)) continue;
      const d = c.position.distanceTo(point);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  update(dt, playerPos, sfx, onLanded, onPeck, onKill, onBoom) {
    // reinforcements trickle in from the meadow's edge
    if (this.spawnQueue > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 0.5;
        this.spawnQueue--;
        const a = Math.random() * Math.PI * 2;
        const c = this.spawnAt(Math.cos(a) * (WORLD_RADIUS - 2), Math.sin(a) * (WORLD_RADIUS - 2));
        this.feathers.puff(c.position, 4);
        c.pickTarget();
        // reinforcements arriving mid-battle join it immediately
        if (this.wrath >= 1) c.enrage(12 + Math.random() * 6);
      }
    }

    const landed = (c, dist, lethal) => {
      if (lethal) this.kill(c, onKill);
      onLanded?.(c, dist, lethal);
    };
    // a kamikaze takes itself out, then the blast is the caller's problem
    const boomed = (c) => {
      this.kill(c, null);
      onBoom?.(c);
    };
    // snapshot: kill() splices the array mid-iteration
    for (const c of [...this.chickens]) {
      c.update(dt, playerPos, sfx, landed, onPeck, boomed);
      // shove walkers out of trees/rocks (cheap circle colliders)
      if (this.obstacles && c.state !== 'flying') {
        const p = c.position;
        for (const o of this.obstacles) {
          const dx = p.x - o.x;
          const dz = p.z - o.z;
          const d2 = dx * dx + dz * dz;
          const minD = o.r + 0.3;
          if (d2 > 0.0001 && d2 < minD * minD) {
            const d = Math.sqrt(d2);
            p.x = o.x + (dx / d) * minD;
            p.z = o.z + (dz / d) * minD;
          }
        }
      }
    }
    this.feathers.update(dt);
  }
}
