import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import { WATER_LEVEL } from '../Workers/TerrainShape'
import PlayerState from '../State/Player'
import { CLOUD_UNIFORMS, LIGHT_UNIFORMS } from './Sky'
import { SHADOW_UNIFORMS } from './Shadows'

const RIPPLE_COUNT = 24
import vertexShader from './Materials/shaders/water/vertex.glsl'
import fragmentShader from './Materials/shaders/water/fragment.glsl'

/**
 * Lakes: one large plane at the water level that follows the player; the terrain hides it
 * everywhere the ground is above the water. Reflects the same sky model as the sky sphere.
 * The noise texture comes from the terrain (created after this), so it's attached on the
 * first update.
 */
export default class Water {
    view: View
    state: State
    scene: THREE.Scene
    material: THREE.ShaderMaterial
    mesh: THREE.Mesh
    ripples: THREE.Vector4[] = Array.from({ length: RIPPLE_COUNT }, () => new THREE.Vector4())
    private nextRipple = 0
    private rippleTimer = 0
    private wasInWater = false
    private fallSpeed = 0

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.scene = this.view.scene

        const uniforms: Record<string, THREE.IUniform> = {
            uSunPosition: { value: new THREE.Vector3(0, 1, 0) },
            uTime: { value: 0 },
            uNoiseTexture: { value: null },
            uRipples: { value: this.ripples },
            uSkyLut: { value: this.view.skyLut.texture }   // reflections of the same sky
        }
        for (const name of [...LIGHT_UNIFORMS, ...CLOUD_UNIFORMS])
            uniforms[name] = this.view.sky.uniforms[name]
        for (const name of SHADOW_UNIFORMS)
            uniforms[name] = this.view.shadows.uniforms[name]

        this.material = new THREE.ShaderMaterial({
            defines: { RIPPLE_COUNT },
            vertexShader,
            fragmentShader,
            uniforms,
            transparent: true,
            premultipliedAlpha: true,   // colour is the reflected light, alpha how much of the bed it hides
            depthWrite: false
        })

        // big enough to reach the haze at every view distance
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), this.material)
        this.mesh.geometry.rotateX(- Math.PI * 0.5)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 2
        this.scene.add(this.mesh)
    }

    private addRipple(x: number, z: number, strength: number) {
        this.ripples[this.nextRipple].set(x, z, this.state.time.elapsed, strength)
        this.nextRipple = (this.nextRipple + 1) % RIPPLE_COUNT
    }

    /** Rings on the water where the player swims, wades or falls in. */
    private updateRipples() {
        const player = this.state.player
        const p = player.position.current
        const dt = this.state.time.delta
        const swimming = player.movementState === PlayerState.STATE_SWIM
        const wading = !swimming && player.grounded && p[1] < WATER_LEVEL - 0.1
        const inWater = swimming || wading || p[1] < WATER_LEVEL

        if (!inWater)
            this.fallSpeed = Math.max(0, - player.velocity[1])
        else if (!this.wasInWater && this.fallSpeed > 3)
            this.addRipple(p[0], p[2], Math.min(2.2, 0.6 + this.fallSpeed * 0.12))   // splash
        this.wasInWater = inWater

        this.rippleTimer -= dt
        if (this.rippleTimer > 0 || !(swimming || wading))
            return
        const moving = player.speed > 0.4
        // just ahead of the body when moving: the wave the swimmer pushes
        const ahead = moving ? 0.5 : 0
        const x = p[0] - Math.sin(player.rotation) * ahead
        const z = p[2] - Math.cos(player.rotation) * ahead
        // frequent small rings while moving superpose into a V-shaped wake behind
        if (swimming) {
            this.addRipple(x, z, moving ? 0.55 + Math.min(0.4, player.speed * 0.1) : 0.4)
            this.rippleTimer = moving ? 0.16 : 1.2
        }
        else if (moving) {
            this.addRipple(x, z, 0.25 + Math.min(0.45, player.speed * 0.06))
            this.rippleTimer = 0.14
        }
    }

    update() {
        this.updateRipples()
        const playerState = this.state.player
        const sunState = this.state.sun
        const uniforms = this.material.uniforms

        if (!uniforms.uNoiseTexture.value && this.view.terrains)
            uniforms.uNoiseTexture.value = this.view.terrains.material.uniforms.uNoiseTexture.value

        uniforms.uTime.value = this.state.time.elapsed
        uniforms.uSunPosition.value.set(sunState.position.x, sunState.position.y, sunState.position.z)

        this.mesh.position.set(
            playerState.position.current[0],
            WATER_LEVEL,
            playerState.position.current[2]
        )
    }
}
