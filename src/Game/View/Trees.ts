import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Settings, { Quality } from '../Settings'
import { PLANT, PlantKind } from '../State/Vegetation'
import { CLOUD_UNIFORMS, LIGHT_UNIFORMS } from './Sky'
import Shadows, { SHADOW_UNIFORMS } from './Shadows'
import { Tree } from '../Vendor/ezTree/tree.js'
import oakMedium from '../Vendor/ezTree/presets/oak_medium.json'
import oakLarge from '../Vendor/ezTree/presets/oak_large.json'
import ashMedium from '../Vendor/ezTree/presets/ash_medium.json'
import aspenMedium from '../Vendor/ezTree/presets/aspen_medium.json'
import pineMedium from '../Vendor/ezTree/presets/pine_medium.json'
import pineLarge from '../Vendor/ezTree/presets/pine_large.json'
import bush1 from '../Vendor/ezTree/presets/bush_1.json'
import bush2 from '../Vendor/ezTree/presets/bush_2.json'
import vertexShader from './Materials/shaders/trees/vertex.glsl'
import fragmentShader from './Materials/shaders/trees/fragment.glsl'
import impostorVertexShader from './Materials/shaders/impostor/vertex.glsl'
import impostorFragmentShader from './Materials/shaders/impostor/fragment.glsl'

type Bark = 'oak' | 'pine' | 'birch'
type Leaves = 'oak' | 'ash' | 'aspen' | 'pine'
type Species = { preset: object, kind: PlantKind, seed: number, bark: Bark, leaves: Leaves }

// The tree variants the forests are made of (EZ-Tree presets, different seeds)
const SPECIES: Species[] = [
    { preset: oakMedium, kind: PLANT.BROADLEAF, seed: 1201, bark: 'oak', leaves: 'oak' },
    { preset: oakLarge, kind: PLANT.BROADLEAF, seed: 3307, bark: 'oak', leaves: 'oak' },
    { preset: ashMedium, kind: PLANT.BROADLEAF, seed: 4411, bark: 'oak', leaves: 'ash' },
    { preset: aspenMedium, kind: PLANT.BROADLEAF, seed: 5519, bark: 'birch', leaves: 'aspen' },
    { preset: pineMedium, kind: PLANT.CONIFER, seed: 2203, bark: 'pine', leaves: 'pine' },
    { preset: pineMedium, kind: PLANT.CONIFER, seed: 6631, bark: 'pine', leaves: 'pine' },
    { preset: pineLarge, kind: PLANT.CONIFER, seed: 7741, bark: 'pine', leaves: 'pine' },
    { preset: bush1, kind: PLANT.BUSH, seed: 8853, bark: 'oak', leaves: 'ash' },
    { preset: bush2, kind: PLANT.BUSH, seed: 9967, bark: 'oak', leaves: 'aspen' }
]

const LEAF_TINT: Record<Leaves, string> = { oak: '#c9d6b0', ash: '#c7d4ad', aspen: '#d3dcb4', pine: '#b5c4a0' }
const SWAY: Record<PlantKind, number> = { [PLANT.CONIFER]: 0.012, [PLANT.BROADLEAF]: 0.02, [PLANT.BUSH]: 0.03, [PLANT.ROCK]: 0 }

// Full trees up to this distance, billboards beyond (a dithered hand-over across BAND m)
const NEAR: Record<Quality, number> = { low: 28, medium: 50, high: 80, ultra: 125 }
const BAND = 10
const VIEWS = 8
const CELL = 256

type Instances = { instance: THREE.InstancedBufferAttribute, extra: THREE.InstancedBufferAttribute }
type Variant = {
    species: Species
    radius: number                   // crown half width, tree height = 1
    bark: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
    leaves: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
    instances: Instances
}

// yield between variants so loading never stalls (a timer: keeps going in background tabs)
const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0))

