import * as THREE from 'three/webgpu';
import { heightAt } from './world.js';

// potion flasks dropped by slain chickens — bob, glow, blink out if ignored
export class Pickups {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.bodyGeo = new THREE.SphereGeometry(0.16, 10, 8);
    this.bodyGeo.scale(1, 1.15, 1);
    this.neckGeo = new THREE.CylinderGeometry(0.05, 0.065, 0.12, 8);
    this.corkGeo = new THREE.CylinderGeometry(0.055, 0.05, 0.07, 8);
    this.corkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.9 });
    this.mats = {
      mana: new THREE.MeshStandardMaterial({
        color: 0x2961cf, emissive: 0x2255ff, emissiveIntensity: 1.3, roughness: 0.3,
      }),
      health: new THREE.MeshStandardMaterial({
        color: 0xc93a22, emissive: 0xff3322, emissiveIntensity: 1.3, roughness: 0.3,
      }),
    };
  }

  spawn(kind, pos) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeo, this.mats[kind]);
    body.position.y = 0.18;
    body.castShadow = true;
    const neck = new THREE.Mesh(this.neckGeo, this.mats[kind]);
    neck.position.y = 0.38;
    const cork = new THREE.Mesh(this.corkGeo, this.corkMat);
    cork.position.y = 0.47;
    g.add(body, neck, cork);
    g.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
    g.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(g);
    this.items.push({ kind, mesh: g, age: 0, life: 25, phase: Math.random() * 6 });
  }

  update(dt, playerPos, onCollect) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      it.phase += dt * 2.2;
      const g = it.mesh;
      g.rotation.y += dt * 1.8;
      g.position.y = heightAt(g.position.x, g.position.z) + 0.05 + Math.sin(it.phase) * 0.08;
      const remaining = it.life - it.age;
      g.visible = remaining > 3 || Math.sin(it.age * 14) > -0.2; // blink before fading
      if (g.position.distanceTo(playerPos) < 1.1) {
        this.scene.remove(g);
        this.items.splice(i, 1);
        onCollect?.(it.kind);
        continue;
      }
      if (it.age >= it.life) {
        this.scene.remove(g);
        this.items.splice(i, 1);
      }
    }
  }
}
