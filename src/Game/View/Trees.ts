import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Settings, { Quality } from '../Settings'
import { Log, PLANT, Plant, PlantKind } from '../State/Vegetation'
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
// Every leaf card up to this share of NEAR; beyond, the crowns thin to LEAF_KEEP of their
// cards (each grown to keep the crown as full) and a lighter copy draws only those
const FULL = 0.4
const LEAF_KEEP = 0.4
const VIEWS = 8
// the near/mid/far lists are rebuilt after the player has gone this far (m); the crowns thin by
// the player's live distance, done this far before the near/mid split so that a tree changing
// list between rebuilds is already as thin as its lighter copy (no pop at the split)
const REBUILD = 3
// trees nearer than this are never hidden behind hills (a tree popping out of a near rise shows;
// the hiding pays off in the far forest)
const HIDE_FROM = 60
// trees lying felled at once (the oldest is cleared away for a new one)
const FELLED = 4
// billboard atlas cell (pixels per baked view), by quality when the trees are built
const CELLS: Record<Quality, number> = { low: 192, medium: 256, high: 384, ultra: 448 }

type Instances = { instance: THREE.InstancedBufferAttribute, extra: THREE.InstancedBufferAttribute }
type Felled = {
    plant: Plant, angle: number, speed: number, direction: number, rest: number, landed: boolean
    cut: number                      // where it was cut through (metres above its foot)
    drop: number                     // how far its butt has dropped off the stump
    radius: number                   // the trunk's at the cut
    stump: THREE.Group
    end: THREE.Mesh                  // the fresh wood at the cut end of the trunk
}
type Variant = {
    species: Species
    radius: number                   // crown half width, tree height = 1
    trunk: [number, number][]        // the trunk's rings near the ground: height, radius (tree height = 1)
    bark: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
    leaves: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
    instances: Instances
    // the same tree with its crown thinned (mid distance)
    barkMid: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
    leavesMid: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
    midInstances: Instances
}

/**
 * Reorders a branch geometry's triangles by branch level (trunk first) and returns how many
 * indices cover every level but the finest (twigs), the bark of the mid-distance trees.
 */
