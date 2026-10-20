import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import View from './View'
import State from '../State/State'
import { PLANT, Plant } from '../State/Vegetation'
import { CLOUD_UNIFORMS, LIGHT_UNIFORMS } from './Sky'
import Shadows, { SHADOW_UNIFORMS } from './Shadows'
import vertexShader from './Materials/shaders/rocks/vertex.glsl'
import fragmentShader from './Materials/shaders/rocks/fragment.glsl'

// Full scans near the player, simplified ones farther (cross-fading over BAND m, by the
// camera's distance); tiny far rocks aren't drawn
const NEAR = 45
const BAND = 8
const REBUILD = 12
const MIN_ANGULAR_SIZE = 0.0025

type Layer = { mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>, instance: THREE.InstancedBufferAttribute, extra: THREE.InstancedBufferAttribute }

/**
 * Draws the boulders placed by State/Vegetation (trees and bushes: View/Trees) with
 * photo-scanned rocks (Poly Haven, tools/nature/build.mjs): each rock picks one of the
 * scanned shapes, in one of two levels of detail by distance; one instanced mesh per shape
 * and level, refilled whenever the plants change or the player has moved enough.
 */
export default class Vegetation {
    private rockGeometry: THREE.BufferGeometry[] = []
    view: View
    state: State
    scene: THREE.Scene
    layers = new Map<string, Layer>()
    uniforms: Record<string, THREE.IUniform>
    instanceCount = 0
    shapes = 0

    private version = -1
    private builtAt = new THREE.Vector2(Infinity, Infinity)
    private cameraOffset = 0

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.scene = this.view.scene

        this.uniforms = {
            uSunPosition: { value: new THREE.Vector3(0, 1, 0) },
            uSkyLut: { value: this.view.skyLut.texture },
            uEye: { value: new THREE.Vector3() }
        }
        for (const name of [...LIGHT_UNIFORMS, ...CLOUD_UNIFORMS])
            this.uniforms[name] = this.view.sky.uniforms[name]
        for (const name of SHADOW_UNIFORMS)
            this.uniforms[name] = this.view.shadows.uniforms[name]