/**
 * Realistic trees and bushes: EZ-Tree geometry (vendored generator) with real bark and leaf
 * textures. A handful of variants are generated once (spread over frames), normalised to
 * unit height and drawn instanced near the player; farther away every tree is a billboard
 * showing that variant as baked from the nearest of eight directions, lit with its baked
 * normals, so whole forests cost a few draw calls. Placement comes from State/Vegetation.
 */
export default class Trees {
    view: View
    state: State
    settings: Settings
    scene: THREE.Scene
    variants: Variant[] = []
    ready = false
    near = NEAR.medium
    uniforms: Record<string, THREE.IUniform>
    impostor!: { mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>, instances: Instances }
    counts = { near: 0, far: 0 }

    private loader = new THREE.TextureLoader()
    private textures = new Map<string, THREE.Texture>()
    private materials = new Map<string, THREE.ShaderMaterial>()
    private version = -1
    private builtAt = new THREE.Vector2(Infinity, Infinity)

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.settings = Settings.getInstance()
        this.scene = this.view.scene

        this.uniforms = {
            uTime: { value: 0 },
            uSunPosition: { value: new THREE.Vector3(0, 1, 0) },
            uNoiseTexture: { value: this.view.noises.texture },
            uSkyLut: { value: this.view.skyLut.texture },
            uFade: { value: new THREE.Vector2() }
        }
        for (const name of [...LIGHT_UNIFORMS, ...CLOUD_UNIFORMS])
            this.uniforms[name] = this.view.sky.uniforms[name]
        for (const name of SHADOW_UNIFORMS)
            this.uniforms[name] = this.view.shadows.uniforms[name]

