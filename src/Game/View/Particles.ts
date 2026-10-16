import * as THREE from 'three'

import View from './View'
import State from '../State/State'

export type ParticleKind = 'spark' | 'ember' | 'chip' | 'dirt' | 'grass' | 'leaf' | 'splash' | 'dust'

type Look = {
    colors: string[]
    size: [number, number]       // metres
    life: [number, number]       // seconds
    gravity: number
    drag: number
    glow: boolean                // additive and self-lit (sparks, embers) or lit by the sky
    spin?: boolean               // flutters (leaves, clippings): drifts sideways as it falls
}

const LOOKS: Record<ParticleKind, Look> = {
    spark: { colors: ['#ffd38a', '#ffb24d', '#fff1c9'], size: [0.025, 0.045], life: [0.18, 0.4], gravity: 9.8, drag: 1.5, glow: true },
    ember: { colors: ['#ff9a3c', '#ffb85c', '#ff6a1e'], size: [0.02, 0.035], life: [0.6, 1.3], gravity: - 1.2, drag: 1.2, glow: true },
    chip: { colors: ['#c79a62', '#a87a46', '#e0bd8a', '#7d5a36'], size: [0.03, 0.06], life: [0.6, 1.1], gravity: 9.8, drag: 0.6, glow: false },
    dirt: { colors: ['#5a4630', '#6e573b', '#4a3a28'], size: [0.03, 0.07], life: [0.45, 0.9], gravity: 9.8, drag: 0.8, glow: false },
    grass: { colors: ['#6f8f3a', '#86a04a', '#5d7a2e', '#9aa85a'], size: [0.03, 0.06], life: [0.7, 1.4], gravity: 3.5, drag: 2.6, glow: false, spin: true },
    leaf: { colors: ['#5f7a33', '#748c3e', '#8a9a4a', '#56702c'], size: [0.05, 0.09], life: [1.6, 3.2], gravity: 1.6, drag: 2.2, glow: false, spin: true },
    splash: { colors: ['#d8e6ec', '#b9cfd8', '#eef5f8'], size: [0.03, 0.06], life: [0.35, 0.7], gravity: 9.8, drag: 0.8, glow: false },
    dust: { colors: ['#8a7a62', '#9a8b72', '#776a55'], size: [0.12, 0.28], life: [0.8, 1.6], gravity: - 0.3, drag: 2.2, glow: false }
}

const CAPACITY = 600

type Pool = {
    points: THREE.Points
    position: Float32Array
    color: Float32Array          // rgb + alpha
    size: Float32Array
    velocity: Float32Array
    age: Float32Array
    life: Float32Array
    kind: Uint8Array
    count: number
}

const KINDS = Object.keys(LOOKS) as ParticleKind[]

/**
 * Small bursts that sell a hit: wood chips off a trunk, sparks off rock, dirt from the hoe,
 * clippings from the sickle, leaves shaken loose, embers from the torch, splashes. Simulated
 * on the CPU (gravity, drag, a flutter for light bits), drawn as round points: two pools,
 * one lit like the world (the sky and sun light), one glowing (additive, for the bloom).
 */
export default class Particles {
    view: View
    private lit: Pool
    private glow: Pool

    constructor() {
        this.view = View.getInstance()
        const uniforms = this.view.sky.uniforms
        this.lit = this.pool(false, uniforms)
        this.glow = this.pool(true, uniforms)
    }

