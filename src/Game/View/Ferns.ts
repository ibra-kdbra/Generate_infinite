import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import seedrandom from 'seedrandom'

import Game from '../Game'
import View from './View'
import State from '../State/State'
import Settings, { Quality } from '../Settings'
import { CLOUD_UNIFORMS, LIGHT_UNIFORMS } from './Sky'
import { SHADOW_UNIFORMS } from './Shadows'
import { WATER_LEVEL } from '../Workers/TerrainShape'
import vertexShader from './Materials/shaders/ferns/vertex.glsl'
import fragmentShader from './Materials/shaders/ferns/fragment.glsl'

// How far ferns are drawn, by quality (none on low)
const RADIUS: Record<Quality, number> = { low: 0, medium: 26, high: 34, ultra: 44 }
const PATCH = 8
const CANDIDATES = 18          // tries per patch (8 × 8 m): dense where the forest is thick
const LIGHT_VARIANTS = 18      // beyond this distance only the two lighter scans are drawn (cross-fading over SWAP m)
const SWAP = 4
const REBUILD = 4              // the lists are refilled after the player has gone this far

type Fern = { x: number, y: number, z: number, scale: number, rotation: number, tint: number, variant: number }

/**
 * Ferns on the forest floor (Poly Haven's fern_02 scans, tools/nature/build.mjs): scattered
 * in world-fixed patches around the player wherever State/Vegetation's forest map is thick
 * (and at forest edges), off steep slopes and out of the water. Each patch's ferns are
 * placed once (deterministically, from the seed) and kept; the visible ones are refilled
 * into one instanced mesh per scan when the player has moved a few metres.
 */
export default class Ferns {
    view: View
    state: State
    uniforms: Record<string, THREE.IUniform>
    radius = 0
    count = 0
    private meshes: { mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>, instance: THREE.InstancedBufferAttribute, extra: THREE.InstancedBufferAttribute }[] = []
    private patches = new Map<string, Fern[] | null>()
    private builtAt = new THREE.Vector2(Infinity, Infinity)
    private seed: string
    private retry = 0             // seconds until patches still waiting for terrain are tried again

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.seed = Game.getInstance().seed + 'ferns'

        this.uniforms = {
            uTime: { value: 0 },
            uSunPosition: { value: new THREE.Vector3(0, 1, 0) },
            uNoiseTexture: { value: this.view.noises.texture },
            uCenter: { value: new THREE.Vector3() },
            uFernFade: { value: new THREE.Vector3(LIGHT_VARIANTS - SWAP / 2, LIGHT_VARIANTS + SWAP / 2, 0) }
        }
        for (const name of [...LIGHT_UNIFORMS, ...CLOUD_UNIFORMS])
            this.uniforms[name] = this.view.sky.uniforms[name]
        for (const name of SHADOW_UNIFORMS)
            this.uniforms[name] = this.view.shadows.uniforms[name]

