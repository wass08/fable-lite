import * as THREE from 'three/webgpu';

const _segment = new THREE.Line3();
const _box = new THREE.Box3();
const _triPoint = new THREE.Vector3();
const _capPoint = new THREE.Vector3();
const _dir = new THREE.Vector3();

// push a vertical capsule (feet at `position`) out of the static collider BVH.
// only x/z are corrected — terrain height owns y.
export function resolveCapsule(collider, position, radius = 0.45, height = 1.5) {
  if (!collider) return;
  const bvh = collider.geometry.boundsTree;
  _segment.start.set(position.x, position.y + radius, position.z);
  _segment.end.set(position.x, position.y + height - radius, position.z);
  _box.makeEmpty();
  _box.expandByPoint(_segment.start);
  _box.expandByPoint(_segment.end);
  _box.min.addScalar(-radius);
  _box.max.addScalar(radius);

  bvh.shapecast({
    intersectsBounds: (box) => box.intersectsBox(_box),
    intersectsTriangle: (tri) => {
      const distance = tri.closestPointToSegment(_segment, _triPoint, _capPoint);
      if (distance < radius) {
        const depth = radius - distance;
        _dir.subVectors(_capPoint, _triPoint);
        _dir.y = 0; // slide, don't climb
        if (_dir.lengthSq() < 1e-8) return;
        _dir.normalize();
        _segment.start.addScaledVector(_dir, depth);
        _segment.end.addScaledVector(_dir, depth);
      }
    },
  });

  position.x = _segment.start.x;
  position.z = _segment.start.z;
}

const _ray = new THREE.Ray();

// first BVH hit along a segment, or null — used for projectile vs world
export function raycastWorld(collider, from, velocity, maxDist) {
  if (!collider) return null;
  _ray.origin.copy(from);
  _ray.direction.copy(velocity).normalize();
  const hit = collider.geometry.boundsTree.raycastFirst(_ray);
  if (hit && hit.distance <= maxDist) return hit;
  return null;
}
