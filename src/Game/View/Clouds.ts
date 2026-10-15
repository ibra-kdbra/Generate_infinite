import * as THREE from 'three'

import fullscreenVertex from './Materials/shaders/clouds/fullscreen.glsl'
import shapeShader from './Materials/shaders/clouds/shape.glsl'
import detailShader from './Materials/shaders/clouds/detail.glsl'
import weatherShader from './Materials/shaders/clouds/weather.glsl'
import marchShader from './Materials/shaders/clouds/march.glsl'
import resolveShader from './Materials/shaders/clouds/resolve.glsl'

/**
 * The cloud layer. Its textures are generated once on the GPU: the weather map (where clouds
 * form, how tall), a tiling 128³ shape noise and a 32³ detail noise. Every frame the clouds
 * are ray-marched at a fraction of the screen resolution (march.glsl) and blended into the
 * previous frames (resolve.glsl), which removes the noise of the jittered march without the
 * smearing; the sky backdrop draws the result over the atmosphere.
 */
export default class Clouds {
    renderer: THREE.WebGLRenderer
    weather: THREE.WebGLRenderTarget
    shape: THREE.WebGL3DRenderTarget
    detail: THREE.WebGL3DRenderTarget
    marchMaterial: THREE.ShaderMaterial
    resolveMaterial: THREE.ShaderMaterial
    texture: THREE.Texture
    resolution = new THREE.Vector2(1, 1)

    private march: THREE.WebGLRenderTarget
    private history: THREE.WebGLRenderTarget[]
    private current = 0
    private scene = new THREE.Scene()
    private quad: THREE.Mesh
    private camera = new THREE.OrthographicCamera(- 1, 1, 1, - 1, 0, 1)
    private previousViewProjection = new THREE.Matrix4()
    private historyValid = false

    constructor(renderer: THREE.WebGLRenderer, sharedUniforms: Record<string, THREE.IUniform>) {
        this.renderer = renderer
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
        this.quad.frustumCulled = false
        this.scene.add(this.quad)

        // ── textures, generated once ──
        this.weather = new THREE.WebGLRenderTarget(512, 512, {
            type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false,
            minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping
        })
        this.renderPass(new THREE.ShaderMaterial({ vertexShader: fullscreenVertex, fragmentShader: weatherShader }), this.weather)

        this.shape = this.volume(128, shapeShader)
        this.detail = this.volume(32, detailShader)

        // ── per frame ──
        const options = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
        this.march = new THREE.WebGLRenderTarget(1, 1, options)
        this.history = [new THREE.WebGLRenderTarget(1, 1, options), new THREE.WebGLRenderTarget(1, 1, options)]
        this.texture = this.history[0].texture

        this.marchMaterial = new THREE.ShaderMaterial({
            uniforms: {
                ...sharedUniforms,
                uInverseViewProjection: { value: new THREE.Matrix4() },
                uCameraPosition: { value: new THREE.Vector3() },
                uCloudShape: { value: this.shape.texture },
                uCloudDetail: { value: this.detail.texture },
                uSteps: { value: 48 },
                uLightSteps: { value: 6 },
                uFrame: { value: 0 }
            },
            vertexShader: fullscreenVertex,
            fragmentShader: marchShader,
            depthTest: false,
            depthWrite: false
        })
        this.resolveMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uCurrent: { value: this.march.texture },
                uHistory: { value: null },
                uInverseViewProjection: this.marchMaterial.uniforms.uInverseViewProjection,
                uPreviousViewProjection: { value: new THREE.Matrix4() },
                uHistoryValid: { value: 0 },
                uTexel: { value: new THREE.Vector2() }
            },
            vertexShader: fullscreenVertex,
            fragmentShader: resolveShader,
            depthTest: false,
            depthWrite: false
        })
    }

    private renderPass(material: THREE.Material, target: THREE.WebGLRenderTarget, layer = 0) {
        this.quad.material = material
        this.renderer.setRenderTarget(target, layer)
        this.renderer.render(this.scene, this.camera)
        this.renderer.setRenderTarget(null)
    }

    /** A tiling 3D noise texture, one slice per draw. */
    private volume(size: number, fragmentShader: string) {
        const target = new THREE.WebGL3DRenderTarget(size, size, size, { depthBuffer: false })
        const texture = target.texture
        texture.format = THREE.RGBAFormat
        texture.type = THREE.UnsignedByteType
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping
        texture.generateMipmaps = false
        const material = new THREE.ShaderMaterial({
            uniforms: { uSlice: { value: 0 } },
            vertexShader: fullscreenVertex,
            fragmentShader,
            depthTest: false,
            depthWrite: false
        })
        for (let slice = 0; slice < size; slice++) {
            material.uniforms.uSlice.value = (slice + 0.5) / size
            this.renderPass(material, target as unknown as THREE.WebGLRenderTarget, slice)
        }
        material.dispose()
        return target
    }

    setSize(width: number, height: number) {
        width = Math.max(1, Math.round(width))
        height = Math.max(1, Math.round(height))
        if (this.resolution.x === width && this.resolution.y === height)
            return
        this.resolution.set(width, height)
        this.march.setSize(width, height)
        for (const target of this.history)
            target.setSize(width, height)
        this.resolveMaterial.uniforms.uTexel.value.set(1 / width, 1 / height)
        this.historyValid = false
    }

    /** Marches and resolves this frame's clouds for a camera at the origin with this rotation and projection. */
    update(camera: THREE.Camera, cameraPosition: THREE.Vector3) {
        const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        const uniforms = this.marchMaterial.uniforms
        uniforms.uInverseViewProjection.value.copy(viewProjection).invert()
        uniforms.uCameraPosition.value.copy(cameraPosition)
        uniforms.uFrame.value = (uniforms.uFrame.value + 1) % 1024

        this.renderPass(this.marchMaterial, this.march)

        const source = this.history[this.current]
        const target = this.history[1 - this.current]
        this.resolveMaterial.uniforms.uHistory.value = source.texture
        this.resolveMaterial.uniforms.uPreviousViewProjection.value.copy(this.previousViewProjection)
        this.resolveMaterial.uniforms.uHistoryValid.value = this.historyValid ? 1 : 0
        this.renderPass(this.resolveMaterial, target)
        this.current = 1 - this.current
        this.texture = target.texture
        this.previousViewProjection.copy(viewProjection)
        this.historyValid = true
    }
}
