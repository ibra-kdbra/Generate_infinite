import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Viewport from '../State/Viewport'
import Renderer from './Renderer'
import Settings, { Quality } from '../Settings'
import Clouds from './Clouds'
import { computeLight, SUN_ILLUMINANCE, MOON_ILLUMINANCE, AtmosphereLight } from './Atmosphere'
import backgroundVertex from './Materials/shaders/skyBackground/vertex.glsl'
import backgroundFragment from './Materials/shaders/skyBackground/fragment.glsl'
import starsVertex from './Materials/shaders/stars/vertex.glsl'
import starsFragment from './Materials/shaders/stars/fragment.glsl'

// Volumetric cloud ray-march steps (0 = one flat layer), light steps and resolution (of the
// screen's CSS size), by quality
const CLOUDS: Record<Quality, { steps: number, lightSteps: number, resolution: number }> = {
    low: { steps: 0, lightSteps: 0, resolution: 0.25 },
    medium: { steps: 40, lightSteps: 4, resolution: 0.4 },
    high: { steps: 56, lightSteps: 5, resolution: 0.5 },
    ultra: { steps: 80, lightSteps: 6, resolution: 0.6 }
}

// Uniforms shared by reference with every material lit by the sky or shadowed by the clouds
// (terrain, grass, trees, rocks, water): the atmosphere's light and the cloud layer
export const LIGHT_UNIFORMS = ['uSunLight', 'uMoonLight', 'uSkyLight', 'uGroundLight', 'uHazeRange']
export const CLOUD_UNIFORMS = ['uCloudWeather', 'uCloudOffset', 'uCloudCover', 'uCloudTime']

const WIND = new THREE.Vector2(7, 3.5)       // m/s at the clouds' height

/**
 * The sky: the atmosphere (Atmosphere.ts on the CPU for the light, atmosphere.glsl in the
 * sky texture), the clouds (Clouds.ts), the backdrop drawn behind everything, the stars.
 */
export default class Sky {
    view: View
    state: State
    viewport: Viewport
    renderer: Renderer
    scene: THREE.Scene
    group: THREE.Group
    uniforms: Record<string, THREE.IUniform>
    light!: AtmosphereLight
    clouds: Clouds
    cloudCoverOverride: number | null = null      // developer panel
    resolutionRatio = 0.4
    background: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
    stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
    private skyCamera = new THREE.PerspectiveCamera()
    private lastSun = new THREE.Vector3(0, - 2, 0)

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.viewport = this.state.viewport
        this.renderer = this.view.renderer
        this.scene = this.view.scene

        this.group = new THREE.Group()
        this.scene.add(this.group)

        this.uniforms = {
            uSunLight: { value: new THREE.Vector3() },
            uSunLightClouds: { value: new THREE.Vector3() },
            uMoonLight: { value: new THREE.Vector3() },
            uSkyLight: { value: new THREE.Vector3() },
            uGroundLight: { value: new THREE.Vector3() },
            uHazeRange: { value: 2048 },        // where the terrain ends (getAerialFog.glsl)
            uCloudWeather: { value: null },
            uCloudOffset: { value: new THREE.Vector2() },
            uCloudCover: { value: 0.45 },
            uCloudTime: { value: 0 },
            uSunPosition: { value: new THREE.Vector3(0, 1, 0) },
            uSkyLut: { value: null }       // set by SkyLut
        }

        this.clouds = new Clouds(this.renderer.instance, this.uniforms)
        this.uniforms.uCloudWeather.value = this.clouds.weather.texture

        this.background = this.createBackground()
        this.stars = this.createStars()

