import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Settings from '../Settings'
import { WATER_LEVEL } from '../Workers/TerrainShape'

const DROPS = 9000
const BOX = new THREE.Vector3(36, 22, 36)      // the volume of rain kept around the camera (m)

/**
 * Rain and storms, following the sky's weather (Sky.ts): rain falls when the weather says
 * so (or, when it's changing on its own, under heavy cover), thickening and thinning
 * slowly. Drops are streaks in a box that travels with the camera, falling and blown by
 * the wind entirely in the vertex shader (no per-frame work on the CPU); the ground darkens
 * and turns glossy as it gets wet and dries afterward; small splashes jump off it near the
 * player. Overcast skies dim and grey the light. Storms add gusts to the trees and
 * lightning: a few flickers of white light over everything, thunder following (Audio.ts).
 */
export default class Weather {
    view: View
    state: State
    rain = 0                 // 0 dry .. 1 pouring (smoothed)
    storm = 0                // 0 .. 1
    wetness = 0              // the ground: wets in minutes, dries slower
    lightning = 0            // the current flash, 0 .. ~3
    events = new Set<(event: 'thunder', delay: number, strength: number) => void>()

    private mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
    private nextStrike = 8
    private flash: number[] = []          // times of the flickers of the current strike
    private splashTime = 0
    private settings = Settings.getInstance()

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()

        // one drop: a thin quad, its long side along the fall
        const quad = new THREE.PlaneGeometry(1, 1)
        quad.translate(0, 0.5, 0)
        const geometry = new THREE.InstancedBufferGeometry()
        geometry.index = quad.index
        geometry.setAttribute('position', quad.getAttribute('position'))
        geometry.setAttribute('uv', quad.getAttribute('uv'))
        const seeds = new Float32Array(DROPS * 4)
        for (let i = 0; i < DROPS * 4; i++)
            seeds[i] = Math.random()
        geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
        geometry.instanceCount = 0

