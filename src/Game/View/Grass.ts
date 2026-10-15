import * as THREE from 'three'

import Game from '../Game'
import View from './View'
import State from '../State/State'
import GrassMaterial from './Materials/GrassMaterial'
import GrassTrail from './GrassTrail'
import Settings, { GrassStyle, Quality } from '../Settings'
import { CLOUD_UNIFORMS, LIGHT_UNIFORMS } from './Sky'
import { SHADOW_UNIFORMS } from './Shadows'

type Style = {
    height: [number, number]     // blade height range (m)
    density: number              // blades per m² (at "high" quality)
    dryness: number              // added to the ground's dryness (blades and terrain)
    flowers: number              // share of blades that flower
}

// Grass styles from the settings menu. `dryness` also tints the terrain under and beyond
// the field (View/Terrains.ts) so the ground keeps matching the blades.
export const GRASS_STYLE_PARAMETERS: Record<GrassStyle, Style> = {
    meadow: { height: [0.28, 0.7], density: 60, dryness: 0, flowers: 0 },
    wild: { height: [0.45, 1.15], density: 64, dryness: 0.12, flowers: 0.01 },
    flowers: { height: [0.3, 0.75], density: 60, dryness: 0, flowers: 0.06 },
    steppe: { height: [0.2, 0.5], density: 40, dryness: 0.85, flowers: 0 },
    none: { height: [0, 0], density: 0, dryness: 0, flowers: 0 }
}

// How much grass the quality setting draws
const QUALITY: Record<Quality, { radius: number, density: number }> = {
    low: { radius: 20, density: 0.35 },
    medium: { radius: 26, density: 0.7 },
    high: { radius: 32, density: 1 },
    ultra: { radius: 32, density: 1.4 }
}

type Patch = { mesh: THREE.Mesh, x: number, z: number, seed: number }

/**
 * Instanced grass in world-fixed square patches around the player. Each frame only the
 * patches that are within reach and inside the camera's view are drawn (the ones behind
 * you cost nothing); near patches use curved three-segment blades, far ones a single
 * triangle at half the count, slightly wider. All patches share one blade layout, mirrored
 * and re-randomised per patch so it never visibly repeats. Blades bend with the wind, away
 * from the player's legs while the feet are on the ground, and stay pressed down where the
 * player walked or landed (GrassTrail).
 */
export default class Grass {
    game: Game
    view: View
    state: State
    settings: Settings
    scene: THREE.Scene
    material!: GrassMaterial
    trail: GrassTrail
    patchSize = 8
    radius = 32
    nearDistance = 14
    style!: Style
    geometries!: { near: THREE.InstancedBufferGeometry, far: THREE.InstancedBufferGeometry }
    group = new THREE.Group()
    visiblePatches = 0

    private pool: Patch[] = []
    private frustum = new THREE.Frustum()
    private matrix = new THREE.Matrix4()
    private box = new THREE.Box3()

    constructor() {
        this.game = Game.getInstance()
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.settings = Settings.getInstance()
        this.scene = this.view.scene

        this.trail = new GrassTrail()
        this.setMaterial()
        this.applySettings()
        this.scene.add(this.group)

        this.settings.events.on('change', (key: string) => {
            if (key === 'grass' || key === 'quality')
                this.applySettings()
        })
    }

