import * as THREE from 'three'

import View from './View'
import NoisesMaterial from './Materials/NoisesMaterial'
import Renderer from './Renderer'

export default class Noises {
    view: View
    renderer: Renderer
    scene: THREE.Scene
    customRender!: {
        scene: THREE.Scene
        camera: THREE.OrthographicCamera
    }
    material!: NoisesMaterial
    plane!: THREE.Mesh

    constructor() {
        this.view = View.getInstance()
        this.renderer = this.view.renderer
        this.scene = this.view.scene

        this.setCustomRender()
        this.setMaterial()
        this.setPlane()
    }

    setCustomRender() {
        this.customRender = {
            scene: new THREE.Scene(),
            camera: new THREE.OrthographicCamera(- 1, 1, 1, - 1, 0.1, 10)
        }
    }

    setMaterial() {
        this.material = new NoisesMaterial()
    }

    setPlane() {
        this.plane = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            this.material
        )
        this.plane.frustumCulled = false
        this.customRender.scene.add(this.plane)
    }

    private sharedTexture: THREE.Texture | null = null

    /** The tiling noise everything samples (terrain detail, grass colour, wind, water, clouds). */
    get texture() {
        if (!this.sharedTexture)
            this.sharedTexture = this.create(256, 256, true)
        return this.sharedTexture
    }

    /** Render any full-screen fragment shader (with vUv) into a tiling texture. */
    bake(fragmentShader: string, width: number, height: number, mipmaps = false) {
        const material = new THREE.ShaderMaterial({ vertexShader: this.material.vertexShader, fragmentShader })
        this.plane.material = material
        const texture = this.create(width, height, mipmaps)
        this.plane.material = this.material
        material.dispose()
        return texture
    }

    create(width: number, height: number, mipmaps = false) {
        const renderTarget = new THREE.WebGLRenderTarget(
            width,
            height,
            {
                generateMipmaps: mipmaps,
                minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
                wrapS: THREE.RepeatWrapping,
                wrapT: THREE.RepeatWrapping
            }
        )

        this.renderer.instance.setRenderTarget(renderTarget)
        this.renderer.instance.clear()
        this.renderer.instance.render(this.customRender.scene, this.customRender.camera)
        this.renderer.instance.setRenderTarget(null)

        return renderTarget.texture
    }
}
