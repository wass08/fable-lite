import * as THREE from 'three/webgpu';
import { time, sin, uniform } from 'three/tsl';
import { WORLD_RADIUS, heightAt } from './world.js';
import { resolveCapsule } from './collision.js';

const _v = new THREE.Vector3();

export class Player {
  constructor(scene) {
    this.group = new THREE.Group();
    // pivot sits at the belly so rolls and leans rotate around the body's
    // center of mass instead of the feet
    this.pivot = new THREE.Group();
    this.pivot.position.y = 1.0;
    this.rig = new THREE.Group();
    this.rig.position.y = -1.0;
    this.pivot.add(this.rig);
    this.group.add(this.pivot);

    const robeMat = new THREE.MeshStandardMaterial({ color: 0x4663a8, roughness: 0.9 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.6, metalness: 0.4 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xeac08a, roughness: 0.7 });
    const beardMat = new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 1 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.85 });

    // tunic top ending at the hips — the legs stay free for punting
    const tunic = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 6, 12), robeMat);
    tunic.position.y = 1.28;
    tunic.castShadow = true;
    this.rig.add(tunic);
    const skirtTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.34, 0.16, 12), robeMat);
    skirtTrim.position.y = 0.96;
    this.rig.add(skirtTrim);

    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.325, 0.34, 0.1, 12), leather);
    belt.position.y = 1.04;
    this.rig.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.03), trimMat);
    buckle.position.set(0, 1.04, 0.32);
    this.rig.add(buckle);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 12), skin);
    head.position.y = 1.78;
    head.castShadow = true;
    this.rig.add(head);

    const eyeGeo = new THREE.SphereGeometry(0.024, 6, 5);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.08, 1.81, 0.2);
      this.rig.add(eye);
    }

    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 8), beardMat);
    beard.position.set(0, 1.6, 0.13);
    beard.rotation.x = 0.35 + Math.PI; // point down-forward
    this.rig.add(beard);

    // wizard hat: brim + slightly tipped cone
    const hat = new THREE.Group();
    hat.position.y = 1.94;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.05, 14), robeMat);
    brim.castShadow = true;
    hat.add(brim);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.56, 12), robeMat);
    cone.position.y = 0.29;
    cone.rotation.z = 0.16;
    cone.castShadow = true;
    hat.add(cone);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.235, 0.08, 12), trimMat);
    band.position.y = 0.05;
    hat.add(band);
    hat.rotation.z = -0.06;
    this.rig.add(hat);

    // arms: shoulder pivot -> upper arm -> elbow pivot -> forearm + hand
    const upperArmGeo = new THREE.CapsuleGeometry(0.085, 0.2, 4, 8);
    upperArmGeo.translate(0, -0.16, 0);
    const forearmGeo = new THREE.CapsuleGeometry(0.072, 0.18, 4, 8);
    forearmGeo.translate(0, -0.13, 0);

    this.armR = new THREE.Group();
    this.armR.position.set(-0.36, 1.5, 0);
    const upperR = new THREE.Mesh(upperArmGeo, robeMat);
    upperR.castShadow = true;
    this.armR.add(upperR);
    this.elbowR = new THREE.Group();
    this.elbowR.position.y = -0.3;
    const foreR = new THREE.Mesh(forearmGeo, robeMat);
    foreR.castShadow = true;
    this.elbowR.add(foreR);
    const handR = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), skin);
    handR.position.y = -0.27;
    this.elbowR.add(handR);
    this.armR.add(this.elbowR);
    this.rig.add(this.armR);

    this.armL = new THREE.Group();
    this.armL.position.set(0.36, 1.5, 0);
    this.armL.add(upperR.clone());
    this.elbowL = new THREE.Group();
    this.elbowL.position.y = -0.3;
    this.elbowL.add(foreR.clone(), handR.clone());
    this.armL.add(this.elbowL);
    this.rig.add(this.armL);

    // --- the magician's staff, held in the right hand ---
    const staff = new THREE.Group();
    staff.position.set(0, -0.27, 0.07);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.05, 1.9, 8), woodMat);
    shaft.position.y = 0.18;
    shaft.castShadow = true;
    staff.add(shaft);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.045, 0.09, 8), trimMat);
    collar.position.y = 1.1;
    staff.add(collar);
    // prongs cradling the crystal
    for (let i = 0; i < 3; i++) {
      const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.22, 5), trimMat);
      const a = (i / 3) * Math.PI * 2;
      prong.position.set(Math.cos(a) * 0.07, 1.22, Math.sin(a) * 0.07);
      prong.rotation.z = Math.cos(a) * -0.35;
      prong.rotation.x = Math.sin(a) * 0.35;
      staff.add(prong);
    }
    // pulsing crystal — color follows the selected spell, blooms in post
    this.crystalColor = uniform(new THREE.Color(0xffaa33));
    this.crystalFlash = uniform(0);
    const crystalMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.2, metalness: 0.1 });
    crystalMat.colorNode = this.crystalColor;
    crystalMat.emissiveNode = this.crystalColor.mul(sin(time.mul(4)).mul(0.25).add(0.85).add(this.crystalFlash.mul(5))).mul(1.6);
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), crystalMat);
    this.crystal.position.y = 1.27;
    staff.add(this.crystal);
    this.crystalLight = new THREE.PointLight(0xffaa33, 3, 4, 1.8);
    this.crystalLight.position.y = 1.3;
    staff.add(this.crystalLight);
    staff.rotation.x = 0.5; // counters the resting elbow bend so it stands tall
    this.elbowR.add(staff);

    // legs: hip pivot -> thigh -> knee pivot -> shin + cuff + boot
    const thighGeo = new THREE.CapsuleGeometry(0.115, 0.24, 4, 8);
    thighGeo.translate(0, -0.2, 0);
    const shinGeo = new THREE.CapsuleGeometry(0.095, 0.2, 4, 8);
    shinGeo.translate(0, -0.16, 0);
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x55514a, roughness: 0.95 });

    this.legR = new THREE.Group();
    this.legR.position.set(-0.16, 0.98, 0);
    const thighR = new THREE.Mesh(thighGeo, pantsMat);
    thighR.castShadow = true;
    this.legR.add(thighR);
    this.kneeR = new THREE.Group();
    this.kneeR.position.y = -0.42;
    const shinR = new THREE.Mesh(shinGeo, pantsMat);
    shinR.castShadow = true;
    this.kneeR.add(shinR);
    const cuffR = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.12, 8), leather);
    cuffR.position.y = -0.3;
    this.kneeR.add(cuffR);
    const bootR = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.3), leather);
    bootR.position.set(0, -0.44, 0.05);
    bootR.castShadow = true;
    this.kneeR.add(bootR);
    this.legR.add(this.kneeR);
    this.rig.add(this.legR);

    this.legL = new THREE.Group();
    this.legL.position.set(0.16, 0.98, 0);
    this.legL.add(thighR.clone());
    this.kneeL = new THREE.Group();
    this.kneeL.position.y = -0.42;
    this.kneeL.add(shinR.clone(), cuffR.clone(), bootR.clone());
    this.legL.add(this.kneeL);
    this.rig.add(this.legL);

    scene.add(this.group);

    this.walkPhase = 0;
    this.castTimer = 0;
    this.kickTimer = 0;
    this.rollTimer = 0;
    this.rollDir = new THREE.Vector3();
    this.facing = 0;
    this.dead = false;
    this.deathTime = 0;
    this.onDeathLand = null;
  }

  // keel over sideways and sprawl on the grass
  startDeath() {
    if (this.dead) return;
    this.dead = true;
    this.deathTime = 0;
    this._deathLanded = false;
    this.rollTimer = 0;
    this.castTimer = 0;
    this.kickTimer = 0;
    this.group.scale.set(1, 1, 1);
  }

  updateDeath(dt) {
    this.deathTime += dt;
    const t = Math.min(1, this.deathTime / 0.8);
    const ease = 1 - Math.pow(1 - t, 3);
    this.pivot.rotation.x = 0;
    this.pivot.rotation.z = -1.45 * ease;
    // pivot sits at the belly: lower the whole rig so the body rests on the grass
    this.group.position.y = this.groundY() - 0.62 * ease;
    this.armL.rotation.x = -0.7 * ease;
    this.armR.rotation.x = -0.5 * ease;
    this.elbowL.rotation.x = -0.4;
    this.elbowR.rotation.x = -0.4;
    this.legL.rotation.x = -0.25 * ease;
    this.legR.rotation.x = 0.2 * ease;
    this.kneeL.rotation.x = 0.5 * ease;
    this.kneeR.rotation.x = 0.3 * ease;
    if (!this._deathLanded && t >= 0.97) {
      this._deathLanded = true;
      this.onDeathLand?.();
    }
  }

  revive() {
    this.dead = false;
    this._deathLanded = false;
    this.pivot.rotation.set(0, 0, 0);
    this.group.scale.set(1, 1, 1);
    this.group.position.y = this.groundY();
  }

  get position() { return this.group.position; }
  get isRolling() { return this.rollTimer > 0; }

  // spells fly out of the staff crystal
  castOrigin() {
    return this.crystal.getWorldPosition(new THREE.Vector3());
  }

  setSpellColor(hex) {
    this.crystalColor.value.setHex(hex);
    this.crystalLight.color.setHex(hex);
  }

  forward() {
    return new THREE.Vector3(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
  }

  startCast() {
    this.castTimer = 0.35;
    this.crystalFlash.value = 1;
  }

  startKick() { this.kickTimer = 0.3; }

  startRoll(dir) {
    if (this.isRolling) return false;
    this.rollTimer = 0.45;
    this.rollDir.copy(dir).normalize();
    this.facing = Math.atan2(this.rollDir.x, this.rollDir.z);
    return true;
  }

  clampAndCollide(collider) {
    const r = Math.hypot(this.position.x, this.position.z);
    if (r > WORLD_RADIUS) {
      this.position.x *= WORLD_RADIUS / r;
      this.position.z *= WORLD_RADIUS / r;
    }
    resolveCapsule(collider, this.position, 0.45, 1.7);
  }

  groundY() {
    return heightAt(this.position.x, this.position.z);
  }

  update(dt, moveWorld, aimPoint, speed = 6, collider = null, faceYaw = null) {
    this.crystalFlash.value = Math.max(0, this.crystalFlash.value - dt * 5);
    this.crystalLight.intensity = 3 + this.crystalFlash.value * 22;

    // --- dodge roll: forward somersault along the roll direction ---
    if (this.isRolling) {
      this.rollTimer -= dt;
      const progress = 1 - Math.max(0, this.rollTimer / 0.45);
      this.position.addScaledVector(this.rollDir, 10.5 * dt);
      this.clampAndCollide(collider);
      let da = this.facing - this.group.rotation.y;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      this.group.rotation.y += da * Math.min(1, 24 * dt);
      // positive X spins head-over-heels toward local +Z (the travel direction)
      this.pivot.rotation.x = progress * Math.PI * 2;
      this.group.position.y = this.groundY() + Math.sin(progress * Math.PI) * 0.45;
      // tuck into a ball: knees to chest, arms hugged in
      this.legL.rotation.x = -1.2;
      this.legR.rotation.x = -1.2;
      this.kneeL.rotation.x = 1.9;
      this.kneeR.rotation.x = 1.9;
      this.armL.rotation.x = -1.1;
      this.armR.rotation.x = -1.1;
      this.elbowL.rotation.x = -1.4;
      this.elbowR.rotation.x = -1.4;
      if (this.rollTimer <= 0) {
        this.pivot.rotation.x = 0;
        this.group.position.y = this.groundY();
      }
      return;
    }

    const move = _v.copy(moveWorld);
    move.y = 0;
    const moving = move.lengthSq() > 0.0001;

    if (moving) {
      move.normalize();
      this.position.addScaledVector(move, speed * dt);
      this.clampAndCollide(collider);
      // mouse-look: keep facing the camera heading while strafing
      this.facing = faceYaw ?? Math.atan2(move.x, move.z);
      this.walkPhase += dt * (speed > 7 ? 12 : 9);
    } else if (aimPoint) {
      // idle: face the cursor like a proper hero sizing up a chicken
      const to = _v.copy(aimPoint).sub(this.position);
      if (to.lengthSq() > 0.5) this.facing = Math.atan2(to.x, to.z);
      this.walkPhase *= 1 - 8 * dt;
    }

    let da = this.facing - this.group.rotation.y;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.group.rotation.y += da * Math.min(1, 12 * dt);

    // walk cycle (staff arm swings less — he's holding it)
    const swing = moving ? Math.sin(this.walkPhase) : 0;
    const bob = speed > 7 ? 0.09 : 0.05;
    const kneeAmp = speed > 7 ? 1.15 : 0.85;
    this.legL.rotation.x = swing * 0.6;
    if (this.kickTimer <= 0) this.legR.rotation.x = -swing * 0.6;
    // knees flex as each leg swings through, never hyperextend
    this.kneeL.rotation.x = moving ? Math.max(0, -Math.cos(this.walkPhase)) * kneeAmp : 0.06;
    if (this.kickTimer <= 0) {
      this.kneeR.rotation.x = moving ? Math.max(0, Math.cos(this.walkPhase)) * kneeAmp : 0.06;
    }
    this.armL.rotation.x = -swing * 0.45;
    this.elbowL.rotation.x = -0.3 - Math.max(0, swing) * 0.45;
    if (this.castTimer <= 0) {
      this.armR.rotation.x = swing * 0.18;
      this.elbowR.rotation.x = -0.45 - Math.max(0, -swing) * 0.2;
    }
    this.group.position.y = this.groundY() + (moving ? Math.abs(Math.cos(this.walkPhase)) * bob : 0);

    // cast: staff sweeps up while the elbow extends, eases back
    if (this.castTimer > 0) {
      this.castTimer -= dt;
      const k = Math.max(0, this.castTimer / 0.35);
      const raise = k > 0.85 ? (1 - k) / 0.15 : Math.sin(k * Math.PI * 0.5);
      this.armR.rotation.x = -Math.PI * 0.7 * raise;
      this.elbowR.rotation.x = -0.45 * (1 - raise) - 0.08;
      if (this.castTimer <= 0) {
        this.armR.rotation.x = 0;
        this.elbowR.rotation.x = -0.45;
      }
    }

    // kick: anticipation crouch, knee loads then snaps straight at impact
    if (this.kickTimer > 0) {
      this.kickTimer -= dt;
      const t = 1 - Math.max(0, this.kickTimer / 0.3);
      const curve = Math.sin(Math.min(t * 1.6, 1) * Math.PI);
      this.legR.rotation.x = -curve * 1.7;
      this.kneeR.rotation.x = Math.sin(Math.min(t * 3.2, 1) * Math.PI) * 1.25;
      this.pivot.rotation.x = -curve * 0.12;
      this.group.scale.y = 1 - curve * 0.12;
      this.group.scale.x = 1 + curve * 0.06;
      this.group.scale.z = 1 + curve * 0.06;
      if (this.kickTimer <= 0) {
        this.legR.rotation.x = 0;
        this.kneeR.rotation.x = 0.06;
        this.pivot.rotation.x = 0;
        this.group.scale.set(1, 1, 1);
      }
    } else if (moving) {
      // lean into the run, harder when sprinting
      this.pivot.rotation.x = speed > 7 ? 0.13 : 0.07;
    } else {
      this.pivot.rotation.x *= 1 - 10 * dt;
    }
  }
}
