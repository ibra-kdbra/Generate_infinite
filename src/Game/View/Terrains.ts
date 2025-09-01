import * as THREE from 'three'

import Game from '../Game'
import View from './View'
import State from '../State/State'
import Terrain from './Terrain'
import TerrainGradient from './TerrainGradient'
import TerrainMaterial from './Materials/TerrainMaterial'
import Viewport from '../State/Viewport'
import Sky from './Sky'
import Debug from '../Debug/Debug'
import TerrainState from '../State/Terrain'

export default class Terrains {
    game: Game
    state: State
    view: View
    debug: Debug
    viewport: Viewport
    sky: Sky
    gradient!: TerrainGradient
    material!: TerrainMaterial

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()
        this.view = View.getInstance()
        this.debug = Debug.getInstance()

        this.viewport = this.state.viewport
        this.sky = this.view.sky

        this.setGradient()
        this.setMaterial()
        this.setDebug()

        this.state.terrains.events.on('create', (engineTerrain: TerrainState) => {
            const terrain = new Terrain(this, engineTerrain)

            engineTerrain.events.on('destroy', () => {
                terrain.destroy()
            })
        })
    }

    setGradient() {
        this.gradient = new TerrainGradient()
    }

    setMaterial() {
        this.material = new TerrainMaterial()
        this.material.uniforms.uPlayerPosition.value = new THREE.Vector3()
        this.material.uniforms.uGradientTexture.value = this.gradient.texture
        this.material.uniforms.uLightnessSmoothness.value = 0.25
        this.material.uniforms.uFresnelOffset.value = 0
        this.material.uniforms.uFresnelScale.value = 0.5
        this.material.uniforms.uFresnelPower.value = 2
        this.material.uniforms.uSunPosition.value = new THREE.Vector3(- 0.5, - 0.5, - 0.5)
        this.material.uniforms.uFogTexture.value = this.sky.customRender.texture
        this.material.uniforms.uGrassDistance.value = this.state.chunks.minSize
    }

    setDebug() {
        if (!this.debug.active)
            return

        const folder = this.debug.ui.getFolder('view/terrains')

        folder
            .add(this.material, 'wireframe')

        folder
            .add(this.material.uniforms.uLightnessSmoothness, 'value')
            .min(0)
            .max(1)
            .step(0.001)
            .name('uLightnessSmoothness')

        folder
            .add(this.material.uniforms.uFresnelOffset, 'value')
            .min(- 1)
            .max(1)
            .step(0.001)
            .name('uFresnelOffset')

        folder
            .add(this.material.uniforms.uFresnelScale, 'value')
            .min(0)
            .max(2)
            .step(0.001)
            .name('uFresnelScale')

        folder
            .add(this.material.uniforms.uFresnelPower, 'value')
            .min(1)
            .max(10)
            .step(1)
            .name('uFresnelPower')
    }

    update() {
        const playerState = this.state.player
        const playerPosition = playerState.position.current
        const sunState = this.state.sun

        this.material.uniforms.uPlayerPosition.value.set(playerPosition[0], playerPosition[1], playerPosition[2])
        this.material.uniforms.uSunPosition.value.set(sunState.position.x, sunState.position.y, sunState.position.z)
    }

    resize() {
    }
}