    /** Blade shapes for the chosen density: `count` blades scattered over one patch. */
    private setGeometries(count: number) {
        this.geometries?.near.dispose()
        this.geometries?.far.dispose()

        const centers = new Float32Array(count * 2)
        const randoms = new Float32Array(count * 4)
        // jittered grid: even coverage without visible rows
        const side = Math.ceil(Math.sqrt(count))
        for (let i = 0; i < count; i++) {
            centers[i * 2] = ((i % side) + Math.random()) / side
            centers[i * 2 + 1] = (Math.floor(i / side) + Math.random()) / side
            for (let k = 0; k < 4; k++)
                randoms[i * 4 + k] = Math.random()
        }
        // shuffle so any prefix (the far patches draw half) is an even random subset
        for (let i = count - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            for (const [array, n] of [[centers, 2], [randoms, 4]] as [Float32Array, number][])
                for (let k = 0; k < n; k++) {
                    const t = array[i * n + k]
                    array[i * n + k] = array[j * n + k]
                    array[j * n + k] = t
                }
        }

        const build = (segments: number) => {
            // position = (side -1..1, height ratio 0..1, unused); bending is in the shader
            const vertices: number[] = []
            const indices: number[] = []
            for (let i = 0; i < segments; i++)
                vertices.push(- 1, i / segments, 0, 1, i / segments, 0)
            vertices.push(0, 1, 0)
            for (let i = 0; i < segments - 1; i++) {
                const a = i * 2
                indices.push(a, a + 1, a + 3, a, a + 3, a + 2)
            }
            const last = (segments - 1) * 2
            indices.push(last, last + 1, segments * 2)

            const geometry = new THREE.InstancedBufferGeometry()
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
            geometry.setIndex(indices)
            geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centers, 2))
            geometry.setAttribute('aRandom', new THREE.InstancedBufferAttribute(randoms, 4))
            geometry.instanceCount = count
            geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
            return geometry
        }
        const far = build(1)
        far.instanceCount = Math.ceil(count * 0.5)
        this.geometries = { near: build(3), far }
    }

    setMaterial() {
        this.material = new GrassMaterial()
        const uniforms = this.material.uniforms
        uniforms.uTime.value = 0
        uniforms.uPlayerPosition.value = new THREE.Vector3()
        uniforms.uPlayerLift.value = 0
        uniforms.uTerrainSize.value = this.state.chunks.minSize
        uniforms.uTerrainTextureSize.value = this.state.terrains.segments
        for (const key of ['A', 'B', 'C', 'D']) {
            uniforms[`uTerrain${key}Texture`].value = null
            uniforms[`uTerrain${key}Offset`].value = new THREE.Vector2()
        }
        // the terrain's noise texture: blades and ground take their colour drifts from the
        // very same texels
        uniforms.uNoiseTexture.value = this.view.terrains.material.uniforms.uNoiseTexture.value
        uniforms.uSunPosition.value = new THREE.Vector3(- 0.5, - 0.5, - 0.5)
        uniforms.uPatchOrigin.value = new THREE.Vector2()
        uniforms.uTrailOrigin.value = this.trail.origin
        uniforms.uTrailSize.value = this.trail.size
        for (const name of [...LIGHT_UNIFORMS, ...CLOUD_UNIFORMS])
            uniforms[name] = this.view.sky.uniforms[name]
        for (const name of SHADOW_UNIFORMS)
            uniforms[name] = this.view.shadows.uniforms[name]
        this.material.side = THREE.DoubleSide
    }

    applySettings() {
        this.style = GRASS_STYLE_PARAMETERS[this.settings.get('grass')]
        const quality = QUALITY[this.settings.get('quality')]
        this.radius = quality.radius
        const uniforms = this.material.uniforms
        uniforms.uRadius.value = this.radius
        uniforms.uPatchSize.value = this.patchSize
        uniforms.uHeightRange.value = new THREE.Vector2(...this.style.height)
        uniforms.uGrassDryness.value = this.style.dryness
        uniforms.uFlowers.value = this.style.flowers
        // many thin blades (a few centimetres wide, like real grass); fewer, wider ones at low
        // quality keep the field's coverage about the same
        const density = this.style.density * quality.density
        uniforms.uBladeWidth.value = THREE.MathUtils.clamp(0.045 * Math.sqrt(60 / Math.max(density, 1)), 0.035, 0.09)
        const count = Math.round(density * this.patchSize * this.patchSize)
        if (count > 0)
            this.setGeometries(count)
        this.group.visible = count > 0
        this.view.terrains.setGrass(this.style.dryness, count > 0 ? this.radius : 0)
    }

    private acquire(index: number): Patch {
        if (!this.pool[index]) {
            const mesh = new THREE.Mesh(this.geometries.near, this.material)
            mesh.frustumCulled = false
            mesh.renderOrder = - 1      // before the terrain: ground hidden by blades is skipped early
            const patch = { mesh, x: 0, z: 0, seed: 0 }
            mesh.onBeforeRender = () => {
                this.material.uniforms.uPatchOrigin.value.set(patch.x, patch.z)
                this.material.uniforms.uPatchSeed.value = patch.seed
                this.material.uniforms.uLodWidth.value = mesh.geometry === this.geometries.far ? 1.4 : 1
                this.material.uniformsNeedUpdate = true
            }
            this.pool[index] = patch
            this.group.add(mesh)
        }
        return this.pool[index]
    }

    private updatePatches() {
        const p = this.state.player.position.current
        const camera = this.view.camera.instance
        camera.updateMatrixWorld()
        this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))

        const size = this.patchSize
        const reach = this.radius + size * 0.71
        const minX = Math.floor((p[0] - this.radius) / size), maxX = Math.floor((p[0] + this.radius) / size)
        const minZ = Math.floor((p[2] - this.radius) / size), maxZ = Math.floor((p[2] + this.radius) / size)
        let used = 0
        for (let ix = minX; ix <= maxX; ix++) {
            for (let iz = minZ; iz <= maxZ; iz++) {
                const x = ix * size, z = iz * size
                const distance = Math.hypot(x + size * 0.5 - p[0], z + size * 0.5 - p[2])
                if (distance > reach)
                    continue
                const ground = this.state.chunks.getElevationForPosition(x + size * 0.5, z + size * 0.5)
                const y = typeof ground === 'number' ? ground : p[1]
                this.box.min.set(x, y - 8, z)
                this.box.max.set(x + size, y + 9, z + size)
                if (!this.frustum.intersectsBox(this.box))
                    continue
                const patch = this.acquire(used++)
                patch.x = x
                patch.z = z
                // stable per-patch random in 0..1
                patch.seed = Math.abs(Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453) % 1
                patch.mesh.geometry = distance < this.nearDistance ? this.geometries.near : this.geometries.far
                patch.mesh.visible = true
            }
        }
        for (let i = used; i < this.pool.length; i++)
            this.pool[i].mesh.visible = false
        this.visiblePatches = used
    }

    update() {
        const playerState = this.state.player
        const playerPosition = playerState.position.current
        const engineChunks = this.state.chunks
        const sunState = this.state.sun
        const uniforms = this.material.uniforms

        this.trail.update()
        uniforms.uTrailTexture.value = this.trail.texture

        uniforms.uTime.value = this.state.time.elapsed
        uniforms.uSunPosition.value.set(sunState.position.x, sunState.position.y, sunState.position.z)
        uniforms.uPlayerPosition.value.set(playerPosition[0], playerPosition[1], playerPosition[2])
        // the legs only push blades aside while the feet are near the ground
        const ground = engineChunks.getElevationForPosition(playerPosition[0], playerPosition[2])
        uniforms.uPlayerLift.value = typeof ground === 'number' ? Math.max(0, playerPosition[1] - ground) : 0

        if (!this.group.visible)
            return
        this.updatePatches()

        // Terrain data: the chunk under the player and its neighbours toward the player's side
        const aChunkState = engineChunks.getDeepestChunkForPosition(playerPosition[0], playerPosition[2])

        if (aChunkState && aChunkState.terrain && aChunkState.terrain.renderInstance) {
            uniforms.uTerrainATexture.value = aChunkState.terrain.renderInstance.texture
            const size = aChunkState.terrain.renderInstance.texture?.image.width
            if (size)
                uniforms.uTerrainTextureSize.value = size
            uniforms.uTerrainAOffset.value.set(aChunkState.x - aChunkState.size * 0.5, aChunkState.z - aChunkState.size * 0.5)

            const chunkPositionRatioX = (playerPosition[0] - aChunkState.x + aChunkState.size * 0.5) / aChunkState.size
            const chunkPositionRatioZ = (playerPosition[2] - aChunkState.z + aChunkState.size * 0.5) / aChunkState.size

            const bChunkState = aChunkState.neighbours.get(chunkPositionRatioX < 0.5 ? 'w' : 'e')
            if (bChunkState && bChunkState.terrain && bChunkState.terrain.renderInstance) {
                uniforms.uTerrainBTexture.value = bChunkState.terrain.renderInstance.texture
                uniforms.uTerrainBOffset.value.set(bChunkState.x - bChunkState.size * 0.5, bChunkState.z - bChunkState.size * 0.5)
            }

            const cChunkState = aChunkState.neighbours.get(chunkPositionRatioZ < 0.5 ? 'n' : 's')
            if (cChunkState && cChunkState.terrain && cChunkState.terrain.renderInstance) {
                uniforms.uTerrainCTexture.value = cChunkState.terrain.renderInstance.texture
                uniforms.uTerrainCOffset.value.set(cChunkState.x - cChunkState.size * 0.5, cChunkState.z - cChunkState.size * 0.5)
            }

            if (bChunkState) {
                const dChunkState = bChunkState.neighbours.get(chunkPositionRatioZ < 0.5 ? 'n' : 's')
                if (dChunkState && dChunkState.terrain && dChunkState.terrain.renderInstance) {
                    uniforms.uTerrainDTexture.value = dChunkState.terrain.renderInstance.texture
                    uniforms.uTerrainDOffset.value.set(dChunkState.x - dChunkState.size * 0.5, dChunkState.z - dChunkState.size * 0.5)
                }
            }
        }
    }
}
