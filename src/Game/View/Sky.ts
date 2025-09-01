import * as THREE from 'three'

import Game from '../Game'
import View from './View'
import State from '../State/State'
import Debug from '../Debug/Debug'
import SkyBackgroundMaterial from './Materials/SkyBackgroundMaterial'
import SkySphereMaterial from './Materials/SkySphereMaterial'
import StarsMaterial from './Materials/StarsMaterial'
import Viewport from '../State/Viewport'
import Renderer from './Renderer'

export default class Sky {
    game: Game
    view: View
    state: State
    debug: Debug
    viewport: Viewport
    renderer: Renderer
    scene: THREE.Scene
    outerDistance: number
    group: THREE.Group
    customRender!: {
        scene: THREE.Scene
        camera: THREE.PerspectiveCamera
        resolutionRatio: number
        renderTarget: THREE.WebGLRenderTarget
        texture: THREE.Texture
    }
    background!: {
        geometry: THREE.PlaneGeometry
        material: SkyBackgroundMaterial
        mesh: THREE.Mesh
    }
    sphere!: {
        widthSegments: number
        heightSegments: number
        update: () => void
        geometry: THREE.SphereGeometry
        material: SkySphereMaterial
        mesh: THREE.Mesh
    }
    sun!: {
        distance: number
        mesh: THREE.Mesh
    }
    stars!: {
        count: number
        distance: number
        update: () => void
        geometry: THREE.BufferGeometry
        material: StarsMaterial
        points: THREE.Points
    }

    constructor() {
        this.game = Game.getInstance()
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.debug = Debug.getInstance()

        this.viewport = this.state.viewport
        this.renderer = this.view.renderer
        this.scene = this.view.scene

        this.outerDistance = 1000

        this.group = new THREE.Group()
        this.scene.add(this.group)

        this.setCustomRender()
        this.setBackground()
        this.setSphere()
        this.setSun()
        this.setStars()
        this.setDebug()
    }

    setCustomRender() {
        this.customRender = {
            scene: new THREE.Scene(),
            camera: this.view.camera.instance.clone(),
            resolutionRatio: 0.1,
            renderTarget: new THREE.WebGLRenderTarget(
                this.viewport.width! * 0.1,
                this.viewport.height! * 0.1,
                {
                    generateMipmaps: false
                }
            ),
            texture: new THREE.Texture()
        }
        this.customRender.texture = this.customRender.renderTarget.texture
    }

    setBackground() {
        this.background = {
            geometry: new THREE.PlaneGeometry(2, 2),
            material: new SkyBackgroundMaterial(),
            mesh: new THREE.Mesh()
        }

        this.background.material.uniforms.uTexture.value = this.customRender.renderTarget.texture
        this.background.material.depthTest = false
        this.background.material.depthWrite = false

        this.background.mesh = new THREE.Mesh(this.background.geometry, this.background.material)
        this.background.mesh.frustumCulled = false

        this.group.add(this.background.mesh)
    }

    setSphere() {
        this.sphere = {
            widthSegments: 128,
            heightSegments: 64,
            update: () => {
                const geometry = new THREE.SphereGeometry(10, this.sphere.widthSegments, this.sphere.heightSegments)
                if (this.sphere.geometry) {
                    this.sphere.geometry.dispose()
                    this.sphere.mesh.geometry = this.sphere.geometry
                }

                this.sphere.geometry = geometry
            },
            material: new SkySphereMaterial(),
            geometry: new THREE.SphereGeometry(),
            mesh: new THREE.Mesh()
        }

        this.sphere.material.uniforms.uColorDayCycleLow.value.set('#f0fff9')
        this.sphere.material.uniforms.uColorDayCycleHigh.value.set('#2e89ff')
        this.sphere.material.uniforms.uColorNightLow.value.set('#004794')
        this.sphere.material.uniforms.uColorNightHigh.value.set('#001624')
        this.sphere.material.uniforms.uColorSun.value.set('#ff531a')
        this.sphere.material.uniforms.uColorDawn.value.set('#ff1900')
        this.sphere.material.uniforms.uDayCycleProgress.value = 0
        this.sphere.material.side = THREE.BackSide

        this.sphere.update()

        // this.sphere.material.wireframe = true
        this.sphere.mesh = new THREE.Mesh(this.sphere.geometry, this.sphere.material)
        this.customRender.scene.add(this.sphere.mesh)
    }

