import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import { PLANT } from '../State/Vegetation'

/**
 * Shadows of trees, bushes and boulders on the ground: a top-down texture around the
 * player (384 m) in which every plant draws a soft blob, cast away from the sun and
 * stretched as the sun gets lower. The terrain and the grass dim direct sunlight with it.
 * Redrawn when the plants change, the player has moved a way, or the sun has moved.
 */
export default class TreeShade {
    view: View
    state: State
    size = 384
    resolution = 512
    origin = new THREE.Vector2(Infinity, Infinity)
    target: THREE.WebGLRenderTarget
    texture: THREE.Texture

    private scene = new THREE.Scene()
    private camera = new THREE.OrthographicCamera(- 1, 1, 1, - 1, 0, 1)
    private geometry: THREE.InstancedBufferGeometry
    private centers: THREE.InstancedBufferAttribute
    private shapes: THREE.InstancedBufferAttribute
    private material: THREE.ShaderMaterial
    private version = -1
    private sunAtDraw = new THREE.Vector3()

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()

        this.target = new THREE.WebGLRenderTarget(this.resolution, this.resolution, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: false,
            generateMipmaps: false
        })
        this.texture = this.target.texture

        const plane = new THREE.PlaneGeometry(2, 2)
        this.geometry = new THREE.InstancedBufferGeometry()
        this.geometry.setAttribute('position', plane.getAttribute('position'))
        this.geometry.setAttribute('uv', plane.getAttribute('uv'))
        this.geometry.setIndex(plane.getIndex())
        this.centers = new THREE.InstancedBufferAttribute(new Float32Array(4096 * 2), 2)
        this.shapes = new THREE.InstancedBufferAttribute(new Float32Array(4096 * 3), 3)
        this.geometry.setAttribute('aCenter', this.centers)
        this.geometry.setAttribute('aShape', this.shapes)
        this.geometry.instanceCount = 0
        this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uOrigin: { value: new THREE.Vector2() },
                uHalfSize: { value: this.size * 0.5 },
                uSunDirection: { value: new THREE.Vector2(1, 0) },   // horizontal, toward where shadows fall
                uStretch: { value: 1 }
            },
            vertexShader: `
                uniform vec2 uOrigin;
                uniform float uHalfSize;
                uniform vec2 uSunDirection;
                uniform float uStretch;
                attribute vec2 aCenter;
                attribute vec3 aShape;     // radius, strength, offset along the shadow
                varying vec2 vLocal;
                varying float vStrength;
                void main()
                {
                    vLocal = position.xy;
                    vStrength = aShape.y;
                    vec2 along = uSunDirection;
                    vec2 across = vec2(- along.y, along.x);
                    vec2 local = along * position.x * aShape.x * uStretch + across * position.y * aShape.x;
                    vec2 world = aCenter + along * aShape.z + local;
                    gl_Position = vec4((world - uOrigin) / uHalfSize, 0.0, 1.0);
                }`,
            fragmentShader: `
                varying vec2 vLocal;
                varying float vStrength;
                void main()
                {
                    float d = length(vLocal);
                    gl_FragColor = vec4(vec3((1.0 - smoothstep(0.35, 1.0, d)) * vStrength), 1.0);
                }`,
            depthTest: false,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendEquation: THREE.MaxEquation,      // overlapping crowns don't darken twice
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneFactor
        })
        const mesh = new THREE.Mesh(this.geometry, this.material)
        mesh.frustumCulled = false
        this.scene.add(mesh)
    }

    private draw() {
        const p = this.state.player.position.current
        const texel = this.size / this.resolution
        this.origin.set(Math.round(p[0] / texel) * texel, Math.round(p[2] / texel) * texel)

        const sun = this.state.sun.position
        const elevation = Math.max(0.12, Math.asin(Math.min(1, Math.max(- 1, sun.y))))
        const horizontal = Math.hypot(sun.x, sun.z) || 1
        // shadows fall away from the sun, longer as it gets lower
        this.material.uniforms.uSunDirection.value.set(- sun.x / horizontal, - sun.z / horizontal)
        const reach = 1 / Math.tan(elevation)
        this.material.uniforms.uStretch.value = Math.min(3, 1 / Math.sin(elevation) * 0.8)
        this.material.uniforms.uOrigin.value.copy(this.origin)

        const half = this.size * 0.5
        const centers = this.centers.array as Float32Array
        const shapes = this.shapes.array as Float32Array
        let count = 0
        for (const cell of this.state.vegetation.cells.values()) {
            for (const plant of cell.plants) {
                if (Math.abs(plant.x - this.origin.x) > half + 20 || Math.abs(plant.z - this.origin.y) > half + 20 || count >= 4096)
                    continue
                let radius = 0, strength = 0, height = 0
                if (plant.kind === PLANT.BROADLEAF) { radius = plant.scale * 0.34; strength = 0.65; height = plant.scale * 0.6 }
                else if (plant.kind === PLANT.CONIFER) { radius = plant.scale * 0.24; strength = 0.7; height = plant.scale * 0.45 }
                else if (plant.kind === PLANT.BUSH) { radius = plant.scale * 0.5; strength = 0.45; height = plant.scale * 0.35 }
                else if (plant.scale > 0.8) { radius = plant.scale * 0.65; strength = 0.45; height = plant.scale * 0.25 }
                else continue
                centers[count * 2] = plant.x
                centers[count * 2 + 1] = plant.z
                shapes[count * 3] = radius
                shapes[count * 3 + 1] = strength
                shapes[count * 3 + 2] = Math.min(height * reach, 40)
                count++
            }
        }
        this.centers.needsUpdate = true
        this.shapes.needsUpdate = true
        this.geometry.instanceCount = count

        const renderer = this.view.renderer.instance
        renderer.setRenderTarget(this.target)
        renderer.setClearColor(0x000000, 1)
        renderer.clear()
        renderer.render(this.scene, this.camera)
        renderer.setRenderTarget(null)
        renderer.setClearColor(this.view.renderer.clearColor, 1)

        this.version = this.state.vegetation.version
        this.sunAtDraw.set(sun.x, sun.y, sun.z)
    }

    update() {
        const p = this.state.player.position.current
        const sun = this.state.sun.position
        const moved = Math.hypot(p[0] - this.origin.x, p[2] - this.origin.y) > 32
        const sunMoved = Math.abs(sun.x - this.sunAtDraw.x) + Math.abs(sun.y - this.sunAtDraw.y) + Math.abs(sun.z - this.sunAtDraw.z) > 0.01
        if (moved || sunMoved || this.version !== this.state.vegetation.version)
            this.draw()
    }
}