        this.applyQuality()
        this.settings.events.on('change:quality', () => this.applyQuality())
        this.build()
    }

    private applyQuality() {
        this.near = NEAR[this.settings.get('quality')]
        this.uniforms.uFade.value.set(this.near, this.near + BAND)
        this.version = -1
    }

    private texture(name: string, repeat: boolean) {
        let texture = this.textures.get(name)
        if (!texture) {
            texture = this.loader.load(`/textures/trees/${name}.webp`)
            texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
            texture.anisotropy = 4
            this.textures.set(name, texture)
        }
        return texture
    }

    private material(kind: 'bark' | 'leaves', name: string, kindOfPlant: PlantKind, defines: Record<string, string> = {}) {
        const key = `${kind}:${name}:${kindOfPlant}:${Object.keys(defines).join(',')}`
        let material = this.materials.get(key)
        if (!material) {
            const leaves = kind === 'leaves'
            material = new THREE.ShaderMaterial({
                vertexShader,
                fragmentShader,
                defines: { ...(leaves ? { LEAVES: '' } : {}), ...defines },
                uniforms: {
                    ...this.uniforms,
                    uMap: { value: this.texture(leaves ? `leaves_${name}` : `bark_${name}_color`, !leaves) },
                    uNormalMap: { value: leaves ? null : this.texture(`bark_${name}_normal`, true) },
                    uTint: { value: new THREE.Color().setStyle(leaves ? LEAF_TINT[name as Leaves] : '#d8d0c4', THREE.LinearSRGBColorSpace) },
                    uSway: { value: SWAY[kindOfPlant] },
                    uTranslucency: { value: leaves ? 0.45 : 0 }
                },
                side: leaves ? THREE.DoubleSide : THREE.FrontSide
            })
            this.materials.set(key, material)
        }
        return material
    }

    /** Generate one variant: geometry normalised to unit height with sway, AO and canopy normals. */
    private generate(species: Species) {
        const tree = new Tree()
        tree.options.copy(species.preset as typeof tree.options)
        tree.options.seed = species.seed
        // lighter than the presets (they're made for single hero trees): fewer sections and
        // segments, fewer but larger leaves
        const sections = tree.options.branch.sections as Record<string, number>
        const segments = tree.options.branch.segments as Record<string, number>
        for (const level of Object.keys(sections)) {
            sections[level] = Math.max(3, Math.round(sections[level] * 0.6))
            segments[level] = Math.max(3, Math.round(segments[level] * 0.75))
        }
        tree.options.leaves.count = Math.max(4, Math.round(tree.options.leaves.count * 0.85))
        tree.options.leaves.size *= 1.25
        tree.generate()

        const barkGeometry = tree.branchesMesh.geometry as THREE.BufferGeometry
        const leafGeometry = tree.leavesMesh.geometry as THREE.BufferGeometry
        barkGeometry.computeBoundingBox()
        leafGeometry.computeBoundingBox()
        const box = barkGeometry.boundingBox!.clone().union(leafGeometry.boundingBox!)
        const height = box.max.y
        let radius = 0
        const crownCenter = new THREE.Vector3(0, 0, 0)

        // normalise; measure the crown
        const leafPositions = leafGeometry.getAttribute('position') as THREE.BufferAttribute
        for (const geometry of [barkGeometry, leafGeometry])
            geometry.scale(1 / height, 1 / height, 1 / height)
        for (let i = 0; i < leafPositions.count; i++) {
            radius = Math.max(radius, Math.hypot(leafPositions.getX(i), leafPositions.getZ(i)))
            crownCenter.y += leafPositions.getY(i)
        }
        crownCenter.y /= Math.max(1, leafPositions.count)
        const crownRadius = Math.max(0.15, radius)
        const conifer = species.kind === PLANT.CONIFER

        const decorate = (geometry: THREE.BufferGeometry, leaves: boolean) => {
            const position = geometry.getAttribute('position') as THREE.BufferAttribute
            const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
            const sway = new Float32Array(position.count)
            const ao = new Float32Array(position.count)
            const p = new THREE.Vector3(), n = new THREE.Vector3(), out = new THREE.Vector3()
            for (let i = 0; i < position.count; i++) {
                p.fromBufferAttribute(position, i)
                const y = Math.max(0, p.y)
                const reach = Math.min(1, Math.hypot(p.x, p.z) / crownRadius)
                sway[i] = Math.pow(y, 1.5) * (0.35 + 0.65 * reach)
                if (leaves) {
                    // canopy lit as a soft mass: lean normals out of the crown (pines: out of the axis)
                    out.set(p.x, conifer ? 0.25 : p.y - crownCenter.y + 0.08, p.z)
                    n.fromBufferAttribute(normal, i).lerp(out.normalize(), 0.65).normalize()
                    normal.setXYZ(i, n.x, n.y, n.z)
                    const depth = conifer ? reach : Math.min(1, out.set(p.x, p.y - crownCenter.y, p.z).length() / crownRadius)
                    ao[i] = 0.45 + 0.55 * THREE.MathUtils.smoothstep(depth, 0.1, 0.95)
                }
                else {
                    ao[i] = 0.6 + 0.4 * THREE.MathUtils.smoothstep(y, 0, 0.35)
                }
            }
            geometry.setAttribute('aSway', new THREE.BufferAttribute(sway, 1))
            geometry.setAttribute('aAo', new THREE.BufferAttribute(ao, 1))
            const instanced = new THREE.InstancedBufferGeometry()
            instanced.index = geometry.index
            for (const name of Object.keys(geometry.attributes))
                instanced.setAttribute(name, geometry.getAttribute(name))
            instanced.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
            return instanced
        }

        const instances = this.instances(64)
        const bark = new THREE.Mesh(decorate(barkGeometry, false), this.material('bark', species.bark, species.kind))
        const leaves = new THREE.Mesh(decorate(leafGeometry, true), this.material('leaves', species.leaves, species.kind))
        for (const mesh of [bark, leaves]) {
            this.attach(mesh.geometry, instances)
            mesh.geometry.instanceCount = 0
            mesh.frustumCulled = false
            this.view.shadows.addCaster(mesh, Shadows.shadowVariant(mesh.material))
        }
        return { species, radius: crownRadius, bark, leaves, instances }
    }

    private instances(capacity: number): Instances {
        return {
            instance: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage),
            extra: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage)
        }
    }

    private attach(geometry: THREE.InstancedBufferGeometry, instances: Instances) {
        geometry.setAttribute('aInstance', instances.instance)
        geometry.setAttribute('aInstanceExtra', instances.extra)
    }

    private async build() {
        for (const species of SPECIES) {
            this.variants.push(this.generate(species))
            await nextFrame()          // spread the generation so loading doesn't stall
        }
        this.bakeImpostors()
        for (const variant of this.variants) {
            this.scene.add(variant.bark)
            this.scene.add(variant.leaves)
        }
        this.scene.add(this.impostor.mesh)
        this.ready = true
        this.version = -1
    }

    /** Render every variant from eight directions into the billboard atlases. */
    private bakeImpostors() {
        const renderer = this.view.renderer.instance
        const width = CELL * VIEWS, height = CELL * this.variants.length
        const options = { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true }
        const albedo = new THREE.WebGLRenderTarget(width, height, options)
        const normal = new THREE.WebGLRenderTarget(width, height, options)
        const scene = new THREE.Scene()
        const camera = new THREE.OrthographicCamera(- 1, 1, 1.03, - 0.02, 0.1, 20)

        const previousClear = renderer.getClearColor(new THREE.Color())
        const previousAlpha = renderer.getClearAlpha()
        for (const [target, define] of [[albedo, 'BAKE_ALBEDO'], [normal, 'BAKE_NORMAL']] as [THREE.WebGLRenderTarget, string][]) {
            target.scissorTest = false
            renderer.setRenderTarget(target)
            // background: foliage colour with zero alpha, so mip levels don't fringe dark
            renderer.setClearColor(define === 'BAKE_ALBEDO' ? new THREE.Color(0.22, 0.27, 0.14) : new THREE.Color(0.5, 0.5, 1), 0)
            renderer.clear()
            this.variants.forEach((variant, row) => {
                const bark = new THREE.Mesh(variant.bark.geometry, this.material('bark', variant.species.bark, variant.species.kind, { BAKE: '', [define]: '' }))
                const leaves = new THREE.Mesh(variant.leaves.geometry, this.material('leaves', variant.species.leaves, variant.species.kind, { BAKE: '', [define]: '' }))
                for (const mesh of [bark, leaves]) {
                    mesh.frustumCulled = false
                    mesh.geometry.instanceCount = 1
                    scene.add(mesh)
                }
                variant.instances.instance.setXYZW(0, 0, 0, 0, 1)
                variant.instances.extra.setXY(0, 0, 0)
                variant.instances.instance.needsUpdate = true
                variant.instances.extra.needsUpdate = true
                const r = variant.radius * 1.05
                camera.left = - r
                camera.right = r
                camera.updateProjectionMatrix()
                for (let view = 0; view < VIEWS; view++) {
                    const angle = view / VIEWS * Math.PI * 2
                    camera.position.set(Math.sin(angle) * 10, 0, Math.cos(angle) * 10)
                    camera.lookAt(0, 0, 0)
                    target.viewport.set(view * CELL, row * CELL, CELL, CELL)
                    target.scissor.set(view * CELL, row * CELL, CELL, CELL)
                    target.scissorTest = true
                    renderer.setRenderTarget(target)
                    renderer.render(scene, camera)
                }
                scene.remove(bark, leaves)
                bark.geometry.instanceCount = 0
                leaves.geometry.instanceCount = 0
            })
            target.scissorTest = false
        }
        renderer.setRenderTarget(null)
        renderer.setClearColor(previousClear, previousAlpha)

        const quad = new THREE.InstancedBufferGeometry()
        quad.setAttribute('position', new THREE.Float32BufferAttribute([- 1, 0, 0, 1, 0, 0, 1, 1, 0, - 1, 1, 0], 3))
        quad.setIndex([0, 1, 2, 0, 2, 3])
        quad.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
        const instances = this.instances(512)
        this.attach(quad, instances)
        quad.instanceCount = 0
        const material = new THREE.ShaderMaterial({
            vertexShader: impostorVertexShader,
            fragmentShader: impostorFragmentShader,
            defines: { VARIANTS: String(this.variants.length) },
            uniforms: {
                ...this.uniforms,
                uRadius: { value: this.variants.map(v => v.radius) },
                uAlbedoAtlas: { value: albedo.texture },
                uNormalAtlas: { value: normal.texture },
                uVariants: { value: this.variants.length },
                uTranslucency: { value: 0.35 }
            }
        })
        const mesh = new THREE.Mesh(quad, material)
        mesh.frustumCulled = false
        this.view.shadows.addCaster(mesh, Shadows.shadowVariant(material))
        this.impostor = { mesh, instances }
    }

    private reserve(instances: Instances, count: number, geometries: THREE.InstancedBufferGeometry[]) {
        if (count <= instances.instance.count)
            return instances
        let capacity = instances.instance.count
        while (capacity < count)
            capacity *= 2
        const grown = this.instances(capacity)
        for (const geometry of geometries)
            this.attach(geometry, grown)
        return grown
    }

    private rebuild() {
        const p = this.state.player.position.current
        const byKind = new Map<PlantKind, number[]>()
        this.variants.forEach((variant, index) => {
            const list = byKind.get(variant.species.kind) ?? []
            list.push(index)
            byKind.set(variant.species.kind, list)
        })

        const near: number[][] = this.variants.map(() => [])
        const far: number[] = []
        for (const cell of this.state.vegetation.cells.values()) {
            for (const plant of cell.plants) {
                const options = byKind.get(plant.kind)
                if (!options)
                    continue
                const index = options[Math.min(options.length - 1, Math.floor(plant.tint * options.length))]
                const distance = Math.hypot(plant.x - p[0], plant.z - p[2])
                if (distance < this.near + BAND)
                    near[index].push(plant.x, plant.y, plant.z, plant.scale, plant.rotation)
                if (distance > this.near)
                    far.push(plant.x, plant.y, plant.z, plant.scale, plant.rotation, index)
            }
        }

        const fill = (instances: Instances, values: number[], stride: number) => {
            const count = values.length / stride
            const a = instances.instance.array as Float32Array, b = instances.extra.array as Float32Array
            for (let i = 0; i < count; i++) {
                a.set(values.slice(i * stride, i * stride + 4), i * 4)
                b[i * 2] = values[i * stride + 4]
                b[i * 2 + 1] = stride > 5 ? values[i * stride + 5] : 0
            }
            instances.instance.needsUpdate = true
            instances.extra.needsUpdate = true
            return count
        }

        this.counts.near = 0
        this.variants.forEach((variant, index) => {
            const count = near[index].length / 5
            variant.instances = this.reserve(variant.instances, count, [variant.bark.geometry, variant.leaves.geometry])
            fill(variant.instances, near[index], 5)
            variant.bark.geometry.instanceCount = count
            variant.leaves.geometry.instanceCount = count
            this.counts.near += count
        })
        const farCount = far.length / 6
        this.impostor.instances = this.reserve(this.impostor.instances, farCount, [this.impostor.mesh.geometry])
        fill(this.impostor.instances, far, 6)
        this.impostor.mesh.geometry.instanceCount = farCount
        this.counts.far = farCount

        this.version = this.state.vegetation.version
        this.builtAt.set(p[0], p[2])
    }

    update() {
        if (!this.ready)
            return
        const p = this.state.player.position.current
        if (this.version !== this.state.vegetation.version || Math.hypot(p[0] - this.builtAt.x, p[2] - this.builtAt.y) > 6)
            this.rebuild()
        const sun = this.state.sun.position
        this.uniforms.uTime.value = this.state.time.elapsed
        this.uniforms.uSunPosition.value.set(sun.x, sun.y, sun.z)
    }
}
