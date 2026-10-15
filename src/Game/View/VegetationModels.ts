import * as THREE from 'three'
import seedrandom from 'seedrandom'

import { createNoise3D } from '../Workers/SimplexNoise'

/**
 * Procedural boulder mesh (no assets), radius 1. Every vertex carries `aShape`:
 *   x  ambient occlusion (dark inside crowns and under branches)
 *   y  1 on bark, 0 on foliage / stone
 *   z  how much the wind sways it (0 at the roots, 1 at the tips)
 * Normals on foliage point out of the crown rather than off each facet, so crowns read
 * as soft masses instead of polyhedra.
 */

type Builder = { positions: number[], normals: number[], shapes: number[], indices: number[] }

const builder = (): Builder => ({ positions: [], normals: [], shapes: [], indices: [] })

function vertex(b: Builder, p: THREE.Vector3, n: THREE.Vector3, ao: number, bark: number, sway: number) {
    b.positions.push(p.x, p.y, p.z)
    b.normals.push(n.x, n.y, n.z)
    b.shapes.push(ao, bark, sway)
    return b.positions.length / 3 - 1
}

function finish(b: Builder) {
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3))
    geometry.setAttribute('aShape', new THREE.Float32BufferAttribute(b.shapes, 3))
    geometry.setIndex(b.indices)
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    return geometry
}

/** A lumpy blob: an icosahedron displaced by noise, normals from the given centre. */
function blob(b: Builder, center: THREE.Vector3, radius: number, subdivisions: number, seed: string, options: { crownCenter: THREE.Vector3, crownRadius: number, squash?: number, bark?: number, sway?: number, rock?: boolean }) {
    const noise = createNoise3D(seedrandom(seed))
    const source = new THREE.IcosahedronGeometry(1, subdivisions)
    const position = source.getAttribute('position')
    const start = b.positions.length / 3
    // the icosahedron is unindexed; weld so the displacement stays watertight
    const map = new Map<string, number>()
    const remap: number[] = []
    const v = new THREE.Vector3()
    for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i)
        const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`
        let index = map.get(key)
        if (index === undefined) {
            const d = v.clone()
            const lump = options.rock
                ? 1 + noise(d.x * 1.3, d.y * 1.3, d.z * 1.3) * 0.28 + noise(d.x * 3.1, d.y * 3.1, d.z * 3.1) * 0.1
                : 1 + noise(d.x * 1.8, d.y * 1.8, d.z * 1.8) * 0.22 + noise(d.x * 4.5, d.y * 4.5, d.z * 4.5) * 0.08
            const p = d.clone().multiplyScalar(radius * lump)
            p.y *= options.squash ?? 1
            p.add(center)
            const fromCrown = p.clone().sub(options.crownCenter)
            const normal = options.rock ? d.clone() : fromCrown.clone().normalize().lerp(d, 0.35).normalize()
            // dark inside / underneath the crown, light on the outside top
            const depth = THREE.MathUtils.clamp(fromCrown.length() / options.crownRadius, 0, 1)
            const ao = options.rock ? 0.7 + 0.3 * THREE.MathUtils.clamp(d.y * 0.5 + 0.5, 0, 1) : (0.35 + 0.65 * depth) * (0.72 + 0.28 * THREE.MathUtils.clamp(normal.y * 0.5 + 0.5, 0, 1))
            index = vertex(b, p, normal, ao, options.bark ?? 0, options.sway ?? p.y)
            map.set(key, index)
        }
        remap.push(index)
    }
    for (let i = 0; i < remap.length; i += 3)
        b.indices.push(remap[i], remap[i + 1], remap[i + 2])
    source.dispose()
    return start
}

/** Boulder: a flattened, weathered lump of stone. */
export function rock(detail: 'near' | 'far') {
    const b = builder()
    const center = new THREE.Vector3(0, 0, 0)
    blob(b, center, 1, detail === 'near' ? 2 : 1, 'rock', { crownCenter: center, crownRadius: 1, squash: 0.62, sway: 0, rock: true })
    return finish(b)
}
