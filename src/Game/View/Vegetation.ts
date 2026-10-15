import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import { PLANT, PlantKind } from '../State/Vegetation'
import { CLOUD_UNIFORMS, LIGHT_UNIFORMS } from './Sky'
import Shadows, { SHADOW_UNIFORMS } from './Shadows'
import { rock } from './VegetationModels'
import vertexShader from './Materials/shaders/vegetation/vertex.glsl'
import fragmentShader from './Materials/shaders/vegetation/fragment.glsl'

type Look = { colorA: string, colorB: string, bark: string, sway: number, translucency: number, rock: number, near: number }

// Boulders (trees and bushes are View/Trees)
const LOOKS: Partial<Record<PlantKind, Look>> = {
    [PLANT.ROCK]: { colorA: '#5a5650', colorB: '#7a756c', bark: '#000000', sway: 0, translucency: 0, rock: 1, near: 70 }
}

const MODELS: Partial<Record<PlantKind, (detail: 'near' | 'far') => THREE.InstancedBufferGeometry>> = {
    [PLANT.ROCK]: rock
}

type Layer = { mesh: THREE.Mesh, geometry: THREE.InstancedBufferGeometry, instance: THREE.InstancedBufferAttribute, extra: THREE.InstancedBufferAttribute }

/**
 * Draws the boulders placed by State/Vegetation (trees and bushes: View/Trees): one
 * instanced mesh per level of detail (full models near the player, simplified farther away),
 * refilled whenever the plants change or the player has moved enough to change which are
 * near.
 */
export default class Vegetation {
    view: View
    state: State
    scene: THREE.Scene
    layers = new Map<string, Layer>()
    materials = new Map<PlantKind, THREE.ShaderMaterial>()
    uniforms: Record<string, THREE.IUniform>
    instanceCount = 0

    private version = -1
    private builtAt = new THREE.Vector2(Infinity, Infinity)

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.scene = this.view.scene

        this.uniforms = {
            uTime: { value: 0 },
            uSunPosition: { value: new THREE.Vector3(0, 1, 0) },
            uNoiseTexture: { value: this.view.noises.texture },
            uSkyLut: { value: this.view.skyLut.texture }
        }
        for (const name of [...LIGHT_UNIFORMS, ...CLOUD_UNIFORMS])
            this.uniforms[name] = this.view.sky.uniforms[name]
        for (const name of SHADOW_UNIFORMS)
            this.uniforms[name] = this.view.shadows.uniforms[name]

        for (const kind of [PLANT.ROCK] as PlantKind[]) {
            const look = LOOKS[kind]!
            const material = new THREE.ShaderMaterial({
                vertexShader,
                fragmentShader,
                uniforms: {
                    ...this.uniforms,
                    // the world's shaders work in display values: no sRGB -> linear conversion
                    uColorA: { value: new THREE.Color().setStyle(look.colorA, THREE.LinearSRGBColorSpace) },
                    uColorB: { value: new THREE.Color().setStyle(look.colorB, THREE.LinearSRGBColorSpace) },
                    uBark: { value: new THREE.Color().setStyle(look.bark, THREE.LinearSRGBColorSpace) },
                    uSway: { value: look.sway },
                    uRock: { value: look.rock },
                    uTranslucency: { value: look.translucency },
                    // shared with the terrain: filled in once its textures have loaded
                    uGroundAlbedo: this.view.terrains.material.uniforms.uGroundAlbedo,
                    uGroundMeans: this.view.terrains.material.uniforms.uGroundMeans,
                    uGroundReady: this.view.terrains.material.uniforms.uGroundReady
                }
            })
            this.materials.set(kind, material)
            const shadowMaterial = Shadows.shadowVariant(material)
            for (const detail of ['near', 'far'] as const) {
                const geometry = MODELS[kind]!(detail)
                const capacity = 256
                const instance = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage)
                const extra = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage)
                geometry.setAttribute('aInstance', instance)
                geometry.setAttribute('aInstanceExtra', extra)
                geometry.instanceCount = 0
                const mesh = new THREE.Mesh(geometry, material)
                mesh.frustumCulled = false
                this.view.shadows.addCaster(mesh, shadowMaterial)
                this.scene.add(mesh)
                this.layers.set(`${kind}:${detail}`, { mesh, geometry, instance, extra })
            }
        }
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
        layer.geometry.setAttribute('aInstance', layer.instance)
        layer.geometry.setAttribute('aInstanceExtra', layer.extra)
    }

    private rebuild() {
        const p = this.state.player.position.current
        const buckets = new Map<string, number[]>()
        for (const key of this.layers.keys())
            buckets.set(key, [])

        let total = 0
        for (const cell of this.state.vegetation.cells.values()) {
            for (const plant of cell.plants) {
                const distance = Math.hypot(plant.x - p[0], plant.z - p[2])
                const look = LOOKS[plant.kind]
                if (!look)
                    continue
                const detail = distance < look.near ? 'near' : 'far'
                const bucket = buckets.get(`${plant.kind}:${detail}`)
                if (!bucket)
                    continue
                bucket.push(plant.x, plant.y, plant.z, plant.scale, plant.rotation, plant.tint)
                total++
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
            layer.geometry.instanceCount = count
        }
        this.instanceCount = total
        this.version = this.state.vegetation.version
        this.builtAt.set(p[0], p[2])
    }

    update() {
        const p = this.state.player.position.current
        if (this.version !== this.state.vegetation.version || Math.hypot(p[0] - this.builtAt.x, p[2] - this.builtAt.y) > 16)
            this.rebuild()

        const sun = this.state.sun.position
        this.uniforms.uTime.value = this.state.time.elapsed
        this.uniforms.uSunPosition.value.set(sun.x, sun.y, sun.z)
    }
}
