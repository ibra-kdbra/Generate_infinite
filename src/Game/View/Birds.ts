import * as THREE from 'three'

import View from './View'
import State from '../State/State'

const FLOCKS = 4
const PER_FLOCK = 14

/**
 * Birds: a few loose flocks wheeling over the land by day, each drifting along its own
 * wandering loop around the player 25-70 m above the ground. Every bird keeps a place in its
 * flock but weaves about it, flaps in bursts and glides between them, banking with the turns;
 * all of that happens in the vertex shader from a handful of numbers per flock (no per-bird
 * work on the CPU). They go to roost at dusk and come back in the morning, and stay home in
 * storms.
 */
export default class Birds {
    view: View
    state: State
    mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
    private flocks = Array.from({ length: FLOCKS }, (_, i) => ({
        angle: i * 1.7, radius: 70 + i * 28, speed: 0.06 + i * 0.012, height: 30 + i * 9,
        center: new THREE.Vector3(), heading: new THREE.Vector3(1, 0, 0), bank: 0
    }))

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()

        // one bird: a slim body and two swept wings (aWing: 0 at the body .. 1 at a wing tip)
        const positions = [
            // body
            0, 0, 0.32, 0.045, 0, 0, 0, 0.02, - 0.28,
            0, 0, 0.32, 0, 0.02, - 0.28, - 0.045, 0, 0,
            // left wing
            0.04, 0, 0.08, 0.5, 0, - 0.12, 0.04, 0, - 0.1,
            // right wing
            - 0.04, 0, 0.08, - 0.04, 0, - 0.1, - 0.5, 0, - 0.12
        ]
        const wing = positions.map((_, i) => i % 3 === 0 ? Math.abs(positions[i]) / 0.5 : 0).filter((_, i) => i % 3 === 0)
        const geometry = new THREE.InstancedBufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1))
        const count = FLOCKS * PER_FLOCK
        const offsets = new Float32Array(count * 4), seeds = new Float32Array(count * 2)
        for (let i = 0; i < count; i++) {
            const f = Math.floor(i / PER_FLOCK)
            // a loose V-ish cloud behind the leader
            const k = i % PER_FLOCK
            offsets.set([(Math.random() - 0.5) * 9, (Math.random() - 0.5) * 3, - k * 0.9 - Math.random() * 3, f], i * 4)
            seeds.set([Math.random(), 0.8 + Math.random() * 0.45], i * 2)
        }
        geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 4))
        geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 2))
        geometry.instanceCount = count

        const sky = this.view.sky.uniforms
        this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uCenters: { value: this.flocks.map(() => new THREE.Vector3()) },
                uHeadings: { value: this.flocks.map(() => new THREE.Vector4()) },
                uVisible: { value: 1 },
                uSkyLight: sky.uSkyLight,
                uSunLight: sky.uSunLight
            },
            vertexShader: /* glsl */ `
                uniform float uTime;
                uniform vec3 uCenters[${FLOCKS}];
                uniform vec4 uHeadings[${FLOCKS}];    // xyz the way the flock flies, w its bank
                uniform float uVisible;
                attribute float aWing;
                attribute vec4 aOffset;               // place in the flock (xyz), which flock (w)
                attribute vec2 aSeed;                 // phase, size
                void main() {
                    int f = int(aOffset.w + 0.5);
                    vec3 forward = normalize(uHeadings[f].xyz);
                    vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
                    vec3 up = cross(right, forward);
                    float phase = aSeed.x * 6.2831;
                    // weaving about its place
                    vec3 weave = vec3(sin(uTime * 0.7 + phase) * 2.2, sin(uTime * 0.9 + phase * 1.3) * 1.2, cos(uTime * 0.5 + phase) * 1.6);
                    vec3 place = right * (aOffset.x + weave.x) + up * (aOffset.y + weave.y) + forward * (aOffset.z + weave.z);
                    // flap in bursts, glide between them
                    float flapping = smoothstep(- 0.2, 0.4, sin(uTime * 0.45 + phase * 2.0));
                    float flap = sin(uTime * (9.0 + aSeed.x * 3.0) + phase) * mix(0.08, 0.95, flapping);
                    vec3 local = position;
                    local.y += aWing * aWing * flap * 0.45 + aWing * 0.06;
                    local *= aSeed.y * uVisible;
                    // bank with the turn
                    float bank = uHeadings[f].w + sin(uTime * 0.9 + phase) * 0.15;
                    vec3 bankedRight = right * cos(bank) + up * sin(bank);
                    vec3 bankedUp = cross(bankedRight, forward);
                    vec3 world = uCenters[f] + place + bankedRight * - local.x + bankedUp * local.y + forward * local.z;
                    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
                }`,
            fragmentShader: /* glsl */ `
                uniform vec3 uSkyLight;
                uniform vec3 uSunLight;
                void main() {
                    // dark birds against the sky: a little sky and sun light on them
                    vec3 color = vec3(0.035, 0.034, 0.032) * (uSkyLight * 1.4 + uSunLight * 0.35);
                    gl_FragColor = vec4(color, 1.0);
                }`,
            side: THREE.DoubleSide
        }))
        this.mesh.frustumCulled = false
        this.view.scene.add(this.mesh)
    }

    update() {
        const dt = Math.min(this.state.time.delta, 0.1)
        const p = this.state.player.position.current
        const uniforms = this.mesh.material.uniforms
        uniforms.uTime.value = this.state.time.elapsed
        // by day, and not in a storm
        const sunY = this.state.sun.position.y
        const day = THREE.MathUtils.smoothstep(sunY, - 0.02, 0.12) * (1 - this.view.weather.storm) * (1 - this.view.weather.rain * 0.7)
        uniforms.uVisible.value += (day - uniforms.uVisible.value) * (1 - Math.exp(- dt * 0.5))
        this.mesh.visible = uniforms.uVisible.value > 0.02

        this.flocks.forEach((flock, i) => {
            const previous = flock.center.clone()
            flock.angle += flock.speed * dt * (1 + 0.3 * Math.sin(this.state.time.elapsed * 0.05 + i))
            const wobble = Math.sin(flock.angle * 2.3 + i) * 0.35
            const radius = flock.radius * (1 + wobble)
            const x = p[0] + Math.cos(flock.angle) * radius
            const z = p[2] + Math.sin(flock.angle * 0.83 + i) * radius
            const ground = this.state.player.groundAt(x, z)
            const target = new THREE.Vector3(x, Math.max(ground, p[1]) + flock.height + Math.sin(flock.angle * 3 + i) * 8, z)
            if (flock.center.lengthSq() === 0) flock.center.copy(target)
            flock.center.lerp(target, 1 - Math.exp(- dt * 0.8))
            const velocity = flock.center.clone().sub(previous)
            if (velocity.lengthSq() > 1e-8) {
                const heading = velocity.normalize()
                // banking: how fast the heading turns
                const turn = flock.heading.x * heading.z - flock.heading.z * heading.x
                flock.bank += (THREE.MathUtils.clamp(turn / Math.max(dt, 1e-3) * 2.5, - 0.7, 0.7) - flock.bank) * (1 - Math.exp(- dt * 2))
                flock.heading.lerp(heading, 1 - Math.exp(- dt * 3)).normalize()
            }
            uniforms.uCenters.value[i].copy(flock.center)
            uniforms.uHeadings.value[i].set(flock.heading.x, flock.heading.y, flock.heading.z, flock.bank)
        })
    }
}
