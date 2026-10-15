import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Splashes from './Splashes'
import { WATER_LEVEL } from '../Workers/TerrainShape'

const MAX_STAMPS = 64

/**
 * Wet patches on the ground around the player: footprints left by wet feet (one per step,
 * left and right) and the spots where drips land. A 512² texture over 64 m (12.5 cm per
 * texel) that scrolls with the player and dries out over about half a minute; the terrain
 * shader darkens and glosses the ground where it's wet.
 */
export default class GroundWetness {
    view: View
    state: State
    splashes: Splashes
    size = 64
    resolution = 512
    origin = new THREE.Vector2()
    texture: THREE.Texture

    private targets: THREE.WebGLRenderTarget[]
    private current = 0
    private camera = new THREE.OrthographicCamera(- 1, 1, 1, - 1, 0, 1)
    private fadeScene = new THREE.Scene()
    private fadeMaterial: THREE.ShaderMaterial
    private stampScene = new THREE.Scene()
    private stampGeometry: THREE.InstancedBufferGeometry
    private stampMaterial: THREE.ShaderMaterial
    private pending: number[] = []          // x, z, length, width, angle, wetness
    private stepDistance = 0
    private foot = 1

    constructor(splashes: Splashes) {
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.splashes = splashes

        const options = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false }
        this.targets = [
            new THREE.WebGLRenderTarget(this.resolution, this.resolution, options),
            new THREE.WebGLRenderTarget(this.resolution, this.resolution, options)
        ]
        this.texture = this.targets[0].texture

        // pass 1: last frame's wetness, scrolled with the player, drying
        this.fadeMaterial = new THREE.ShaderMaterial({
            uniforms: { uPrevious: { value: null }, uShift: { value: new THREE.Vector2() }, uDecay: { value: 1 } },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
            fragmentShader: `
                uniform sampler2D uPrevious;
                uniform vec2 uShift;
                uniform float uDecay;
                varying vec2 vUv;
                void main()
                {
                    vec2 uv = vUv + uShift;
                    bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
                    gl_FragColor = vec4(inside ? texture2D(uPrevious, uv).r * uDecay : 0.0, 0.0, 0.0, 1.0);
                }`,
            depthTest: false,
            depthWrite: false
        })
        const fade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fadeMaterial)
        fade.frustumCulled = false
        this.fadeScene.add(fade)

        // pass 2: new footprints and drip spots (soft ellipses, the wettest wins)
        const plane = new THREE.PlaneGeometry(2, 2)
        this.stampGeometry = new THREE.InstancedBufferGeometry()
        this.stampGeometry.setAttribute('position', plane.getAttribute('position'))
        this.stampGeometry.setIndex(plane.getIndex())
        this.interleaved = new THREE.InstancedInterleavedBuffer(new Float32Array(MAX_STAMPS * 6), 6).setUsage(THREE.DynamicDrawUsage)
        this.stampGeometry.setAttribute('aStampA', new THREE.InterleavedBufferAttribute(this.interleaved, 3, 0))
        this.stampGeometry.setAttribute('aStampB', new THREE.InterleavedBufferAttribute(this.interleaved, 3, 3))
        this.stampGeometry.instanceCount = 0
        this.stampGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
        this.stampMaterial = new THREE.ShaderMaterial({
            uniforms: { uOrigin: { value: this.origin }, uHalfSize: { value: this.size * 0.5 } },
            vertexShader: `
                uniform vec2 uOrigin;
                uniform float uHalfSize;
                attribute vec3 aStampA;    // x, z, length
                attribute vec3 aStampB;    // width, angle, wetness
                varying vec2 vLocal;
                varying float vWetness;
                void main()
                {
                    vLocal = position.xy;
                    vWetness = aStampB.z;
                    float c = cos(aStampB.y), s = sin(aStampB.y);
                    vec2 local = vec2(position.x * aStampA.z, position.y * aStampB.x);
                    vec2 world = aStampA.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
                    gl_Position = vec4((world - uOrigin) / uHalfSize, 0.0, 1.0);
                }`,
            fragmentShader: `
                varying vec2 vLocal;
                varying float vWetness;
                void main()
                {
                    float d = length(vLocal);
                    gl_FragColor = vec4((1.0 - smoothstep(0.55, 1.0, d)) * vWetness, 0.0, 0.0, 1.0);
                }`,
            depthTest: false,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendEquation: THREE.MaxEquation,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneFactor
        })
        const stampMesh = new THREE.Mesh(this.stampGeometry, this.stampMaterial)
        stampMesh.frustumCulled = false
        this.stampScene.add(stampMesh)
    }

    private interleaved: THREE.InstancedInterleavedBuffer

    private stamp(x: number, z: number, length: number, width: number, angle: number, wetness: number) {
        if (this.pending.length / 6 < MAX_STAMPS)
            this.pending.push(x, z, length, width, angle, wetness)
    }

    update() {
        const player = this.state.player
        const p = player.position.current
        const dt = this.state.time.delta
        const texel = this.size / this.resolution

        // footprints: one per step, alternating feet, while wet feet walk on dry ground
        const ground = this.state.chunks.getElevationForPosition(p[0], p[2])
        const onLand = player.grounded && typeof ground === 'number' && ground > WATER_LEVEL + 0.05
        if (onLand && player.wetness > 0.04 && player.speed > 0.3) {
            this.stepDistance += player.speed * dt
            const stride = 0.45 + player.speed * 0.08
            if (this.stepDistance > stride) {
                this.stepDistance = 0
                this.foot = - this.foot
                const heading = Math.atan2(player.velocity[2], player.velocity[0])
                const sideX = - Math.sin(heading) * 0.13 * this.foot, sideZ = Math.cos(heading) * 0.13 * this.foot
                this.stamp(p[0] + sideX, p[2] + sideZ, 0.15, 0.07, heading, Math.min(1, player.wetness * 1.2))
            }
        }
        // where drips land
        for (const drip of this.splashes.landed)
            this.stamp(drip.x, drip.z, 0.05, 0.05, 0, 0.6)

        // scroll with the player in whole texels
        const originX = Math.round(p[0] / texel) * texel
        const originZ = Math.round(p[2] / texel) * texel
        this.fadeMaterial.uniforms.uShift.value.set((originX - this.origin.x) / this.size, (originZ - this.origin.y) / this.size)
        this.origin.set(originX, originZ)
        // drying: about half a minute (a little faster in sunshine)
        const sunUp = Math.max(0, this.state.sun.position.y)
        this.fadeMaterial.uniforms.uDecay.value = Math.exp(- dt / (32 - sunUp * 12))

        const renderer = this.view.renderer.instance
        const source = this.targets[this.current]
        const target = this.targets[1 - this.current]
        this.fadeMaterial.uniforms.uPrevious.value = source.texture
        renderer.setRenderTarget(target)
        renderer.clear()
        renderer.render(this.fadeScene, this.camera)
        const count = this.pending.length / 6
        if (count > 0) {
            ;(this.interleaved.array as Float32Array).set(this.pending)
            this.interleaved.needsUpdate = true
            this.stampGeometry.instanceCount = count
            // drawn over the faded wetness (autoClear is off: the composer manages clearing)
            renderer.render(this.stampScene, this.camera)
            this.pending.length = 0
        }
        renderer.setRenderTarget(null)
        this.current = 1 - this.current
        this.texture = target.texture
    }
}