function sortByLevel(geometry: THREE.BufferGeometry, levels: number) {
    const index = geometry.index!
    const triangleLevels = geometry.userData.triangleLevels as Uint8Array | undefined
    if (!triangleLevels || triangleLevels.length !== index.count / 3)
        return index.count
    const order = Array.from({ length: triangleLevels.length }, (_, i) => i).sort((a, b) => triangleLevels[a] - triangleLevels[b])
    const source = index.array
    const sorted = new (source.constructor as Uint16ArrayConstructor)(source.length)
    let prefix = 0
    const keepBelow = Math.max(1, levels)          // drop only the last level
    order.forEach((triangle, slot) => {
        sorted.set([source[triangle * 3], source[triangle * 3 + 1], source[triangle * 3 + 2]], slot * 3)
        if (triangleLevels[triangle] < keepBelow)
            prefix = (slot + 1) * 3
    })
    geometry.setIndex(new THREE.BufferAttribute(sorted, 1))
    return Math.max(prefix, Math.min(index.count, 3))
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
    counts = { near: 0, mid: 0, far: 0, hidden: 0 }
    private horizonVersion = - 1
    windStrength = 1                     // gusts in storms (Weather.ts)

    private loader = new THREE.TextureLoader()
    private textures = new Map<string, THREE.Texture>()
    private materials = new Map<string, THREE.ShaderMaterial>()
    private version = -1
    private stumps = new Map<Plant, THREE.Group>()     // stumps of trees felled before, near the player
    private cameraOffset = 0          // how far the camera trailed the player at the last rebuild (m)
    private builtAt = new THREE.Vector2(Infinity, Infinity)
    private felled: Felled[] = []
    private rustle = 0                    // seconds until a fallen crown rustles again
    private stumpMaterials = {
        wood: new THREE.MeshStandardMaterial({ color: '#d9bd90', roughness: 0.85, emissive: '#2a1e10' })
    }

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
        this.uniforms.uLodCenter = { value: new THREE.Vector3() }
        this.uniforms.uTreeHit = { value: new THREE.Vector4(0, 0, - 100, 0) }
        this.uniforms.uTreeHitDirection = { value: new THREE.Vector2(1, 0) }
        // trees falling or fallen: x, z, angle from upright, direction of the fall
        this.uniforms.uFelled = { value: Array.from({ length: FELLED }, () => new THREE.Vector4(0, 0, 0, 0)) }
        this.uniforms.uFelledCut = { value: Array.from({ length: FELLED }, () => new THREE.Vector4(0, 0, 0, 0)) }

        this.applyQuality()
        this.settings.events.on('change:quality', () => this.applyQuality())
        this.build()
    }

    private applyQuality() {
        this.near = NEAR[this.settings.get('quality')]
        this.uniforms.uFade.value.set(this.near, this.near + BAND)
        // the full trees thin their crowns over the last stretch before the lighter copies
        for (const variant of this.variants)
            variant.leaves.material.uniforms.uLeafLod.value.set(this.fullEnd - 8 - REBUILD, this.fullEnd - REBUILD, LEAF_KEEP)
        this.version = -1
    }

    private get fullEnd() {
        return this.near * FULL
    }

    private texture(name: string, repeat: boolean) {
        let texture = this.textures.get(name)
        if (!texture) {
            texture = this.loader.load(`/textures/trees/${name}.webp`)
            texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
            texture.anisotropy = 8
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
                    uTranslucency: { value: leaves ? 0.45 : 0 },
                    uLeafLod: { value: new THREE.Vector3(0, 0, 1) }       // all cards (set per mesh)
                },
                side: leaves ? THREE.DoubleSide : THREE.FrontSide
            })
            material.userData.sway = SWAY[kindOfPlant]
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
        // bark triangles sorted trunk first: a prefix is the tree without its finest twigs
        const barkPrefix = sortByLevel(barkGeometry, tree.options.branch.levels)
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
        // the trunk's lowest rings of bark vertices (the trunk comes first): how thick it is
        // at each height
        const barkPositions = barkGeometry.getAttribute('position') as THREE.BufferAttribute
        const rings = new Map<number, number>()
        for (let i = 0; i < Math.min(barkPositions.count, 800); i++) {
            const y = barkPositions.getY(i)
            if (y > 0.3) continue
            const key = Math.round(y / 0.004)
            rings.set(key, Math.max(rings.get(key) ?? 0, Math.hypot(barkPositions.getX(i), barkPositions.getZ(i))))
        }
        const trunk = [...rings].sort((a, b) => a[0] - b[0]).map(([key, r]) => [key * 0.004, r] as [number, number])
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
            if (leaves) {
                // leaf cards are quads (4 vertices, 6 indices): their centres, and the cards
                // in a random order, so the first part of the index buffer is an even sample
                // of the crown (the levels of detail draw a prefix)
                const quads = position.count / 4
                const center = new Float32Array(position.count * 3)
                const rank = new Float32Array(position.count)
                const order = Array.from({ length: quads }, (_, i) => i)
                let seed = species.seed * 9301 + 49297
                const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
                for (let i = quads - 1; i > 0; i--) {
                    const j = Math.floor(random() * (i + 1))
                    ;[order[i], order[j]] = [order[j], order[i]]
                }
                const index = new (position.count > 65535 ? Uint32Array : Uint16Array)(quads * 6)
                order.forEach((quad, slot) => {
                    const v = quad * 4
                    const cx = (position.getX(v) + position.getX(v + 1) + position.getX(v + 2) + position.getX(v + 3)) / 4
                    const cy = (position.getY(v) + position.getY(v + 1) + position.getY(v + 2) + position.getY(v + 3)) / 4
                    const cz = (position.getZ(v) + position.getZ(v + 1) + position.getZ(v + 2) + position.getZ(v + 3)) / 4
                    for (let k = 0; k < 4; k++) {
                        center.set([cx, cy, cz], (v + k) * 3)
                        rank[v + k] = (slot + 0.5) / quads
                    }
                    index.set([v, v + 1, v + 2, v, v + 2, v + 3], slot * 6)
                })
                geometry.setAttribute('aLeafCenter', new THREE.BufferAttribute(center, 3))
                geometry.setAttribute('aLeafRank', new THREE.BufferAttribute(rank, 1))
                geometry.setIndex(new THREE.BufferAttribute(index, 1))
            }
            const instanced = new THREE.InstancedBufferGeometry()
            instanced.index = geometry.index
            for (const name of Object.keys(geometry.attributes))
                instanced.setAttribute(name, geometry.getAttribute(name))
            instanced.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
            return instanced
        }

        const instances = this.instances(64)
        const leavesMaterial = this.material('leaves', species.leaves, species.kind)
        const bark = new THREE.Mesh(decorate(barkGeometry, false), this.material('bark', species.bark, species.kind))
        // its own copy of the material: the full trees' level-of-detail distances
        const leaves = new THREE.Mesh(decorate(leafGeometry, true), this.lodMaterial(leavesMaterial, this.fullEnd - 8 - REBUILD, this.fullEnd - REBUILD))
        // mid distance: the same buffers, their own instances, the crown's first LEAF_KEEP only
        const midInstances = this.instances(64)
        const share = (geometry: THREE.InstancedBufferGeometry) => {
            const copy = new THREE.InstancedBufferGeometry()
            copy.index = geometry.index
            for (const name of Object.keys(geometry.attributes))
                if (!name.startsWith('aInstance'))
                    copy.setAttribute(name, geometry.getAttribute(name))
            copy.boundingSphere = geometry.boundingSphere
            return copy
        }
        const barkMid = new THREE.Mesh(share(bark.geometry), bark.material)
        barkMid.geometry.setDrawRange(0, barkPrefix)
        const leavesMid = new THREE.Mesh(share(leaves.geometry), this.lodMaterial(leavesMaterial, 0, 0))
        const keptIndices = Math.ceil(leaves.geometry.index!.count / 6 * LEAF_KEEP) * 6
        leavesMid.geometry.setDrawRange(0, keptIndices)
        // the wider shadow cascades draw the near crowns thinned too
        leaves.userData.shadowDrawCount = keptIndices
        bark.userData.shadowDrawCount = barkPrefix
        for (const [mesh, set] of [[bark, instances], [leaves, instances], [barkMid, midInstances], [leavesMid, midInstances]] as const) {
            this.attach(mesh.geometry, set)
            mesh.geometry.instanceCount = 0
            mesh.frustumCulled = false
            this.view.shadows.addCaster(mesh, Shadows.shadowVariant(mesh.material))
        }
        return { species, radius: crownRadius, trunk: trunk.length ? trunk : [[0, 0.02]] as [number, number][], bark, leaves, instances, barkMid, leavesMid, midInstances }
    }

    /** A leaf material with its own level-of-detail range (from, to: thinning distances; equal = thinned). */
    private lodMaterial(material: THREE.ShaderMaterial, from: number, to: number) {
        return new THREE.ShaderMaterial({
            vertexShader: material.vertexShader,
            fragmentShader: material.fragmentShader,
            defines: { ...material.defines },
            uniforms: { ...material.uniforms, uLeafLod: { value: new THREE.Vector3(from, to, LEAF_KEEP) } },
            side: material.side
        })
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
        for (const variant of this.variants)
            this.scene.add(variant.bark, variant.leaves, variant.barkMid, variant.leavesMid)
        this.scene.add(this.impostor.mesh)
        this.state.vegetation.trunkRadius = (plant, height) => this.trunkRadius(plant, height)
        this.ready = true
        this.version = -1
    }

    /** Render every variant from eight directions into the billboard atlases. */
    private bakeImpostors() {
        const renderer = this.view.renderer.instance
        const CELL = CELLS[this.settings.get('quality')]
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
        const mid: number[][] = this.variants.map(() => [])
        const far: number[] = []
        const fullEnd = this.fullEnd
        const horizon = this.view.horizon
        // the hand-over to billboards fades by the distance from the camera, which trails the
        // player: both lists reach past the hand-over by that much (and a rebuild's step), so a
        // tree there always has both versions to cross-fade (else it half-vanished for a moment)
        const camera = this.view.camera.instance.position
        this.cameraOffset = Math.hypot(camera.x - p[0], camera.z - p[2])
        const overlap = this.cameraOffset + REBUILD + 1
        let hidden = 0
        const stumps: Plant[] = []
        const lying = new Set(this.felled.map((tree) => tree.plant))
        for (const cell of this.state.vegetation.cells.values()) {
            for (const plant of cell.plants) {
                const options = byKind.get(plant.kind)
                if (!options)
                    continue
                // felled before: only its stump (a falling or lying one is drawn by its slot)
                if (plant.felled && !lying.has(plant)) {
                    if (Math.hypot(plant.x - p[0], plant.z - p[2]) < 110)
                        stumps.push(plant)
                    continue
                }
                const index = options[Math.min(options.length - 1, Math.floor(plant.tint * options.length))]
                const distance = Math.hypot(plant.x - p[0], plant.z - p[2])
                // behind a hill: not drawn at all
                if (distance > HIDE_FROM && !horizon.visible(plant.x, plant.y + plant.scale, plant.z)) {
                    hidden++
                    continue
                }
                if (distance < fullEnd)
                    near[index].push(plant.x, plant.y, plant.z, plant.scale, plant.rotation)
                else if (distance < this.near + BAND + overlap)
                    mid[index].push(plant.x, plant.y, plant.z, plant.scale, plant.rotation)
                if (distance > this.near - overlap)
                    far.push(plant.x, plant.y, plant.z, plant.scale, plant.rotation, index)
            }
        }

        const fill = (instances: Instances, values: number[], stride: number) => {
            const count = values.length / stride
            const a = instances.instance.array as Float32Array, b = instances.extra.array as Float32Array
            for (let i = 0, j = 0; i < count; i++, j += stride) {
                a[i * 4] = values[j]
                a[i * 4 + 1] = values[j + 1]
                a[i * 4 + 2] = values[j + 2]
                a[i * 4 + 3] = values[j + 3]
                b[i * 2] = values[j + 4]
                b[i * 2 + 1] = stride > 5 ? values[j + 5] : 0
            }
            instances.instance.needsUpdate = true
            instances.extra.needsUpdate = true
            return count
        }

        this.counts.near = 0
        this.counts.mid = 0
        this.variants.forEach((variant, index) => {
            const count = near[index].length / 5
            variant.instances = this.reserve(variant.instances, count, [variant.bark.geometry, variant.leaves.geometry])
            fill(variant.instances, near[index], 5)
            variant.bark.geometry.instanceCount = count
            variant.leaves.geometry.instanceCount = count
            this.counts.near += count
            const midCount = mid[index].length / 5
            variant.midInstances = this.reserve(variant.midInstances, midCount, [variant.barkMid.geometry, variant.leavesMid.geometry])
            fill(variant.midInstances, mid[index], 5)
            variant.barkMid.geometry.instanceCount = midCount
            variant.leavesMid.geometry.instanceCount = midCount
            this.counts.mid += midCount
        })
        const farCount = far.length / 6
        this.impostor.instances = this.reserve(this.impostor.instances, farCount, [this.impostor.mesh.geometry])
        fill(this.impostor.instances, far, 6)
        this.impostor.mesh.geometry.instanceCount = farCount
        this.counts.far = farCount

        this.counts.hidden = hidden
        this.updateStumps(stumps)
        this.version = this.state.vegetation.version
        this.horizonVersion = horizon.version
        this.builtAt.set(p[0], p[2])
    }

    /** Shake the tree at (x, z), struck from `direction` (axe). */
    strike(x: number, z: number, directionX: number, directionZ: number, strength = 1) {
        this.uniforms.uTreeHit.value.set(x, z, this.state.time.elapsed, strength)
        const length = Math.hypot(directionX, directionZ) || 1
        this.uniforms.uTreeHitDirection.value.set(directionX / length, directionZ / length)
    }

    /** How wide a tree's crown is (half its width / its height). */
    private crownRadius(plant: Plant) {
        const options = this.variants.filter((variant) => variant.species.kind === plant.kind)
        return options.length ? options[Math.min(options.length - 1, Math.floor(plant.tint * options.length))].radius : 0.3
    }

    /** How thick a tree's trunk is drawn `height` metres above its foot (its radius, metres). */
    trunkRadius(plant: Plant, height: number) {
        const options = this.variants.filter((variant) => variant.species.kind === plant.kind)
        if (!options.length)
            return plant.collision * 0.5
        const rings = options[Math.min(options.length - 1, Math.floor(plant.tint * options.length))].trunk
        const y = height / plant.scale
        let i = 0
        while (i < rings.length - 2 && rings[i + 1][0] < y) i++
        const [y0, r0] = rings[i], [y1, r1] = rings[Math.min(i + 1, rings.length - 1)]
        const u = y1 > y0 ? THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1) : 0
        return (r0 + (r1 - r0) * u) * plant.scale
    }

    /**
     * Fell a tree cut through `cut` metres above its foot, toward (directionX, directionZ):
     * above the cut it tips slowly, then falls like a rod hinged at the cut (angular
     * acceleration 3g/2L sin θ), its butt dropping off the stump, until it meets the slope,
     * bounces once and lies there. The stump stays, a fresh-cut top on it; the trunk lying on
     * the ground is solid and its branches a thicket (State/Vegetation logs).
     */
    fell(plant: Plant, directionX: number, directionZ: number, cut = 0.9) {
        if (this.felled.some((tree) => tree.plant === plant))
            return
        if (this.felled.length >= FELLED)
            this.clearFelled(this.felled.shift()!)
        const direction = Math.atan2(directionZ, directionX)
        // lying angle: where the trunk meets the ground at half its height down the slope
        const reach = plant.scale * 0.5
        const ground = this.state.player.groundAt(plant.x + Math.cos(direction) * reach, plant.z + Math.sin(direction) * reach)
        const rest = THREE.MathUtils.clamp(Math.PI / 2 - Math.atan2(ground - plant.y, reach), 1.15, 1.95)
        const radius = this.trunkRadius(plant, cut)
        plant.felled = true
        plant.stump = cut
        // the stump; the cut end of the trunk
        const stump = this.stump(plant, cut, radius)
        const end = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.97, 14), this.stumpMaterials.wood)
        this.scene.add(stump, end)
        this.view.audio?.play('treeFall', new THREE.Vector3(plant.x, plant.y + 2, plant.z), 1.4)
        this.felled.push({ plant, angle: 0.07, speed: 0.22, direction, rest, landed: false, cut, drop: 0, radius, stump, end })
    }

    /** A stump: bark below the cut, the cut's fresh wood on top. */
    private stump(plant: Plant, cut: number, radius: number) {
        const stump = new THREE.Group()
        const side = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.12, cut + 0.15, 14, 1, true), this.stumpBark(plant, cut))
        side.position.y = (cut - 0.15) / 2
        const top = new THREE.Mesh(new THREE.CircleGeometry(radius, 14), this.stumpMaterials.wood)
        top.rotation.x = - Math.PI / 2
        top.position.y = cut
        stump.add(side, top)
        stump.position.set(plant.x, plant.y, plant.z)
        return stump
    }

    private disposeStump(stump: THREE.Group) {
        this.scene.remove(stump)
        stump.traverse((object) => {
            const mesh = object as THREE.Mesh
            if (!mesh.isMesh) return
            mesh.geometry.dispose()
            if (mesh.material !== this.stumpMaterials.wood) (mesh.material as THREE.MeshStandardMaterial).dispose()
        })
    }

    /**
     * The stumps of trees felled before (their logs cleared away, or on an earlier visit),
     * near the player: made as they come near, let go far behind.
     */
    private updateStumps(felled: Plant[]) {
        const keep = new Set(felled)
        for (const plant of felled)
            if (!this.stumps.has(plant) && plant.stump !== undefined) {
                const stump = this.stump(plant, plant.stump, this.trunkRadius(plant, plant.stump))
                this.scene.add(stump)
                this.stumps.set(plant, stump)
            }
        for (const [plant, stump] of this.stumps)
            if (!keep.has(plant)) {
                this.disposeStump(stump)
                this.stumps.delete(plant)
            }
    }

    /** The stump's bark: the tree's own bark texture, wrapped round it. */
    private stumpBark(plant: Plant, height: number) {
        const options = this.variants.filter((variant) => variant.species.kind === plant.kind)
        const species = options.length ? options[Math.min(options.length - 1, Math.floor(plant.tint * options.length))].species : SPECIES[0]
        const map = this.texture(`bark_${species.bark}_color`, true).clone()
        map.colorSpace = THREE.SRGBColorSpace
        map.repeat.set(2, Math.max(0.5, height))
        map.needsUpdate = true
        return new THREE.MeshStandardMaterial({ map, roughness: 0.95, color: '#b9b0a4' })
    }

    /** A felled tree's log cleared away (far behind, or a newer one felled): its stump stays. */
    private clearFelled(tree: Felled) {
        this.disposeStump(tree.stump)
        this.scene.remove(tree.end)
        tree.end.geometry.dispose()
        this.state.vegetation.keepStump(tree.plant)
    }

    private updateFelled(dt: number) {
        const slots = this.uniforms.uFelled.value as THREE.Vector4[]
        const cuts = this.uniforms.uFelledCut.value as THREE.Vector4[]
        const p = this.state.player.position.current
        this.felled = this.felled.filter((tree) => {
            if (Math.hypot(tree.plant.x - p[0], tree.plant.z - p[2]) > 90) {
                this.clearFelled(tree)
                return false
            }
            return true
        })
        for (const tree of this.felled) {
            if (tree.landed)
                continue
            const length = Math.max(4, tree.plant.scale * 0.7)
            for (let i = 0; i < 4; i++) {
                const h = dt / 4
                tree.speed += 1.5 * 9.81 / length * Math.sin(tree.angle) * h
                tree.angle += tree.speed * h
                if (tree.angle >= tree.rest) {
                    tree.angle = tree.rest
                    const impact = tree.speed
                    tree.speed = - tree.speed * 0.18
                    if (impact > 0.6)
                        this.landed(tree, impact)
                    else {
                        tree.landed = true
                        tree.speed = 0
                    }
                }
            }
        }
        const logs: Log[] = []
        slots.forEach((slot, i) => {
            const tree = this.felled[i]
            if (!tree) {
                slot.set(0, 0, 0, 0)
                cuts[i].set(0, 0, 0, 0)
                return
            }
            // the butt drops off the stump as the tree goes over, to lie on the ground
            tree.drop = Math.max(0, tree.cut - tree.radius) * THREE.MathUtils.smoothstep(tree.angle, 0.45, tree.rest)
            slot.set(tree.plant.x, tree.plant.z, tree.angle, tree.direction)
            cuts[i].set(tree.cut, tree.drop, 0, 0)
            // the trunk's line now, from the cut end; its cut end capped with fresh wood
            const along = new THREE.Vector3(Math.cos(tree.direction) * Math.sin(tree.angle), Math.cos(tree.angle), Math.sin(tree.direction) * Math.sin(tree.angle))
            const butt = new THREE.Vector3(tree.plant.x, tree.plant.y + tree.cut - tree.drop, tree.plant.z)
            tree.end.position.copy(butt).addScaledVector(along, 0.005)
            tree.end.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along.clone().negate())
            if (tree.angle > 0.3) {
                const scale = tree.plant.scale
                const crown = this.crownRadius(tree.plant) * scale
                const tip = butt.clone().addScaledVector(along, scale * 0.55)
                const from = butt.clone().addScaledVector(along, scale * 0.35), to = butt.clone().addScaledVector(along, scale * 0.95)
                logs.push({
                    plant: tree.plant,
                    trunk: { a: butt.toArray(), b: tip.toArray(), radius: tree.radius * 0.9 },
                    crown: { a: from.toArray(), b: to.toArray(), radius: crown * 0.55 }
                })
            }
        })
        this.state.vegetation.logs = logs
    }

    /** The trunk hits the ground: dust along it, leaves flying from the crown, the ground shakes. */
    private landed(tree: { plant: Plant, angle: number, direction: number }, impact: number) {
        const particles = this.view.particles
        const dx = Math.cos(tree.direction), dz = Math.sin(tree.direction)
        const height = tree.plant.scale
        const strength = Math.min(1, impact / 2.5)
        for (let s = 0.2; s <= 1; s += 0.2) {
            const x = tree.plant.x + dx * height * s * Math.sin(tree.angle), z = tree.plant.z + dz * height * s * Math.sin(tree.angle)
            const at = new THREE.Vector3(x, this.state.player.groundAt(x, z) + 0.2, z)
            particles?.emit('dust', at, Math.round(3 * strength) + 1, new THREE.Vector3(0, 1, 0), 1.5, 0.9)
            if (s > 0.5 && tree.plant.kind !== PLANT.BUSH)
                particles?.emit('leaf', at.add(new THREE.Vector3(0, 1, 0)), Math.round(10 * strength), new THREE.Vector3(0, 1, 0), 3.5, 0.9)
        }
        const p = this.state.player.position.current
        const distance = Math.hypot(tree.plant.x - p[0], tree.plant.z - p[2])
        this.state.player.camera.thirdPerson.shake(0.55 * strength * Math.max(0, 1 - distance / 40))
    }

    /**
     * Pushing through a fallen crown: the branches give and shake, leaves come off them and
     * they rustle (the physics holds the body back: State/Vegetation).
     */
    private updateThicket(dt: number) {
        this.rustle = Math.max(0, this.rustle - dt)
        const player = this.state.player
        if (player.speed < 0.6 || this.rustle > 0)
            return
        const p = player.position.current
        for (const log of this.state.vegetation.logs) {
            const { a, b, radius } = log.crown
            const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
            const length = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
            const t = THREE.MathUtils.clamp(((p[0] - a[0]) * ab[0] + (p[1] + 0.9 - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / Math.max(1e-6, length), 0, 1)
            const d = Math.hypot(p[0] - a[0] - ab[0] * t, p[1] + 0.9 - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t)
            if (d > radius)
                continue
            const v = player.velocity
            this.strike(log.plant.x, log.plant.z, v[0], v[2], 0.35 + player.speed * 0.08)
            const at = new THREE.Vector3(p[0], p[1] + 1.1, p[2])
            this.view.audio?.play('reap', at, 0.5)
            if (Math.random() < 0.6)
                this.view.particles?.emit('leaf', at, 3, new THREE.Vector3(0, 1, 0), 1.2, 0.9)
            this.rustle = 0.32
            return
        }
    }

    update() {
        if (!this.ready)
            return
        this.updateFelled(Math.min(this.state.time.delta, 0.05))
        this.updateThicket(Math.min(this.state.time.delta, 0.05))
        const p = this.state.player.position.current
        if (this.version !== this.state.vegetation.version || this.horizonVersion !== this.view.horizon.version || Math.hypot(p[0] - this.builtAt.x, p[2] - this.builtAt.y) > REBUILD
            || Math.abs(Math.hypot(this.view.camera.instance.position.x - p[0], this.view.camera.instance.position.z - p[2]) - this.cameraOffset) > 2)
            this.rebuild()
        // the crowns thin by the player's distance now (smoothly as they walk)
        this.uniforms.uLodCenter.value.set(p[0], p[1], p[2])
        const sun = this.state.sun.position
        this.uniforms.uTime.value = this.state.time.elapsed
        for (const material of this.materials.values())
            if (material.uniforms.uSway && material.userData.sway !== undefined)
                material.uniforms.uSway.value = material.userData.sway * this.windStrength
        this.uniforms.uSunPosition.value.set(sun.x, sun.y, sun.z)
    }
}