        const sky = this.view.sky.uniforms
        this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uCenter: { value: new THREE.Vector3() },
                uBox: { value: BOX },
                uWind: { value: new THREE.Vector2() },
                uSkyLight: sky.uSkyLight,
                uSunLight: sky.uSunLight,
                uLightning: { value: 0 },
                uWaterLevel: { value: WATER_LEVEL },
                uOpacity: { value: 0 }
            },
            vertexShader: /* glsl */ `
                uniform float uTime;
                uniform vec3 uCenter;
                uniform vec3 uBox;
                uniform vec2 uWind;
                uniform float uWaterLevel;
                attribute vec4 aSeed;
                varying float vFade;
                varying vec2 vUv;
                void main() {
                    // each drop falls through the box and wraps around, the box following the camera
                    float speed = 8.5 + aSeed.w * 3.0;
                    vec3 velocity = vec3(uWind.x, - speed, uWind.y);
                    vec3 start = (aSeed.xyz - 0.5) * uBox;
                    vec3 p = start + velocity * (uTime + aSeed.w * 13.0);
                    p = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5 + uCenter;
                    // a streak along its velocity, facing the camera across it
                    vec3 along = normalize(velocity);
                    vec3 toCamera = normalize(cameraPosition - p);
                    vec3 side = normalize(cross(along, toCamera));
                    float length = 0.45 + aSeed.y * 0.3;
                    vec3 world = p + side * (position.x * 0.016) + along * (position.y * length);
                    vUv = uv;
                    float distanceToCamera = distance(world, cameraPosition);
                    vFade = smoothstep(0.6, 2.0, distanceToCamera) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, distanceToCamera)) * step(uWaterLevel, world.y);
                    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
                }`,
            fragmentShader: /* glsl */ `
                uniform vec3 uSkyLight;
                uniform vec3 uSunLight;
                uniform float uLightning;
                uniform float uOpacity;
                varying float vFade;
                varying vec2 vUv;
                void main() {
                    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
                    float along = smoothstep(0.0, 0.4, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
                    float a = across * along * vFade * uOpacity;
                    vec3 light = uSkyLight * 1.6 + uSunLight * 0.15 + vec3(uLightning * 0.6);
                    gl_FragColor = vec4(light * a, a);
                }`,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }))
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 4
        this.view.scene.add(this.mesh)
    }

    /** How hard it should be raining now. */
    private targetRain() {
        const weather = this.settings.get('weather')
        const cover = this.view.sky.cover
        if (weather === 'rain') return THREE.MathUtils.smoothstep(cover, 0.55, 0.78) * 0.8
        if (weather === 'storm') return THREE.MathUtils.smoothstep(cover, 0.6, 0.88)
        if (weather === 'auto' && this.view.sky.cloudCoverOverride === null) return THREE.MathUtils.smoothstep(cover, 0.72, 0.88) * 0.85
        return 0
    }

    update() {
        const dt = Math.min(this.state.time.delta, 0.1)
        const sky = this.view.sky
        this.rain += (this.targetRain() - this.rain) * (1 - Math.exp(- dt * 0.25))
        const stormTarget = this.settings.get('weather') === 'storm' ? 1 : 0
        this.storm += (stormTarget * THREE.MathUtils.smoothstep(sky.cover, 0.7, 0.9) - this.storm) * (1 - Math.exp(- dt * 0.3))
        // the ground wets in a couple of minutes of rain, dries in several
        this.wetness = THREE.MathUtils.clamp(this.wetness + (this.rain > 0.05 ? dt / 90 * this.rain : - dt / 400), 0, 1)
        sky.uniforms.uRainWet.value = this.wetness

        // rain around the camera, blown by the wind (and harder in a storm)
        const camera = this.view.camera.instance.position
        const uniforms = this.mesh.material.uniforms
        uniforms.uTime.value = this.state.time.elapsed
        uniforms.uCenter.value.copy(camera)
        const angle = THREE.MathUtils.degToRad(sky.wind.direction)
        const gust = 1.2 + this.storm * 3.5 + Math.sin(this.state.time.elapsed * 0.7) * this.storm
        uniforms.uWind.value.set(Math.cos(angle) * gust, Math.sin(angle) * gust)
        uniforms.uOpacity.value = 0.32 + this.rain * 0.2
        this.mesh.geometry.instanceCount = Math.round(DROPS * this.rain)
        this.mesh.visible = this.rain > 0.01

        // splashes off the ground near the player
        const p = this.state.player.position.current
        this.splashTime += dt * this.rain * 14
        while (this.splashTime > 1) {
            this.splashTime -= 1
            const x = p[0] + (Math.random() - 0.5) * 10, z = p[2] + (Math.random() - 0.5) * 10
            const ground = this.state.player.groundAt(x, z)
            this.view.particles.emit('drizzle', new THREE.Vector3(x, Math.max(ground, WATER_LEVEL) + 0.02, z), 2, new THREE.Vector3(0, 1, 0), 0.9, 0.7)
        }

        // storms: gusts in the trees, lightning now and then
        this.view.trees.windStrength = 1 + this.storm * 1.8 + this.rain * 0.4
        this.updateLightning(dt)
        uniforms.uLightning.value = this.lightning
    }

    private updateLightning(dt: number) {
        const sky = this.view.sky
        this.nextStrike -= dt
        if (this.storm > 0.3 && this.nextStrike <= 0) {
            this.nextStrike = 5 + Math.random() * 14 / this.storm
            // a strike flickers two to four times within a third of a second
            const t = this.state.time.elapsed
            const flickers = 2 + Math.floor(Math.random() * 3)
            this.flash = Array.from({ length: flickers }, (_, i) => t + i * (0.06 + Math.random() * 0.09))
            const distance = 0.3 + Math.random() * 3          // km: thunder takes ~3 s per km
            for (const listener of this.events)
                listener('thunder', distance * 2.9, Math.min(1, 1.4 / distance))
        }
        const t = this.state.time.elapsed
        let flash = 0
        for (const at of this.flash)
            if (t >= at) flash = Math.max(flash, Math.exp(- (t - at) * 22) * 3)
        this.lightning = flash
        sky.lightning = flash
    }
}
