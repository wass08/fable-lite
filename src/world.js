import * as THREE from 'three/webgpu';
import {
  mix, time, vec3, vec4, float, sin, saturate, smoothstep, normalWorld, texture,
  positionLocal, positionWorld, mx_fractal_noise_float, mx_noise_float, instanceIndex,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Tree } from '@dgreenheck/ez-tree';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { asset } from './assets.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const WORLD_RADIUS = 55;

function rand(min, max) { return min + Math.random() * (max - min); }

// ---------------------------------------------------------------------------
// terrain heightfield: deterministic value-noise FBM, sampled on CPU
// ---------------------------------------------------------------------------

function hash2(ix, iz) {
  let n = (ix * 374761393 + iz * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function rawHeight(x, z) {
  const r = Math.hypot(x, z);
  // gentle rolling meadow, calmer near spawn
  const calm = 0.3 + 0.7 * Math.min(1, Math.max(0, (r - 6) / 20));
  let h = (vnoise(x * 0.045, z * 0.045) - 0.5) * 3.2 * calm;
  h += (vnoise(x * 0.13, z * 0.13) - 0.5) * 0.9 * calm;
  // distant hills rising past the playfield, crowned by the horizon forest
  const hill = Math.min(1, Math.max(0, (r - 62) / 70));
  h += hill * hill * (6 + vnoise(x * 0.02 + 7, z * 0.02 + 3) * 9);
  return h;
}

const H0 = rawHeight(0, 0);
export function heightAt(x, z) {
  return rawHeight(x, z) - H0;
}

export function terrainNormal(x, z, out = new THREE.Vector3()) {
  const e = 0.6;
  out.set(
    (heightAt(x - e, z) - heightAt(x + e, z)) / (2 * e),
    1,
    (heightAt(x, z - e) - heightAt(x, z + e)) / (2 * e),
  );
  return out.normalize();
}

// ---------------------------------------------------------------------------
// ez-tree (https://github.com/dgreenheck/ez-tree) — textured trunks, branches
// and leaf cards. We swap its GLSL onBeforeCompile leaf wind (WebGL-only) for
// a TSL positionNode sway so it works on the WebGPU renderer.
// ---------------------------------------------------------------------------

function makeLeafWindMaterial(phong) {
  const mat = new THREE.MeshStandardNodeMaterial({
    map: phong.map,
    color: phong.color,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  // leaf cards: fake mostly-up normals so the canopy lights evenly
  // instead of going black wherever a card faces away from the sun
  mat.normalNode = vec3(0, 1, 0.25).normalize();
  const phase = positionLocal.x.mul(0.35)
    .add(positionLocal.z.mul(0.28))
    .add(positionLocal.y.mul(0.15))
    .add(float(instanceIndex).mul(1.71)); // each tree sways on its own beat
  const sway = sin(time.mul(1.4).add(phase)).add(sin(time.mul(3.1).add(phase.mul(1.7))).mul(0.35));
  const amp = saturate(positionLocal.y.mul(0.08)).mul(0.5); // raw (pre-instance-scale) units
  mat.positionNode = positionLocal.add(vec3(sway.mul(amp), sway.mul(amp).mul(0.3), sway.mul(amp).mul(0.6)));
  return mat;
}

const leafWindCache = new Map();

function buildEzTree(preset, seed, targetHeight) {
  const tree = new Tree();
  tree.loadPreset(preset);
  tree.options.seed = seed;
  tree.generate();

  // normalize wildly different preset sizes to a gameplay-friendly height
  const box = new THREE.Box3().setFromObject(tree);
  const k = targetHeight / Math.max(1, box.max.y);

  const key = tree.options.leaves.type + '|' + tree.options.leaves.tint;
  if (!leafWindCache.has(key)) leafWindCache.set(key, makeLeafWindMaterial(tree.leavesMesh.material));
  return {
    branchGeo: tree.branchesMesh.geometry,
    branchMat: tree.branchesMesh.material,
    leafGeo: tree.leavesMesh.geometry,
    leafMat: leafWindCache.get(key),
    k,
  };
}

// ---------------------------------------------------------------------------
// GLB environment assets from the ez-tree example app (grass, rocks, flowers)
// ---------------------------------------------------------------------------

async function loadEnvAssets() {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(asset('/draco/'));
  loader.setDRACOLoader(draco);
  const [grass, rock1, rock2, rock3, flowerW, flowerB, flowerY] = await Promise.all([
    '/env/grass.glb', '/env/rock1.glb', '/env/rock2.glb', '/env/rock3.glb',
    '/env/flower_white.glb', '/env/flower_blue.glb', '/env/flower_yellow.glb',
  ].map((url) => loader.loadAsync(asset(url))));

  function firstMesh(gltf) {
    let found = null;
    gltf.scene.traverse((o) => { if (!found && o.isMesh) found = o; });
    return found;
  }

  return {
    grass: firstMesh(grass),
    rocks: [firstMesh(rock1), firstMesh(rock2), firstMesh(rock3)],
    flowers: [flowerW.scene, flowerB.scene, flowerY.scene],
  };
}

// ---------------------------------------------------------------------------

export async function buildWorld(scene, { mobile = false } = {}) {
  const assets = await loadEnvAssets();

  // --- lights: warm Albion afternoon ---
  const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x5d7a44, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe2b0, 2.8);
  sun.position.set(30, 45, 18);
  sun.castShadow = true;
  // tight frustum that follows the player (see main.js) — over twice the
  // texel density of a whole-map frustum, so much smoother shadow edges.
  // 2048 on phones: a 4096² depth target is a common mobile memory cliff.
  const shadowSize = mobile ? 2048 : 4096;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -42;
  sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 42;
  sun.shadow.camera.bottom = -42;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  scene.add(sun);
  scene.add(sun.target);

  scene.fog = new THREE.Fog(0xcfe0ee, 90, 260);

  // --- sky dome: TSL gradient + sun disc + drifting noise clouds ---
  const skyMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false });
  const dir = positionLocal.normalize();
  const h = saturate(positionLocal.y.div(280));
  const base = mix(vec3(0.95, 0.86, 0.70), mix(vec3(0.66, 0.80, 0.92), vec3(0.30, 0.52, 0.84), h), smoothstep(-0.05, 0.25, positionLocal.y.div(280)));

  const sunDirV = new THREE.Vector3(30, 45, 18).normalize();
  const sunDot = saturate(dir.dot(vec3(sunDirV.x, sunDirV.y, sunDirV.z)));
  const sunDisc = sunDot.pow(800).mul(8);
  const sunHaze = sunDot.pow(6).mul(0.35);

  const cloudP = vec3(dir.x.mul(4).add(time.mul(0.012)), dir.y.mul(9), dir.z.mul(4));
  const cloudN = mx_fractal_noise_float(cloudP).mul(0.5).add(0.5);
  const clouds = smoothstep(0.52, 0.78, cloudN).mul(smoothstep(0.03, 0.3, dir.y)).mul(0.55);

  skyMat.colorNode = mix(base, vec3(1.0, 0.99, 0.96), clouds)
    .add(vec3(1.0, 0.85, 0.55).mul(sunHaze))
    .add(vec3(1.0, 0.95, 0.82).mul(sunDisc));
  const sky = new THREE.Mesh(new THREE.SphereGeometry(290, 32, 16), skyMat);
  scene.add(sky);

  // --- terrain mesh: CPU-displaced plane, BVH for aim raycasts ---
  const groundGeo = new THREE.PlaneGeometry(420, 420, 200, 200);
  groundGeo.rotateX(-Math.PI / 2);
  {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    }
    groundGeo.computeVertexNormals();
    groundGeo.computeBoundsTree();
  }
  const groundMat = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  const gp = vec3(positionWorld.x, 0, positionWorld.z);
  const broad = mx_fractal_noise_float(gp.mul(0.045)).mul(0.5).add(0.5);
  const mid = mx_fractal_noise_float(gp.mul(0.3)).mul(0.5).add(0.5);
  const detail = mx_noise_float(gp.mul(2.4)).mul(0.5).add(0.5);
  const lush = vec3(0.13, 0.30, 0.07);
  const meadow = vec3(0.27, 0.44, 0.12);
  const dry = vec3(0.44, 0.42, 0.18);
  const dirt = vec3(0.36, 0.27, 0.15);
  let groundCol = mix(lush, meadow, broad);
  groundCol = mix(groundCol, dry, smoothstep(0.58, 0.85, mid).mul(0.55));
  groundCol = mix(groundCol, dirt, smoothstep(0.62, 0.9, mid.mul(broad).mul(detail.add(0.4))));
  const hillBlend = smoothstep(10.5, 14.0, positionWorld.y);
  groundCol = mix(groundCol, vec3(0.10, 0.20, 0.07), hillBlend.mul(0.85));
  groundMat.colorNode = groundCol.mul(detail.mul(0.3).add(0.82));
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  // --- grass: ez-tree's textured tuft model, instanced with TSL wind ---
  {
    const src = assets.grass;
    src.geometry.computeBoundingBox();
    const gh = Math.max(0.01, src.geometry.boundingBox.max.y - src.geometry.boundingBox.min.y);
    const grassMat = new THREE.MeshStandardNodeMaterial({
      map: src.material.map,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
    });
    // same trick as the tree leaves: card normals make standard lighting go
    // black on away-facing blades, so fake mostly-up normals
    grassMat.normalNode = vec3(0, 1, 0.2).normalize();
    // tint in TSL: instanceColor isn't piped through the node material, so
    // multiply the texture by a per-instance green directly
    const gTex = texture(src.material.map);
    const gHue = float(instanceIndex).mul(0.61803).fract();
    const gTint = mix(vec3(0.30, 0.50, 0.13), vec3(0.48, 0.66, 0.20), gHue);
    grassMat.colorNode = vec4(gTex.rgb.mul(gTint).mul(2.1), gTex.a);
    const phase = float(instanceIndex).mul(0.7919).fract().mul(6.283);
    const gust = sin(time.mul(1.5).add(phase)).add(sin(time.mul(3.9).add(phase.mul(2.1))).mul(0.4));
    const weight = saturate(positionLocal.y.div(gh));
    grassMat.positionNode = positionLocal.add(vec3(
      gust.mul(weight).mul(gh * 0.3), 0, gust.mul(weight).mul(gh * 0.15),
    ));

    const GRASS_COUNT = 32000;
    const grass = new THREE.InstancedMesh(src.geometry, grassMat, GRASS_COUNT);
    grass.receiveShadow = true;
    let count = 0;
    for (let i = 0; i < GRASS_COUNT * 2 && count < GRASS_COUNT; i++) {
      const r = Math.sqrt(Math.random()) * (WORLD_RADIUS + 16);
      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // patchiness like the ez-tree app: thin out where the noise runs high
      const n = vnoise(x * 0.09 + 31, z * 0.09 + 17);
      if (n > 0.68 && Math.random() < 0.75) continue;
      const th = rand(0.5, 1.1); // tuft height in world units
      const k = th / gh;
      _q.setFromAxisAngle(_up, Math.random() * Math.PI * 2);
      _p.set(x, heightAt(x, z) - 0.03, z);
      _s.set(k * rand(0.8, 1.35), k, k * rand(0.8, 1.35));
      _m.compose(_p, _q, _s);
      grass.setMatrixAt(count, _m);
      count++;
    }
    grass.count = count;
    grass.instanceMatrix.needsUpdate = true;
    scene.add(grass);
  }

  // --- flowers: instanced — hundreds of blooms for a few draw calls,
  // planted in clumps the way wildflowers actually grow ---
  for (const flowerScene of assets.flowers) {
    const box = new THREE.Box3().setFromObject(flowerScene);
    const fh = Math.max(0.01, box.max.y - box.min.y);
    flowerScene.updateMatrixWorld(true);
    const placements = [];
    const addPlacement = (x, z) => placements.push({
      x, z, rot: Math.random() * Math.PI * 2, k: rand(0.35, 0.6) / fh,
    });
    for (let c = 0; c < 7; c++) {
      const cr = Math.sqrt(Math.random()) * (WORLD_RADIUS + 4);
      const ca = Math.random() * Math.PI * 2;
      const cx = Math.cos(ca) * cr;
      const cz = Math.sin(ca) * cr;
      const n = 8 + Math.floor(Math.random() * 6);
      const spread = rand(1.5, 3.5);
      for (let i = 0; i < n; i++) {
        const rr = Math.sqrt(Math.random()) * spread;
        const aa = Math.random() * Math.PI * 2;
        addPlacement(cx + Math.cos(aa) * rr, cz + Math.sin(aa) * rr);
      }
    }
    // lone strays between the clumps
    for (let i = 0; i < 20; i++) {
      const r = Math.sqrt(Math.random()) * (WORLD_RADIUS + 6);
      const a = Math.random() * Math.PI * 2;
      addPlacement(Math.cos(a) * r, Math.sin(a) * r);
    }
    const local = new THREE.Matrix4();
    flowerScene.traverse((o) => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, placements.length);
      placements.forEach((it, i) => {
        _q.setFromAxisAngle(_up, it.rot);
        _p.set(it.x, heightAt(it.x, it.z), it.z);
        _s.set(it.k, it.k, it.k);
        _m.compose(_p, _q, _s);
        local.copy(o.matrixWorld);
        _m.multiply(local);
        im.setMatrixAt(i, _m);
      });
      im.instanceMatrix.needsUpdate = true;
      im.receiveShadow = true;
      scene.add(im);
    });
  }

  // --- obstacles + collision geometry pool ---
  const obstacles = [];
  const collisionGeos = [];

  function addCollisionCylinder(x, z, radius, height) {
    const cg = new THREE.CylinderGeometry(radius, radius, height, 7);
    cg.deleteAttribute('normal');
    cg.deleteAttribute('uv');
    const y = heightAt(x, z);
    cg.translate(x, y + height / 2 - 0.5, z);
    collisionGeos.push(cg.toNonIndexed());
  }

  // --- rocks: the app's three GLB rock models, instanced ---
  {
    const placements = [[], [], []];
    function placeRock(x, z, big) {
      const v = Math.floor(Math.random() * 3);
      const sc = big ? rand(1.1, 2.4) : rand(0.45, 1.1);
      placements[v].push({ x, z, sc, rot: Math.random() * Math.PI * 2 });
      obstacles.push({ x, z, r: sc * 0.7 + 0.2 });
      if (sc > 0.8) addCollisionCylinder(x, z, sc * 0.65, sc * 1.2);
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(8, WORLD_RADIUS + 4);
      placeRock(Math.cos(a) * r, Math.sin(a) * r, Math.random() < 0.3);
    }
    // decorative boulders out on the hills
    const hillRocks = [[], [], []];
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(60, 130);
      hillRocks[Math.floor(Math.random() * 3)].push({
        x: Math.cos(a) * r, z: Math.sin(a) * r, sc: rand(1.5, 3.5), rot: Math.random() * Math.PI * 2,
      });
    }

    assets.rocks.forEach((src, v) => {
      src.geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      src.geometry.boundingBox.getSize(size);
      const norm = 1.6 / Math.max(size.x, size.y, size.z); // ~1.6m at scale 1
      const list = [...placements[v], ...hillRocks[v]];
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(src.geometry, src.material, list.length);
      list.forEach((it, i) => {
        _q.setFromAxisAngle(_up, it.rot);
        _p.set(it.x, heightAt(it.x, it.z) - 0.12 * it.sc, it.z);
        const k = norm * it.sc;
        _s.set(k, k * rand(0.8, 1), k);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    });
  }

  // --- trees: ez-tree variants, fully instanced — a real forest ---
  const treeVariants = [
    buildEzTree('Oak Medium', 101, 7.0),
    buildEzTree('Oak Medium', 2057, 6.4),
    buildEzTree('Ash Medium', 7793, 6.2),
    buildEzTree('Aspen Medium', 4421, 5.8),
    buildEzTree('Oak Large', 911, 8.2),
  ];
  {
    const placements = treeVariants.map(() => []);
    function placeTree(x, z, collide) {
      const v = Math.floor(Math.random() * treeVariants.length);
      placements[v].push({ x, z, jitter: rand(0.85, 1.25), rot: Math.random() * Math.PI * 2 });
      if (collide) {
        obstacles.push({ x, z, r: 0.7 });
        addCollisionCylinder(x, z, 0.45, 5);
      }
    }
    // the playable meadow: a real scattering of trees (clear near spawn)
    for (let i = 0; i < 58; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 14 + Math.sqrt(Math.random()) * (WORLD_RADIUS - 10);
      placeTree(Math.cos(a) * r, Math.sin(a) * r, true);
    }
    // dense treeline ringing the hills
    for (let i = 0; i < 240; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(58, 145);
      placeTree(Math.cos(a) * r, Math.sin(a) * r, false);
    }

    treeVariants.forEach((variant, v) => {
      const list = placements[v];
      if (!list.length) return;
      const branches = new THREE.InstancedMesh(variant.branchGeo, variant.branchMat, list.length);
      const leaves = new THREE.InstancedMesh(variant.leafGeo, variant.leafMat, list.length);
      list.forEach((it, i) => {
        _q.setFromAxisAngle(_up, it.rot);
        const k = variant.k * it.jitter;
        _p.set(it.x, heightAt(it.x, it.z) - 0.06, it.z);
        _s.set(k, k, k);
        _m.compose(_p, _q, _s);
        branches.setMatrixAt(i, _m);
        leaves.setMatrixAt(i, _m);
      });
      branches.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.needsUpdate = true;
      branches.castShadow = true;
      branches.receiveShadow = true;
      leaves.castShadow = true;
      scene.add(branches, leaves);
    });
  }

  // --- bushes: small ez-tree foliage, instanced too ---
  {
    const bushVariants = [
      buildEzTree('Bush 1', 31, 1.5),
      buildEzTree('Bush 2', 77, 1.2),
      buildEzTree('Bush 3', 123, 1.7),
    ];
    const placements = bushVariants.map(() => []);
    for (let i = 0; i < 44; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(10, WORLD_RADIUS + 4);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      placements[Math.floor(Math.random() * bushVariants.length)].push({ x, z });
      obstacles.push({ x, z, r: 0.55 });
    }
    bushVariants.forEach((variant, v) => {
      const list = placements[v];
      if (!list.length) return;
      const branches = new THREE.InstancedMesh(variant.branchGeo, variant.branchMat, list.length);
      const leaves = new THREE.InstancedMesh(variant.leafGeo, variant.leafMat, list.length);
      list.forEach((it, i) => {
        _q.setFromAxisAngle(_up, Math.random() * Math.PI * 2);
        const k = variant.k * rand(0.7, 1.5);
        _p.set(it.x, heightAt(it.x, it.z) - 0.05, it.z);
        _s.set(k, k, k);
        _m.compose(_p, _q, _s);
        branches.setMatrixAt(i, _m);
        leaves.setMatrixAt(i, _m);
      });
      branches.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.needsUpdate = true;
      branches.castShadow = true;
      leaves.castShadow = true;
      scene.add(branches, leaves);
    });
  }

  // --- ruins: mossy pillars (kept procedural — they're architecture) ---
  const rockMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  const stoneTone = mx_noise_float(positionWorld.mul(0.8)).mul(0.5).add(0.5);
  const stoneCol = mix(vec3(0.45, 0.44, 0.42), vec3(0.62, 0.60, 0.56), stoneTone);
  const mossAmt = smoothstep(0.45, 0.95, normalWorld.y).mul(saturate(mx_noise_float(positionWorld.mul(1.4)).mul(0.5).add(0.6)));
  rockMat.colorNode = mix(stoneCol, vec3(0.27, 0.40, 0.16), mossAmt.mul(0.8));

  {
    const cx = -18;
    const cz = -14;
    const count = 6;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const x = cx + Math.cos(a) * 5;
      const z = cz + Math.sin(a) * 5;
      const ph = i % 3 === 0 ? rand(0.6, 1) : rand(2, 3.4);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, ph, 8), rockMat);
      pillar.position.set(x, heightAt(x, z) + ph / 2, z);
      pillar.rotation.y = rand(0, Math.PI);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      scene.add(pillar);
      obstacles.push({ x, z, r: 0.8 });
      addCollisionCylinder(x, z, 0.5, ph + 1);
    }
  }

  // --- static collider BVH (trees, rocks, ruins) ---
  let collider = null;
  if (collisionGeos.length) {
    const merged = mergeGeometries(collisionGeos);
    collider = new THREE.Mesh(merged);
    collider.visible = false;
    merged.boundsTree = new MeshBVH(merged);
    scene.add(collider);
  }

  return { sun, obstacles, ground, collider, shadowSize };
}