        this.load()
    }

    private async load() {
        const gltf = await new GLTFLoader().loadAsync('/models/nature/rocks.glb')
        const loader = new THREE.TextureLoader()
        const materials = new Map<string, THREE.ShaderMaterial>()
        const textures = new Map<string, THREE.Texture>()       // shared by both levels
        const material = (set: string, lod: number) => {
            let result = materials.get(`${set}:${lod}`)
            if (!result) {
                const texture = (name: string) => {
                    const cached = textures.get(`${set}_${name}`)
                    if (cached)
                        return cached
                    const map = loader.load(`/textures/nature/${set}_${name}.webp`)
                    textures.set(`${set}_${name}`, map)
                    map.flipY = false                 // glTF texture coordinates
                    map.anisotropy = 8
                    map.colorSpace = THREE.NoColorSpace     // the shader decodes the colour (toLinear)
                    return map
                }
                result = new THREE.ShaderMaterial({
                    vertexShader,
                    fragmentShader,
                    uniforms: { ...this.uniforms, uMap: { value: texture('color') }, uNormalMap: { value: texture('normal') }, uLodFade: { value: new THREE.Vector3(NEAR - BAND / 2, NEAR + BAND / 2, lod) } }
                })
                materials.set(`${set}:${lod}`, result)
            }
            return result
        }

        // each mesh's extras: its texture set, which rock, which level of detail
        const shapes = new Map<string, number>()
        gltf.scene.traverse((object) => {
            const source = object as THREE.Mesh
            if (!source.isMesh)
                return
            const { textures: set, rock: shapeKey, lod } = source.userData as { textures: string, rock: string, lod: number }
            if (!shapes.has(shapeKey))
                shapes.set(shapeKey, shapes.size)
            if (lod === 0)
                this.rockGeometry[shapes.get(shapeKey)!] = source.geometry
            const geometry = new THREE.InstancedBufferGeometry()
            geometry.index = source.geometry.index
            for (const name of ['position', 'normal', 'uv'])
                geometry.setAttribute(name, source.geometry.getAttribute(name))
            const instance = new THREE.InstancedBufferAttribute(new Float32Array(64 * 4), 4).setUsage(THREE.DynamicDrawUsage)
            const extra = new THREE.InstancedBufferAttribute(new Float32Array(64 * 2), 2).setUsage(THREE.DynamicDrawUsage)
            geometry.setAttribute('aInstance', instance)
            geometry.setAttribute('aInstanceExtra', extra)
            geometry.instanceCount = 0
            geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
            const mesh = new THREE.Mesh(geometry, material(set, lod))
            mesh.frustumCulled = false
            this.view.shadows.addCaster(mesh, Shadows.shadowVariant(mesh.material))
            this.scene.add(mesh)
            this.layers.set(`${shapes.get(shapeKey)}:${lod}`, { mesh, instance, extra })
        })
        this.shapes = shapes.size
        this.version = -1
    }

    /**
     * Where a segment (from -> to, world) first meets a rock as it's drawn, and the surface's
     * normal there; null if it misses (arrows strike the real rock, not its rough collider).
     */
    rockHit(plant: Plant, from: THREE.Vector3, to: THREE.Vector3) {
        const shape = Math.floor((plant.tint * 7.31 + plant.rotation * 0.37) % 1 * this.shapes)
        const geometry = this.rockGeometry[shape]
        if (!geometry)
            return null
        // into the rock's own space (as the vertex shader places it: scaled, turned, moved)
        const size = plant.scale * 1.15
        const center = new THREE.Vector3(plant.x, plant.y + plant.scale * 0.2, plant.z)
        const c = Math.cos(plant.rotation), s = Math.sin(plant.rotation)
        const toLocal = (p: THREE.Vector3) => {
            const d = p.clone().sub(center).divideScalar(size)
            return new THREE.Vector3(c * d.x - s * d.z, d.y, s * d.x + c * d.z)
        }
        const toWorld = (p: THREE.Vector3) => new THREE.Vector3(c * p.x + s * p.z, p.y, - s * p.x + c * p.z).multiplyScalar(size).add(center)
        const a = toLocal(from), b = toLocal(to)
        const length = a.distanceTo(b)
        if (length < 1e-6)
            return null
        const ray = new THREE.Ray(a, b.clone().sub(a).divideScalar(length))
        const position = geometry.getAttribute('position') as THREE.BufferAttribute
        const index = geometry.index
        const count = index ? index.count : position.count
        const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), hit = new THREE.Vector3()
        let best = Infinity, normal: THREE.Vector3 | null = null
        for (let i = 0; i < count; i += 3) {
            const i0 = index ? index.getX(i) : i, i1 = index ? index.getX(i + 1) : i + 1, i2 = index ? index.getX(i + 2) : i + 2
            v0.fromBufferAttribute(position, i0)
            v1.fromBufferAttribute(position, i1)
            v2.fromBufferAttribute(position, i2)
            if (ray.intersectTriangle(v0, v1, v2, false, hit)) {
                const t = hit.distanceTo(a)
                if (t < best && t <= length) {
                    best = t
                    normal = new THREE.Vector3().crossVectors(v1.clone().sub(v0), v2.clone().sub(v0)).normalize()
                }
            }
        }
        if (!normal)
            return null
        const point = toWorld(a.clone().addScaledVector(ray.direction, best))
        const n = new THREE.Vector3(c * normal.x + s * normal.z, normal.y, - s * normal.x + c * normal.z).normalize()
        if (n.dot(to.clone().sub(from)) > 0) n.negate()
        return { point, normal: n }
    }

    /** Make room for `count` instances (grows by doubling). */
    private reserve(layer: Layer, count: number) {
        if (count <= layer.instance.count)
            return
        let capacity = layer.instance.count
        while (capacity < count)
            capacity *= 2
        layer.instance = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage)
        layer.extra = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage)
        layer.mesh.geometry.setAttribute('aInstance', layer.instance)
        layer.mesh.geometry.setAttribute('aInstanceExtra', layer.extra)
    }

    private rebuild() {
        const p = this.state.player.position.current
        const buckets = new Map<string, number[]>()
        for (const key of this.layers.keys())
            buckets.set(key, [])

        // both levels reach past the hand-over by the camera's lag behind the player and a
        // rebuild's step, so a rock there always has both to cross-fade
        const eye = this.view.camera.instance.position
        this.cameraOffset = Math.hypot(eye.x - p[0], eye.z - p[2])
        const overlap = this.cameraOffset + REBUILD + 1
        let total = 0
        for (const cell of this.state.vegetation.cells.values()) {
            for (const plant of cell.plants) {
                if (plant.kind !== PLANT.ROCK)
                    continue
                const distance = Math.hypot(plant.x - p[0], plant.z - p[2])
                if (plant.scale / Math.max(distance, 1) < MIN_ANGULAR_SIZE)
                    continue
                const shape = Math.floor((plant.tint * 7.31 + plant.rotation * 0.37) % 1 * this.shapes)
                for (const lod of [0, 1]) {
                    if (lod === 0 ? distance > NEAR + BAND / 2 + overlap : distance < NEAR - BAND / 2 - overlap)
                        continue
                    const bucket = buckets.get(`${shape}:${lod}`)
                    if (!bucket)
                        continue
                    // the state sinks its rocks by a third of their size; the scans sit lower
                    bucket.push(plant.x, plant.y + plant.scale * 0.2, plant.z, plant.scale * 1.15, plant.rotation, plant.tint)
                    total++
                }
            }
        }

        for (const [key, values] of buckets) {
            const layer = this.layers.get(key)!
            const count = values.length / 6
            this.reserve(layer, count)
            const instance = layer.instance.array as Float32Array
            const extra = layer.extra.array as Float32Array
            for (let i = 0; i < count; i++) {
                instance[i * 4] = values[i * 6]
                instance[i * 4 + 1] = values[i * 6 + 1]
                instance[i * 4 + 2] = values[i * 6 + 2]
                instance[i * 4 + 3] = values[i * 6 + 3]
                extra[i * 2] = values[i * 6 + 4]
                extra[i * 2 + 1] = values[i * 6 + 5]
            }
            layer.instance.needsUpdate = true
            layer.extra.needsUpdate = true
            layer.mesh.geometry.instanceCount = count
        }
        this.instanceCount = total
        this.version = this.state.vegetation.version
        this.builtAt.set(p[0], p[2])
    }

    update() {
        const p = this.state.player.position.current
        const eye = this.view.camera.instance.position
        if (this.shapes && (this.version !== this.state.vegetation.version || Math.hypot(p[0] - this.builtAt.x, p[2] - this.builtAt.y) > REBUILD
            || Math.abs(Math.hypot(eye.x - p[0], eye.z - p[2]) - this.cameraOffset) > 2))
            this.rebuild()
        this.uniforms.uEye.value.copy(eye)

        const sun = this.state.sun.position
        this.uniforms.uSunPosition.value.set(sun.x, sun.y, sun.z)
    }
}
