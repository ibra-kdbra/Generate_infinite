import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import fragmentShader from './Materials/shaders/skyLut/fragment.glsl'

/**
 * The atmosphere (atmosphere.glsl) baked every frame into a small texture over the upper
 * hemisphere (128 × 64: azimuth × elevation, denser near the horizon). The sky backdrop, the
 * terrain haze (hundreds of thousands of vertices) and the water reflections look it up with
 * one fetch instead of ray-marching the atmosphere.
 */
export default class SkyLut {
    view: View
    state: State
    target: THREE.WebGLRenderTarget
    texture: THREE.Texture
    material: THREE.ShaderMaterial
    private scene = new THREE.Scene()
    private camera = new THREE.OrthographicCamera(- 1, 1, 1, - 1, 0, 1)

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()

        this.target = new THREE.WebGLRenderTarget(128, 64, {
            type: THREE.HalfFloatType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.RepeatWrapping,       // azimuth wraps around
            wrapT: THREE.ClampToEdgeWrapping,
            depthBuffer: false,
            generateMipmaps: false
        })
        this.texture = this.target.texture

        const sky = this.view.sky
        const uniforms: Record<string, THREE.IUniform> = {
            uSunPosition: sky.uniforms.uSunPosition,
            uSunIlluminance: { value: sky.sunIlluminance },
            uMoonIlluminance: { value: sky.moonIlluminance }
        }
        sky.uniforms.uSkyLut.value = this.texture
        this.material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
            fragmentShader,
            depthTest: false,
            depthWrite: false
        })
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
        quad.frustumCulled = false
        this.scene.add(quad)
    }

    update() {
        const renderer = this.view.renderer.instance
        renderer.setRenderTarget(this.target)
        renderer.clear()
        renderer.render(this.scene, this.camera)
        renderer.setRenderTarget(null)
    }
}
