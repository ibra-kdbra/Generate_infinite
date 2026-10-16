import * as THREE from 'three'

import View from './View'
import State from '../State/State'

/**
 * Where the grass has been trodden: a small texture around the player (64 m, 0.5 m per
 * texel) that the grass vertex shader reads.
 *   rg: direction the blades were pushed (they lie down the way you walked)
 *   b:  how flattened they are (0..1)
 *   a:  how much they've been cut short (sickle, sword, hoe; grows back over a minute or so)
 * Every frame the old values fade (trodden grass stands back up over a few seconds) and the
 * player's feet press a new spot, but only while they touch the ground: jumping presses
 * nothing, landing flattens a wider ring. The texture scrolls with the player in whole
 * texels so nothing smears.
 */
export default class GrassTrail {
    view: View
    state: State
    size = 64                    // metres covered
    resolution = 128
    origin = new THREE.Vector2() // world xz of the texture centre (snapped to texels)
    texture: THREE.Texture

    private targets: THREE.WebGLRenderTarget[]
    private current = 0
    private scene = new THREE.Scene()
    private camera = new THREE.OrthographicCamera(- 1, 1, 1, - 1, 0, 1)
    private material: THREE.ShaderMaterial
    private wasGrounded = true
    private fallSpeed = 0
    private pendingCut: { x: number, z: number, radius: number, strength: number } | null = null

    /** Cut the grass short in a disc (applied on the next update). */
    cut(x: number, z: number, radius: number, strength = 0.85) {
        this.pendingCut = { x, z, radius, strength }
    }

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()

        const options = {
            type: THREE.HalfFloatType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: false,
            generateMipmaps: false
        }
        this.targets = [
            new THREE.WebGLRenderTarget(this.resolution, this.resolution, options),
            new THREE.WebGLRenderTarget(this.resolution, this.resolution, options)
        ]
        this.texture = this.targets[0].texture

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uPrevious: { value: null },
                uShift: { value: new THREE.Vector2() },
                uDecay: { value: 1 },
                uStampCenter: { value: new THREE.Vector2(0.5, 0.5) },
                uStampRadius: { value: 0.01 },
                uStampStrength: { value: 0 },
                uStampDirection: { value: new THREE.Vector2() },
                uStampRadial: { value: 0 },
                uCutDecay: { value: 1 },
                uCutCenter: { value: new THREE.Vector2(0.5, 0.5) },
                uCutRadius: { value: 0.01 },
                uCutStrength: { value: 0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
            fragmentShader: `
                uniform sampler2D uPrevious;
                uniform vec2 uShift;
                uniform float uDecay;
                uniform vec2 uStampCenter;
                uniform float uStampRadius;
                uniform float uStampStrength;
                uniform vec2 uStampDirection;
                uniform float uStampRadial;
                uniform float uCutDecay;
                uniform vec2 uCutCenter;
                uniform float uCutRadius;
                uniform float uCutStrength;
                varying vec2 vUv;
                void main()
                {
                    vec2 previousUv = vUv + uShift;
                    bool inside = all(greaterThanEqual(previousUv, vec2(0.0))) && all(lessThanEqual(previousUv, vec2(1.0)));
                    vec4 previous = inside ? texture2D(uPrevious, previousUv) : vec4(0.0);
                    previous = vec4(previous.rgb * uDecay, previous.a * uCutDecay);

                    vec2 away = vUv - uStampCenter;
                    float d = length(away) / uStampRadius;
                    float stamp = (1.0 - smoothstep(0.45, 1.0, d)) * uStampStrength;
                    vec2 direction = mix(uStampDirection, away / max(length(away), 1e-5), uStampRadial);

                    float pressure = max(previous.b, stamp);
                    vec2 bend = mix(previous.rg, direction, clamp(stamp * 1.5, 0.0, 1.0));
                    float cut = max(previous.a, (1.0 - smoothstep(0.6, 1.0, length(vUv - uCutCenter) / uCutRadius)) * uCutStrength);
                    gl_FragColor = vec4(bend, pressure, cut);
                }`,
            depthTest: false,
            depthWrite: false
        })
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
        quad.frustumCulled = false
        this.scene.add(quad)
    }

    update() {
        const player = this.state.player
        const p = player.position.current
        const dt = this.state.time.delta
        const uniforms = this.material.uniforms
        const texel = this.size / this.resolution

        // scroll with the player in whole texels
        const originX = Math.round(p[0] / texel) * texel
        const originZ = Math.round(p[2] / texel) * texel
        uniforms.uShift.value.set((originX - this.origin.x) / this.size, (originZ - this.origin.y) / this.size)
        this.origin.set(originX, originZ)
        uniforms.uDecay.value = Math.exp(- dt / 3.5)

        // feet press only while touching the ground
        const ground = this.state.chunks.getElevationForPosition(p[0], p[2])
        const lift = typeof ground === 'number' ? p[1] - ground : 0
        const touching = player.grounded && lift < 0.3 && player.movementState !== 'swim'
        let strength = 0, radius = 0.5, radial = 0
        if (!player.grounded)
            this.fallSpeed = Math.max(this.fallSpeed, - player.velocity[1])
        if (touching && !this.wasGrounded && this.fallSpeed > 4) {
            // landing: flatten a ring around the feet
            strength = Math.min(1, 0.45 + this.fallSpeed * 0.05)
            radius = 0.9 + Math.min(0.8, this.fallSpeed * 0.05)
            radial = 1
        }
        else if (touching) {
            strength = Math.min(0.85, 0.4 + player.speed * 0.06)
        }
        if (player.grounded)
            this.fallSpeed = 0
        this.wasGrounded = touching

        const speed = Math.hypot(player.velocity[0], player.velocity[2])
        if (speed > 0.2)
            uniforms.uStampDirection.value.set(player.velocity[0] / speed, player.velocity[2] / speed)
        uniforms.uStampCenter.value.set((p[0] - originX) / this.size + 0.5, (p[2] - originZ) / this.size + 0.5)
        uniforms.uStampRadius.value = radius / this.size
        uniforms.uStampStrength.value = strength
        uniforms.uStampRadial.value = radial
        uniforms.uCutDecay.value = Math.exp(- dt / 70)
        const cut = this.pendingCut
        uniforms.uCutStrength.value = cut ? cut.strength : 0
        if (cut) {
            uniforms.uCutCenter.value.set((cut.x - originX) / this.size + 0.5, (cut.z - originZ) / this.size + 0.5)
            uniforms.uCutRadius.value = cut.radius / this.size
            this.pendingCut = null
        }

        // ping-pong
        const source = this.targets[this.current]
        const target = this.targets[1 - this.current]
        uniforms.uPrevious.value = source.texture
        const renderer = this.view.renderer.instance
        renderer.setRenderTarget(target)
        renderer.clear()
        renderer.render(this.scene, this.camera)
        renderer.setRenderTarget(null)
        this.current = 1 - this.current
        this.texture = target.texture
    }
}
