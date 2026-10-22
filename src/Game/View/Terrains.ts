import * as THREE from 'three'

import Game from '../Game'
import View from './View'
import State from '../State/State'
import Terrain from './Terrain'
import TerrainMaterial from './Materials/TerrainMaterial'
import Viewport from '../State/Viewport'
import Sky, { CLOUD_UNIFORMS, LIGHT_UNIFORMS } from './Sky'
import { SHADOW_UNIFORMS } from './Shadows'
import TerrainState from '../State/Terrain'
import reliefShader from './Materials/shaders/relief/fragment.glsl'
import { loadTerrainTextures } from './TerrainTextures'
import Settings, { Quality } from '../Settings'

// Photo-scanned ground detail per quality: fade start / end (m), second scale against tiling
const GROUND_DETAIL: Record<Quality, [number, number, number]> = {
    lowest: [0, 0, 0],
    low: [0, 0, 0],
    medium: [40, 120, 0],
    high: [70, 210, 1],
    ultra: [100, 280, 1]
}
import { WATER_LEVEL } from '../Workers/TerrainShape'

export default class Terrains {
    game: Game
    state: State
    view: View
    viewport: Viewport
    sky: Sky
    material!: TerrainMaterial
    texturesCompressed = false

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()
        this.view = View.getInstance()

        this.viewport = this.state.viewport
        this.sky = this.view.sky

        this.setMaterial()

        this.state.terrains.events.on('create', (engineTerrain: TerrainState) => {
            const terrain = new Terrain(this, engineTerrain)

            engineTerrain.events.on('destroy', () => {
                terrain.destroy()
            })
        })
    }

    setMaterial() {
        this.material = new TerrainMaterial()
        this.material.uniforms.uPlayerPosition.value = new THREE.Vector3()
        this.material.uniforms.uSunPosition.value = new THREE.Vector3(- 0.5, - 0.5, - 0.5)
        // tiling Perlin noise (3 independent channels, mipmapped) for cheap surface detail;
        // the grass samples the same texture so blades and ground share their colour drifts
        this.material.uniforms.uNoiseTexture.value = this.view.noises.texture
        this.material.uniforms.uReliefTexture.value = this.view.noises.bake(reliefShader, 256, 256, true)
        // photo-scanned ground detail, faded in once loaded (how much depends on the quality)
        const settings = Settings.getInstance()
        const applyDetail = (quality: Quality) => this.material.uniforms.uGroundDetail.value.set(...GROUND_DETAIL[quality])
        applyDetail(settings.get('quality'))
        settings.events.on('change:quality', applyDetail)
        // the photo-scanned ground: not at all on the lowest quality (not even in memory), and
        // loaded the moment another is picked
        if (settings.get('quality') === 'lowest')
            settings.events.on('change:quality', (quality: Quality) => { if (quality !== 'lowest') this.loadGround() })
        else
            this.loadGround()
        this.material.uniforms.uGrassDistance.value = this.state.chunks.minSize
        this.material.uniforms.uTextureSize.value = this.state.terrains.segments
        this.material.uniforms.uWaterLevel.value = WATER_LEVEL
        // cloud shadows: the sky's cloud layer
        // the atmosphere's light and the cloud shadows
        for (const name of [...LIGHT_UNIFORMS, ...CLOUD_UNIFORMS])
            this.material.uniforms[name] = this.sky.uniforms[name]
        for (const name of SHADOW_UNIFORMS)
            this.material.uniforms[name] = this.view.shadows.uniforms[name]
        // aerial haze colours from the per-frame sky texture
        this.material.uniforms.uSkyLut.value = this.view.skyLut.texture
    }

    groundLoading = false          // the photo-scanned ground asked for (not on the lowest quality)

    private loadGround() {
        if (this.groundLoading)
            return
        this.groundLoading = true
        const settings = Settings.getInstance()
        const textureSize = ['high', 'ultra'].includes(settings.get('quality')) ? 2048 : 1024     // the quality it's first loaded at
        const renderer = this.view.renderer.instance
        const compress = settings.get('textureCompression') && renderer.extensions.has('WEBGL_compressed_texture_s3tc')
        const started = performance.now()
        loadTerrainTextures(Math.min(8, renderer.capabilities.getMaxAnisotropy()), textureSize, compress)
            .then(({ albedo, normal, means, compressed }) => {
                this.texturesCompressed = compressed
                if (import.meta.env.DEV)
                    console.info(`[terrain] ground textures ${compressed ? 'compressed (BC3)' : 'uncompressed'} in ${Math.round(performance.now() - started)} ms`)
                const uniforms = this.material.uniforms
                uniforms.uGroundAlbedo.value = albedo
                uniforms.uGroundNormal.value = normal
                uniforms.uGroundMeans.value = means
                uniforms.uGroundReady.value = 1
            })
            .catch((error) => console.warn('[terrain] ground textures unavailable', error))
    }

    update() {
        const playerState = this.state.player
        const playerPosition = playerState.position.current
        const sunState = this.state.sun

        this.material.uniforms.uPlayerPosition.value.set(playerPosition[0], playerPosition[1], playerPosition[2])
        this.material.uniforms.uSunPosition.value.set(sunState.position.x, sunState.position.y, sunState.position.z)
        // the trees' billboards reach to the vegetation radius; the canopy colour takes over there
        const radius = this.state.vegetation.radius
        this.material.uniforms.uForestFade.value.set(radius * 0.8, radius * 0.97)
    }

    /**
     * From the grass (Grass.ts): its style's dryness, so the ground under and beyond the field
     * matches the blades, and its reach, so the ground is shaded under the field exactly as far
     * as blades grow (0 = no grass).
     */
    setGrass(dryness: number, radius: number) {
        this.material.uniforms.uGrassDryness.value = dryness
        this.material.uniforms.uGrassDistance.value = Math.max(radius * 2, 1e-3)
    }

    resize() {
    }
}