    setSun() {
        this.sun = {
            distance: this.outerDistance - 50,
            mesh: new THREE.Mesh()
        }

        const geometry = new THREE.CircleGeometry(0.02 * this.sun.distance, 32)
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff })
        this.sun.mesh = new THREE.Mesh(geometry, material)
        this.group.add(this.sun.mesh)
    }

    setStars() {
        this.stars = {
            count: 1000,
            distance: this.outerDistance,
            update: () => {
                // Create geometry
                const positionArray = new Float32Array(this.stars.count * 3)
                const sizeArray = new Float32Array(this.stars.count)
                const colorArray = new Float32Array(this.stars.count * 3)

                for (let i = 0; i < this.stars.count; i++) {
                    const iStride3 = i * 3

                    // Position
                    const position = new THREE.Vector3()
                    position.setFromSphericalCoords(this.stars.distance, Math.acos(Math.random()), 2 * Math.PI * Math.random())

                    positionArray[iStride3] = position.x
                    positionArray[iStride3 + 1] = position.y
                    positionArray[iStride3 + 2] = position.z

                    // Size
                    sizeArray[i] = Math.pow(Math.random() * 0.9, 10) + 0.1

                    // Color
                    const color = new THREE.Color()
                    color.setHSL(Math.random(), 1, 0.5 + Math.random() * 0.5)
                    colorArray[iStride3] = color.r
                    colorArray[iStride3 + 1] = color.g
                    colorArray[iStride3 + 2] = color.b
                }

                const geometry = new THREE.BufferGeometry()
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionArray, 3))
                geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizeArray, 1))
                geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colorArray, 3))

                // Dispose of old one
                if (this.stars.geometry) {
                    this.stars.geometry.dispose()
                    this.stars.points.geometry = this.stars.geometry
                }

                this.stars.geometry = geometry
            },
            geometry: new THREE.BufferGeometry(),
            material: new StarsMaterial(),
            points: new THREE.Points()
        }

        // Geometry
        this.stars.update()

        // Material
        // this.stars.material = new THREE.PointsMaterial({ size: 5, sizeAttenuation: false })
        this.stars.material = new StarsMaterial()
        this.stars.material.uniforms.uHeightFragments.value = this.viewport.height! * this.viewport.clampedPixelRatio!

        // Points
        this.stars.points = new THREE.Points(this.stars.geometry, this.stars.material)
        this.group.add(this.stars.points)
    }

    setDebug() {
        if (!this.debug.active)
            return

        // Sphere
        const sphereGeometryFolder = this.debug.ui.getFolder('view/sky/sphere/geometry')

        sphereGeometryFolder.add(this.sphere, 'widthSegments').min(4).max(512).step(1).name('widthSegments').onChange(() => { this.sphere.update() })
        sphereGeometryFolder.add(this.sphere, 'heightSegments').min(4).max(512).step(1).name('heightSegments').onChange(() => { this.sphere.update() })

        const sphereMaterialFolder = this.debug.ui.getFolder('view/sky/sphere/material')

        sphereMaterialFolder.add(this.sphere.material.uniforms.uAtmosphereElevation, 'value').min(0).max(5).step(0.01).name('uAtmosphereElevation')
        sphereMaterialFolder.add(this.sphere.material.uniforms.uAtmospherePower, 'value').min(0).max(20).step(1).name('uAtmospherePower')
        sphereMaterialFolder.addColor(this.sphere.material.uniforms.uColorDayCycleLow, 'value').name('uColorDayCycleLow')
        sphereMaterialFolder.addColor(this.sphere.material.uniforms.uColorDayCycleHigh, 'value').name('uColorDayCycleHigh')
        sphereMaterialFolder.addColor(this.sphere.material.uniforms.uColorNightLow, 'value').name('uColorNightLow')
        sphereMaterialFolder.addColor(this.sphere.material.uniforms.uColorNightHigh, 'value').name('uColorNightHigh')
        sphereMaterialFolder.add(this.sphere.material.uniforms.uDawnAngleAmplitude, 'value').min(0).max(1).step(0.001).name('uDawnAngleAmplitude')
        sphereMaterialFolder.add(this.sphere.material.uniforms.uDawnElevationAmplitude, 'value').min(0).max(1).step(0.01).name('uDawnElevationAmplitude')
        sphereMaterialFolder.addColor(this.sphere.material.uniforms.uColorDawn, 'value').name('uColorDawn')
        sphereMaterialFolder.add(this.sphere.material.uniforms.uSunAmplitude, 'value').min(0).max(3).step(0.01).name('uSunAmplitude')
        sphereMaterialFolder.add(this.sphere.material.uniforms.uSunMultiplier, 'value').min(0).max(1).step(0.01).name('uSunMultiplier')
        sphereMaterialFolder.addColor(this.sphere.material.uniforms.uColorSun, 'value').name('uColorSun')

        // Stars
        const starsFolder = this.debug.ui.getFolder('view/sky/stars')

        starsFolder.add(this.stars, 'count').min(100).max(50000).step(100).name('count').onChange(() => { this.stars.update() })
        starsFolder.add(this.stars.material.uniforms.uSize, 'value').min(0).max(1).step(0.0001).name('uSize')
        starsFolder.add(this.stars.material.uniforms.uBrightness, 'value').min(0).max(1).step(0.001).name('uBrightness')
    }

    update() {
        const dayState = this.state.day
        const sunState = this.state.sun
        const playerState = this.state.player

        // Group
        this.group.position.set(
            playerState.position.current[0],
            playerState.position.current[1],
            playerState.position.current[2]
        )

        // Sphere
        this.sphere.material.uniforms.uSunPosition.value.set(sunState.position.x, sunState.position.y, sunState.position.z)
        this.sphere.material.uniforms.uDayCycleProgress.value = dayState.progress

        // Sun
        this.sun.mesh.position.set(
            sunState.position.x * this.sun.distance,
            sunState.position.y * this.sun.distance,
            sunState.position.z * this.sun.distance
        )
        this.sun.mesh.lookAt(
            playerState.position.current[0],
            playerState.position.current[1],
            playerState.position.current[2]
        )

        // Stars
        this.stars.material.uniforms.uSunPosition.value.set(sunState.position.x, sunState.position.y, sunState.position.z)
        this.stars.material.uniforms.uHeightFragments.value = this.viewport.height! * this.viewport.clampedPixelRatio!

        // Render in render target
        this.customRender.camera.quaternion.copy(this.view.camera.instance.quaternion)
        this.renderer.instance.setRenderTarget(this.customRender.renderTarget)
        this.renderer.instance.render(this.customRender.scene, this.customRender.camera)
        this.renderer.instance.setRenderTarget(null)
    }

    resize() {
        this.customRender.renderTarget.width = this.viewport.width! * this.customRender.resolutionRatio
        this.customRender.renderTarget.height = this.viewport.height! * this.customRender.resolutionRatio
    }
}