        Settings.getInstance().events.on('change:quality', (quality: Quality) => this.applyQuality(quality))
        this.applyQuality(Settings.getInstance().get('quality'))
        this.updateLight()
    }

    private applyQuality(quality: Quality) {
        const preset = CLOUDS[quality]
        this.resolutionRatio = preset.resolution
        this.clouds.marchMaterial.uniforms.uSteps.value = preset.steps
        this.clouds.marchMaterial.uniforms.uLightSteps.value = preset.lightSteps
        this.resize()
    }

    private createBackground() {
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uClouds: { value: null },
                uInverseViewProjection: { value: new THREE.Matrix4() },
                uSunPosition: this.uniforms.uSunPosition,
                uSunLight: this.uniforms.uSunLight,
                uSkyLut: this.uniforms.uSkyLut,
                uNoiseTexture: { value: this.view.noises.texture }
            },
            vertexShader: backgroundVertex,
            fragmentShader: backgroundFragment,
            depthTest: false,
            depthWrite: false
        })
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
        mesh.frustumCulled = false
        mesh.renderOrder = - 10   // ignores depth: must be drawn before anything else
        this.group.add(mesh)
        return mesh
    }

    private createStars() {
        const count = 1600
        const positions = new Float32Array(count * 3)
        const sizes = new Float32Array(count)
        const colors = new Float32Array(count * 3)
        const color = new THREE.Color()
        for (let i = 0; i < count; i++) {
            const position = new THREE.Vector3().setFromSphericalCoords(1000, Math.acos(Math.random()), 2 * Math.PI * Math.random())
            positions.set([position.x, position.y, position.z], i * 3)
            sizes[i] = Math.pow(Math.random() * 0.9, 10) + 0.1
            // mostly white, some bluish, some warm
            color.setHSL(Math.random() < 0.5 ? 0.6 : 0.08, Math.random() * 0.5, 0.75 + Math.random() * 0.25)
            colors.set([color.r, color.g, color.b], i * 3)
        }
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))
        geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3))
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uSunPosition: this.uniforms.uSunPosition,
                uSize: { value: 0.01 },
                uHeightFragments: { value: 1 },
                uClouds: { value: null },
                uResolution: { value: new THREE.Vector2(1, 1) }
            },
            vertexShader: starsVertex,
            fragmentShader: starsFragment,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
        const points = new THREE.Points(geometry, material)
        points.frustumCulled = false
        this.group.add(points)
        return points
    }

    /** The atmosphere's light, recomputed when the sun has moved (it moves slowly). */
    private updateLight() {
        const sun = this.state.sun.position
        const direction = new THREE.Vector3(sun.x, sun.y, sun.z).normalize()
        if (this.light && direction.distanceToSquared(this.lastSun) < 1e-6)
            return
        this.lastSun.copy(direction)
        this.light = computeLight([direction.x, direction.y, direction.z])
        this.uniforms.uSunLight.value.fromArray(this.light.sun)
        this.uniforms.uSunLightClouds.value.fromArray(this.light.sunClouds)
        this.uniforms.uMoonLight.value.fromArray(this.light.moon)
        this.uniforms.uSkyLight.value.fromArray(this.light.sky)
        this.uniforms.uGroundLight.value.fromArray(this.light.ground)
    }

    get sunIlluminance() { return SUN_ILLUMINANCE }
    get moonIlluminance() { return MOON_ILLUMINANCE }

    update() {
        const player = this.state.player.position.current
        const sun = this.state.sun.position
        const dt = this.state.time.delta

        this.group.position.set(player[0], player[1], player[2])
        this.uniforms.uSunPosition.value.set(sun.x, sun.y, sun.z)
        this.uniforms.uHazeRange.value = this.state.chunks.reach
        this.updateLight()

        // the wind carries the clouds; the cover changes slowly like weather
        const t = this.state.time.elapsed
        this.uniforms.uCloudTime.value = t
        this.uniforms.uCloudOffset.value.addScaledVector(WIND, Math.min(dt, 0.1))
        this.uniforms.uCloudCover.value = this.cloudCoverOverride ?? THREE.MathUtils.clamp(0.42 + 0.22 * Math.sin(t * 0.0021) + 0.1 * Math.sin(t * 0.0067 + 1.3), 0.12, 0.85)

        // clouds: rendered for a camera at the origin with the view's rotation and projection
        // (the field of view changes when sprinting)
        const main = this.view.camera.instance
        const skyCamera = this.skyCamera
        skyCamera.position.set(0, 0, 0)
        skyCamera.quaternion.copy(main.quaternion)
        skyCamera.updateMatrixWorld()
        skyCamera.projectionMatrix.copy(main.projectionMatrix)
        skyCamera.projectionMatrixInverse.copy(main.projectionMatrixInverse)
        this.clouds.update(skyCamera, main.position)

        const inverse = new THREE.Matrix4().multiplyMatrices(skyCamera.projectionMatrix, skyCamera.matrixWorldInverse).invert()
        this.background.material.uniforms.uInverseViewProjection.value.copy(inverse)
        this.background.material.uniforms.uClouds.value = this.clouds.texture

        const stars = this.stars.material.uniforms
        stars.uClouds.value = this.clouds.texture
        const size = this.renderer.instance.getDrawingBufferSize(new THREE.Vector2())
        stars.uResolution.value.copy(size)
        stars.uHeightFragments.value = size.y
    }

    resize() {
        this.clouds.setSize(this.viewport.width! * this.resolutionRatio, this.viewport.height! * this.resolutionRatio)
    }
}
