import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import PlayerState from '../State/Player'
import { WATER_LEVEL } from '../Workers/TerrainShape'

const CAPACITY = 600

/**
 * Water droplets: spray kicked up when wading or running through the shallows, splashes of
 * each swimming stroke, a burst when jumping in, and drips falling off a wet character. A
 * small CPU particle system (gravity, drag), drawn as soft points. Drips that land wet the
 * ground (GroundWetness).
 */
export default class Splashes {
    view: View
    state: State
    points: THREE.Points
    material: THREE.ShaderMaterial
    landed: { x: number, z: number }[] = []      // drips that hit the ground this frame

    private positions = new Float32Array(CAPACITY * 3)
    private velocities = new Float32Array(CAPACITY * 3)
    private ages = new Float32Array(CAPACITY).fill(1e9)
    private lives = new Float32Array(CAPACITY).fill(1)
    private sizes = new Float32Array(CAPACITY)
    private drips = new Uint8Array(CAPACITY)
    private next = 0
    private stepDistance = 0
    private dripTimer = 0
    private strokePhase = 0
    private wasInWater = false
    private fallSpeed = 0

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
        geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage))
        geometry.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(CAPACITY), 1).setUsage(THREE.DynamicDrawUsage))
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uSunPosition: { value: new THREE.Vector3(0, 1, 0) },
                uPixelRatio: { value: 1 }
            },
            vertexShader: `
                uniform float uPixelRatio;
                attribute float aSize;
                attribute float aAge;          // 0 new .. 1 gone
                varying float vAge;
                void main()
                {
                    vec4 view = viewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * view;
                    gl_PointSize = aSize * uPixelRatio * 420.0 / max(1.0, - view.z);
                    vAge = aAge;
                }`,
            fragmentShader: `
                uniform vec3 uSunPosition;
                varying float vAge;
                void main()
                {
                    if (vAge >= 1.0)
                        discard;
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    float alpha = (1.0 - smoothstep(0.4, 1.0, d)) * (1.0 - vAge) * 0.75;
                    if (alpha < 0.01)
                        discard;
                    float day = clamp(normalize(uSunPosition).y * 2.0 + 0.4, 0.0, 1.0);
                    vec3 color = mix(vec3(0.022, 0.033, 0.055), vec3(0.72, 0.83, 0.91), day);     // linear light
                    gl_FragColor = vec4(color, alpha);
                }`,
            transparent: true,
            depthWrite: false
        })
        this.points = new THREE.Points(geometry, this.material)
        this.points.frustumCulled = false
        this.points.renderOrder = 3
        this.view.scene.add(this.points)
    }

    emit(x: number, y: number, z: number, count: number, options: { speed: number, up: number, spread: number, size: number, life: number, vx?: number, vz?: number, drip?: boolean }) {
        for (let n = 0; n < count; n++) {
            const i = this.next
            this.next = (this.next + 1) % CAPACITY
            const angle = Math.random() * Math.PI * 2
            const r = Math.random() * options.spread
            this.positions[i * 3] = x + Math.cos(angle) * r
            this.positions[i * 3 + 1] = y
            this.positions[i * 3 + 2] = z + Math.sin(angle) * r
            const speed = options.speed * (0.4 + Math.random() * 0.6)
            this.velocities[i * 3] = Math.cos(angle) * speed + (options.vx ?? 0)
            this.velocities[i * 3 + 1] = options.up * (0.6 + Math.random() * 0.6)
            this.velocities[i * 3 + 2] = Math.sin(angle) * speed + (options.vz ?? 0)
            this.ages[i] = 0
            this.lives[i] = options.life * (0.7 + Math.random() * 0.6)
            this.sizes[i] = options.size * (0.6 + Math.random() * 0.8)
            this.drips[i] = options.drip ? 1 : 0
        }
    }

    /** Where the character's interaction with the water throws droplets. */
    private emitters(dt: number) {
        const player = this.state.player
        const p = player.position.current
        const swimming = player.movementState === PlayerState.STATE_SWIM
        const depth = WATER_LEVEL - p[1]
        const wading = !swimming && player.grounded && depth > 0.05
        const inWater = swimming || wading || p[1] < WATER_LEVEL
        const vx = player.velocity[0], vz = player.velocity[2]
        const speed = player.speed

        // jumping (or falling) in: a burst
        if (!inWater)
            this.fallSpeed = Math.max(0, - player.velocity[1])
        else if (!this.wasInWater && this.fallSpeed > 3)
            this.emit(p[0], WATER_LEVEL, p[2], Math.min(90, 25 + this.fallSpeed * 5), { speed: 2.2, up: 2.5 + this.fallSpeed * 0.35, spread: 0.5, size: 0.07, life: 1.1 })
        this.wasInWater = inWater

        // wading: spray at the shins with every step, more when running
        if (wading && speed > 0.6) {
            this.stepDistance += speed * dt
            const stride = 0.55 + speed * 0.06
            if (this.stepDistance > stride) {
                this.stepDistance = 0
                const count = Math.round(4 + speed * 2.2 * Math.min(1, depth / 0.4 + 0.3))
                this.emit(p[0] + vx * 0.06, WATER_LEVEL + 0.02, p[2] + vz * 0.06, count, { speed: 0.6 + speed * 0.18, up: 1.2 + speed * 0.32, spread: 0.25, size: 0.05, life: 0.8, vx: vx * 0.5, vz: vz * 0.5 })
            }
        }

        // swimming: each arm stroke splashes ahead of the shoulders
        if (swimming && speed > 0.4) {
            this.strokePhase += dt / 0.4
            if (this.strokePhase > 1) {
                this.strokePhase = 0
                const forwardX = - Math.sin(player.rotation), forwardZ = - Math.cos(player.rotation)
                const side = Math.random() < 0.5 ? - 0.35 : 0.35
                const x = p[0] + forwardX * 0.9 + forwardZ * side
                const z = p[2] + forwardZ * 0.9 - forwardX * side
                this.emit(x, WATER_LEVEL + 0.05, z, 10, { speed: 0.8, up: 1.6, spread: 0.2, size: 0.05, life: 0.9, vx: vx * 0.4, vz: vz * 0.4 })
            }
        }

        // dripping when wet and out of the water
        if (!inWater && player.wetness > 0.15) {
            this.dripTimer -= dt
            if (this.dripTimer < 0) {
                this.dripTimer = 0.25 / player.wetness
                const height = Math.random() * Math.max(0.3, player.wetHeight * 0.9)
                this.emit(p[0] + (Math.random() - 0.5) * 0.4, p[1] + height, p[2] + (Math.random() - 0.5) * 0.4, 1, { speed: 0.05, up: 0, spread: 0.05, size: 0.025, life: 1.5, vx: vx * 0.8, vz: vz * 0.8, drip: true })
            }
        }
    }

    update() {
        const dt = Math.min(this.state.time.delta, 0.05)
        this.emitters(dt)

        const ageAttribute = this.points.geometry.getAttribute('aAge') as THREE.BufferAttribute
        const ages = ageAttribute.array as Float32Array
        const drag = Math.exp(- dt * 0.8)
        this.landed.length = 0
        for (let i = 0; i < CAPACITY; i++) {
            if (this.ages[i] >= this.lives[i]) {
                ages[i] = 1
                continue
            }
            this.ages[i] += dt
            this.velocities[i * 3] *= drag
            this.velocities[i * 3 + 2] *= drag
            this.velocities[i * 3 + 1] -= 9.81 * dt
            this.positions[i * 3] += this.velocities[i * 3] * dt
            this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt
            this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt
            // back into the water or onto the ground: gone (drips leave a wet spot)
            const x = this.positions[i * 3], y = this.positions[i * 3 + 1], z = this.positions[i * 3 + 2]
            if (this.velocities[i * 3 + 1] < 0) {
                const ground = this.state.chunks.getElevationForPosition(x, z)
                const floor = Math.max(WATER_LEVEL, typeof ground === 'number' ? ground : - Infinity)
                if (y < floor) {
                    if (this.drips[i] && floor > WATER_LEVEL)
                        this.landed.push({ x, z })
                    this.ages[i] = this.lives[i]
                }
            }
            ages[i] = Math.min(1, this.ages[i] / this.lives[i])
        }
        ;(this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
        ;(this.points.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true
        ageAttribute.needsUpdate = true

        const sun = this.state.sun.position
        this.material.uniforms.uSunPosition.value.set(sun.x, sun.y, sun.z)
        this.material.uniforms.uPixelRatio.value = this.view.renderer.instance.getPixelRatio()
    }
}