    private pool(glow: boolean, sky: Record<string, THREE.IUniform>): Pool {
        const geometry = new THREE.BufferGeometry()
        const position = new Float32Array(CAPACITY * 3)
        const color = new Float32Array(CAPACITY * 4)
        const size = new Float32Array(CAPACITY)
        geometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage))
        geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 4).setUsage(THREE.DynamicDrawUsage))
        geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage))
        geometry.setDrawRange(0, 0)
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uScale: { value: 1 },
                uSunLight: sky.uSunLight,
                uSkyLight: sky.uSkyLight,
                uSunPosition: sky.uSunPosition
            },
            vertexShader: /* glsl */ `
                uniform float uScale;
                attribute vec4 aColor;
                attribute float aSize;
                varying vec4 vColor;
                void main() {
                    vColor = aColor;
                    vec4 view = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * view;
                    gl_PointSize = clamp(aSize * uScale / max(0.05, - view.z), 1.0, 64.0);
                }`,
            fragmentShader: glow
                ? /* glsl */ `
                varying vec4 vColor;
                void main() {
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    float a = (1.0 - smoothstep(0.2, 1.0, d)) * vColor.a;
                    gl_FragColor = vec4(vColor.rgb * 9.0 * a, a);
                }`
                : /* glsl */ `
                uniform vec3 uSunLight;
                uniform vec3 uSkyLight;
                uniform vec3 uSunPosition;
                varying vec4 vColor;
                void main() {
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    if (d > 1.0) discard;
                    // a small rough bit, lit from above by the sky and the sun
                    vec3 light = uSkyLight + uSunLight * max(0.0, normalize(uSunPosition).y) * 0.6;
                    gl_FragColor = vec4(vColor.rgb * light, vColor.a * (1.0 - smoothstep(0.7, 1.0, d)));
                }`,
            transparent: true,
            depthWrite: false,
            blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending
        })
        const points = new THREE.Points(geometry, material)
        points.frustumCulled = false
        points.renderOrder = 2
        this.view.scene.add(points)
        return {
            points, position, color, size,
            velocity: new Float32Array(CAPACITY * 3),
            age: new Float32Array(CAPACITY),
            life: new Float32Array(CAPACITY),
            kind: new Uint8Array(CAPACITY),
            count: 0
        }
    }

    /**
     * A burst of `count` bits of this kind at `at`, flying out along `direction` (spread by
     * `spread`, 0 a jet .. 1 every way) at about `speed` m/s.
     */
    emit(kind: ParticleKind, at: THREE.Vector3, count: number, direction: THREE.Vector3 = new THREE.Vector3(0, 1, 0), speed = 3, spread = 0.6) {
        const look = LOOKS[kind]
        const pool = look.glow ? this.glow : this.lit
        const dir = direction.clone().normalize()
        const random = new THREE.Vector3()
        const color = new THREE.Color()
        for (let n = 0; n < count; n++) {
            if (pool.count >= CAPACITY)
                this.removeAt(pool, 0)
            const i = pool.count++
            random.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
            const v = dir.clone().lerp(random, spread).normalize().multiplyScalar(speed * (0.45 + Math.random() * 0.8))
            pool.position.set([at.x + random.x * 0.05, at.y + random.y * 0.05, at.z + random.z * 0.05], i * 3)
            pool.velocity.set([v.x, v.y, v.z], i * 3)
            color.set(look.colors[Math.floor(Math.random() * look.colors.length)]).convertSRGBToLinear()
            pool.color.set([color.r, color.g, color.b, 1], i * 4)
            pool.size[i] = look.size[0] + Math.random() * (look.size[1] - look.size[0])
            pool.age[i] = 0
            pool.life[i] = look.life[0] + Math.random() * (look.life[1] - look.life[0])
            pool.kind[i] = KINDS.indexOf(kind)
        }
    }

    private removeAt(pool: Pool, i: number) {
        const last = --pool.count
        if (i === last)
            return
        pool.position.copyWithin(i * 3, last * 3, last * 3 + 3)
        pool.velocity.copyWithin(i * 3, last * 3, last * 3 + 3)
        pool.color.copyWithin(i * 4, last * 4, last * 4 + 4)
        pool.size[i] = pool.size[last]
        pool.age[i] = pool.age[last]
        pool.life[i] = pool.life[last]
        pool.kind[i] = pool.kind[last]
    }

    private step(pool: Pool, dt: number, time: number, ground: (x: number, z: number) => number) {
        for (let i = pool.count - 1; i >= 0; i--) {
            pool.age[i] += dt
            if (pool.age[i] >= pool.life[i]) {
                this.removeAt(pool, i)
                continue
            }
            const look = LOOKS[KINDS[pool.kind[i]]]
            const p = i * 3
            const drag = Math.exp(- look.drag * dt)
            pool.velocity[p] *= drag
            pool.velocity[p + 1] = pool.velocity[p + 1] * drag - look.gravity * dt
            pool.velocity[p + 2] *= drag
            if (look.spin) {
                // flutter: a light bit swings side to side as it settles
                const phase = time * 7 + i * 1.7
                pool.velocity[p] += Math.sin(phase) * 2.2 * dt
                pool.velocity[p + 2] += Math.cos(phase * 0.8) * 2.2 * dt
            }
            pool.position[p] += pool.velocity[p] * dt
            pool.position[p + 1] += pool.velocity[p + 1] * dt
            pool.position[p + 2] += pool.velocity[p + 2] * dt
            // settle on the ground
            const floor = ground(pool.position[p], pool.position[p + 2]) + 0.01
            if (pool.position[p + 1] < floor) {
                pool.position[p + 1] = floor
                pool.velocity[p] *= 0.3
                pool.velocity[p + 1] = look.glow ? - pool.velocity[p + 1] * 0.3 : 0
                pool.velocity[p + 2] *= 0.3
            }
            const t = pool.age[i] / pool.life[i]
            pool.color[i * 4 + 3] = look.glow ? 1 - t * t : 1 - THREE.MathUtils.smoothstep(t, 0.7, 1)
        }
        const geometry = pool.points.geometry
        geometry.setDrawRange(0, pool.count)
        for (const name of ['position', 'aColor', 'aSize']) {
            const attribute = geometry.getAttribute(name) as THREE.BufferAttribute
            attribute.clearUpdateRanges()
            attribute.addUpdateRange(0, pool.count * attribute.itemSize)
            attribute.needsUpdate = true
        }
    }

    update() {
        const state = State.getInstance()
        const dt = Math.min(state.time.delta, 0.05)
        const ground = (x: number, z: number) => state.player.groundAt(x, z)
        // point size in pixels per metre at 1 m
        const renderer = this.view.renderer.instance
        const scale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.view.camera.instance.fov) / 2))
        for (const pool of [this.lit, this.glow]) {
            (pool.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale
            // (always drawn, even empty: its shader is compiled up front, not at the first hit)
            if (pool.count > 0 || pool.points.geometry.drawRange.count > 0)
                this.step(pool, dt, state.time.elapsed, ground)
        }
    }
}