        const settings = Settings.getInstance()
        this.radius = RADIUS[settings.get('quality')]
        settings.events.on('change:quality', (quality: Quality) => {
            this.radius = RADIUS[quality]
            this.builtAt.set(Infinity, Infinity)
        })
        this.load()
    }

    private async load() {
        const gltf = await new GLTFLoader().loadAsync('/models/nature/ferns.glb')
        const loader = new THREE.TextureLoader()
        const texture = (name: string) => {
            const map = loader.load(`/textures/nature/fern_02_${name}.webp`)
            map.flipY = false
            map.anisotropy = 4
            map.colorSpace = THREE.NoColorSpace
            return map
        }
        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: { ...this.uniforms, uMap: { value: texture('color') }, uNormalMap: { value: texture('normal') } },
            side: THREE.DoubleSide
        })
        // lighter scans first: the far ferns use only those
        const sources: THREE.Mesh[] = []
        gltf.scene.traverse((object) => { if ((object as THREE.Mesh).isMesh) sources.push(object as THREE.Mesh) })
        sources.sort((a, b) => (a.geometry.index?.count ?? 0) - (b.geometry.index?.count ?? 0))
        for (const source of sources) {
            const geometry = new THREE.InstancedBufferGeometry()
            geometry.index = source.geometry.index
            for (const name of ['position', 'normal', 'uv'])
                geometry.setAttribute(name, source.geometry.getAttribute(name))
            const instance = new THREE.InstancedBufferAttribute(new Float32Array(256 * 4), 4).setUsage(THREE.DynamicDrawUsage)
            const extra = new THREE.InstancedBufferAttribute(new Float32Array(256 * 2), 2).setUsage(THREE.DynamicDrawUsage)
            geometry.setAttribute('aInstance', instance)
            geometry.setAttribute('aInstanceExtra', extra)
            geometry.instanceCount = 0
            geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
            const mesh = new THREE.Mesh(geometry, material)
            mesh.frustumCulled = false
            this.view.scene.add(mesh)
            this.meshes.push({ mesh, instance, extra })
        }
    }

    /** The ferns of one patch, placed once; null while the terrain there isn't ready. */
    private patch(ix: number, iz: number) {
        const key = `${ix}:${iz}`
        const cached = this.patches.get(key)
        if (cached)
            return cached
        const random = seedrandom(`${this.seed}:${ix}:${iz}`)
        const ferns: Fern[] = []
        const vegetation = this.state.vegetation
        for (let i = 0; i < CANDIDATES; i++) {
            const x = (ix + random()) * PATCH, z = (iz + random()) * PATCH
            const roll = random(), a = random(), b = random(), c = random(), d = random()
            const forest = vegetation.forestAt(x, z)
            // thick in the forest, a few along its edges
            if (roll > forest * 0.9 + 0.02)
                continue
            const e = this.state.chunks.getElevationForPosition(x, z)
            if (typeof e !== 'number' || Number.isNaN(e))
                return null
            const ex = this.state.chunks.getElevationForPosition(x + 1, z)
            const ez = this.state.chunks.getElevationForPosition(x, z + 1)
            if (typeof ex !== 'number' || typeof ez !== 'number')
                return null
            const slope = 1 - 1 / Math.hypot(ex - e, 1, ez - e)
            if (slope > 0.3 || e < WATER_LEVEL + 0.6 || e > 190)
                continue
            ferns.push({ x, y: e - 0.03, z, scale: 1.5 + a * 1.6, rotation: b * Math.PI * 2, tint: c, variant: Math.floor(d * 4) })
        }
        this.patches.set(key, ferns)
        return ferns
    }

    private rebuild() {
        const p = this.state.player.position.current
        const buckets: number[][] = this.meshes.map(() => [])
        let total = 0
        let waiting = false
        if (this.radius > 0 && this.meshes.length) {
            const r = this.radius + REBUILD
            for (let ix = Math.floor((p[0] - r) / PATCH); ix <= Math.floor((p[0] + r) / PATCH); ix++) {
                for (let iz = Math.floor((p[2] - r) / PATCH); iz <= Math.floor((p[2] + r) / PATCH); iz++) {
                    if (Math.hypot((ix + 0.5) * PATCH - p[0], (iz + 0.5) * PATCH - p[2]) > r + PATCH)
                        continue
                    const ferns = this.patch(ix, iz)
                    if (!ferns) {
                        waiting = true
                        continue
                    }
                    // (the lists reach a rebuild's step past where the fades, by the player's
                    // distance now, end: what fades is always there to fade)
                    for (const fern of ferns) {
                        const distance = Math.hypot(fern.x - p[0], fern.z - p[2])
                        if (distance > r)
                            continue
                        const add = (variant: number, role: number) => {
                            buckets[variant % this.meshes.length].push(fern.x, fern.y, fern.z, fern.scale, fern.rotation, fern.tint + role * 2)
                            total++
                        }
                        if (fern.variant < 2)
                            add(fern.variant, 0)
                        else {
                            if (distance < LIGHT_VARIANTS + SWAP / 2 + REBUILD) add(fern.variant, 1)
                            if (distance > LIGHT_VARIANTS - SWAP / 2 - REBUILD) add(fern.variant % 2, 2)
                        }
                    }
                }
            }
        }
        // forget patches far behind
        if (this.patches.size > 600)
            for (const key of this.patches.keys()) {
                const [ix, iz] = key.split(':').map(Number)
                if (Math.hypot((ix + 0.5) * PATCH - p[0], (iz + 0.5) * PATCH - p[2]) > this.radius * 3 + 64)
                    this.patches.delete(key)
            }

        this.meshes.forEach((layer, i) => {
            const values = buckets[i]
            const count = values.length / 6
            if (count > layer.instance.count) {
                let capacity = layer.instance.count
                while (capacity < count)
                    capacity *= 2
                layer.instance = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage)
                layer.extra = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage)
                layer.mesh.geometry.setAttribute('aInstance', layer.instance)
                layer.mesh.geometry.setAttribute('aInstanceExtra', layer.extra)
            }
            const instance = layer.instance.array as Float32Array
            const extra = layer.extra.array as Float32Array
            for (let k = 0; k < count; k++) {
                instance[k * 4] = values[k * 6]
                instance[k * 4 + 1] = values[k * 6 + 1]
                instance[k * 4 + 2] = values[k * 6 + 2]
                instance[k * 4 + 3] = values[k * 6 + 3]
                extra[k * 2] = values[k * 6 + 4]
                extra[k * 2 + 1] = values[k * 6 + 5]
            }
            layer.instance.needsUpdate = true
            layer.extra.needsUpdate = true
            layer.mesh.geometry.instanceCount = count
        })
        this.count = total
        this.builtAt.set(p[0], p[2])
        this.retry = waiting ? 0.5 : Infinity
    }

    setVisible(visible: boolean) {
        for (const { mesh } of this.meshes)
            mesh.visible = visible
    }

    update() {
        const p = this.state.player.position.current
        this.retry -= this.state.time.delta
        if (this.meshes.length && (this.retry <= 0 || Math.hypot(p[0] - this.builtAt.x, p[2] - this.builtAt.y) > REBUILD))
            this.rebuild()
        this.uniforms.uCenter.value.set(p[0], p[1], p[2])
        this.uniforms.uFernFade.value.z = this.radius
        const sun = this.state.sun.position
        this.uniforms.uSunPosition.value.set(sun.x, sun.y, sun.z)
        this.uniforms.uTime.value = this.state.time.elapsed
    }
}
