import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Viewport from '../State/Viewport'
import Renderer from './Renderer'
import Settings, { Quality, Weather } from '../Settings'
import Clouds from './Clouds'
import { computeLight, SUN_ILLUMINANCE, MOON_ILLUMINANCE, AtmosphereLight } from './Atmosphere'
import backgroundVertex from './Materials/shaders/skyBackground/vertex.glsl'
import backgroundFragment from './Materials/shaders/skyBackground/fragment.glsl'
import starsVertex from './Materials/shaders/stars/vertex.glsl'
import starsFragment from './Materials/shaders/stars/fragment.glsl'

// Volumetric cloud ray-march steps (0 = one flat layer), light steps and resolution (of the
// screen's CSS size; a quarter of those pixels is marched each frame), by quality
const CLOUDS: Record<Quality, { steps: number, lightSteps: number, resolution: number }> = {
    low: { steps: 0, lightSteps: 0, resolution: 0.25 },
    medium: { steps: 36, lightSteps: 4, resolution: 0.5 },
    high: { steps: 48, lightSteps: 5, resolution: 0.6 },
    ultra: { steps: 64, lightSteps: 6, resolution: 0.72 }
}

// Uniforms shared by reference with every material lit by the sky or shadowed by the clouds
// (terrain, grass, trees, rocks, water): the atmosphere's light and the cloud layer
export const LIGHT_UNIFORMS = ['uSunLight', 'uMoonLight', 'uSkyLight', 'uGroundLight', 'uHazeRange', 'uTorch', 'uTorchColor']
export const CLOUD_UNIFORMS = ['uCloudWeather', 'uCloudOffset', 'uCloudCover', 'uCloudTime']

// The cloud cover each kind of weather settles to (auto: it drifts on its own)
const COVER: Record<Exclude<Weather, 'auto'>, number> = { clear: 0.14, cloudy: 0.5, overcast: 0.82, rain: 0.8, storm: 0.93 }

/** Where the sun is at this point of the day (State/Sun's path), for the stars' rotation. */
function sunAt(progress: number) {
    const angle = - (progress + 0.25) * Math.PI * 2
    const phi = (Math.sin(angle) * 0.3 + 0.5) * Math.PI
    const theta = (Math.cos(angle) * 0.3 + 0.5) * Math.PI
    return new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta))
}

/**
 * The sky: the atmosphere (Atmosphere.ts on the CPU for the light, atmosphere.glsl in the
 * sky texture), the clouds (Clouds.ts) carried by the wind, a high veil of wispy cirrus, the
 * backdrop drawn behind everything (sun, moon, Milky Way), and the stars turning about the
 * pole through the night. The weather sets the cloud cover (and with it rain and storms,
 * Weather.ts); everything here is tunable from the menu's Sky page.
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
    resolutionRatio = 0.4
    background: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
    stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>

    // ── tunable (menu: Sky) ──
    cloudCoverOverride: number | null = null       // a fixed cover instead of the weather's
    wind = { speed: 18, direction: 30 }            // m/s at the clouds' height, degrees (blowing toward)
    cloudEvolution = 1                             // how fast the cloud shapes grow and change
    cirrus = 0.5                                   // the high wispy veil, 0 none .. 1 a lot
    starBrightness = 1
    milkyWay = 1
    sunSize = 1
    cover = 0.45                                   // the cloud cover now (0 clear .. 1 overcast)

    private skyCamera = new THREE.PerspectiveCamera()
    private lastSun = new THREE.Vector3(0, - 2, 0)
    private poleAxis = new THREE.Vector3(0, 1, 0)
    private poleSign = 1
    private settings = Settings.getInstance()

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
            uTorch: { value: new THREE.Vector4(0, 0, 0, 0) },      // the player's torch (Tools.ts)
            uTorchColor: { value: new THREE.Vector3(1, 0.55, 0.22) },
            uCloudWeather: { value: null },
            uCloudOffset: { value: new THREE.Vector2() },
            uCloudCover: { value: 0.45 },
            uCloudTime: { value: 0 },
            uSunPosition: { value: new THREE.Vector3(0, 1, 0) },
            uSkyLut: { value: null }       // set by SkyLut
        }

        this.clouds = new Clouds(this.renderer.instance, this.uniforms)
        this.uniforms.uCloudWeather.value = this.clouds.weather.texture

        // the stars turn about the axis of the sun's daily path, the same way it goes
        const samples = [0, 0.25, 0.5, 0.75].map(sunAt)
        const axis = new THREE.Vector3()
        for (let i = 0; i < 4; i++)
            axis.add(new THREE.Vector3().crossVectors(samples[i], samples[(i + 1) % 4]))
        this.poleAxis.copy(axis.normalize())
        const step = sunAt(0.02)
        const turned = samples[0].clone().applyAxisAngle(this.poleAxis, 0.02 * Math.PI * 2)
        this.poleSign = turned.distanceTo(step) < samples[0].clone().applyAxisAngle(this.poleAxis, - 0.02 * Math.PI * 2).distanceTo(step) ? 1 : - 1

        this.background = this.createBackground()
        this.stars = this.createStars()

        this.settings.events.on('change:quality', (quality: Quality) => this.applyQuality(quality))
        this.applyQuality(this.settings.get('quality'))
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
                uMoonLight: this.uniforms.uMoonLight,
                uSkyLight: this.uniforms.uSkyLight,
                uSkyLut: this.uniforms.uSkyLut,
                uCloudOffset: this.uniforms.uCloudOffset,
                uNoiseTexture: { value: this.view.noises.texture },
                uCameraPosition: { value: new THREE.Vector3() },
                uWindDirection: { value: new THREE.Vector2(1, 0) },
                uCirrus: { value: 0.5 },
                uSunSize: { value: 1 },
                uMilkyWay: { value: 1 },
                uStarRotation: { value: new THREE.Matrix3() },
                uTime: { value: 0 }
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

    /**
     * Stars by apparent magnitude (many faint, few bright, as in the real sky), coloured by
     * temperature from blue-white to orange, a third of the faint ones crowded into the band
     * of the Milky Way.
     */
    private createStars() {
        const count = 6000
        const positions = new Float32Array(count * 3)
        const magnitudes = new Float32Array(count)
        const colors = new Float32Array(count * 3)
        const phases = new Float32Array(count)
        const galactic = new THREE.Vector3(0.3, 0.2, 0.93).normalize()      // the Milky Way's pole (background.glsl)
        const palette = [
            [0.62, 0.72, 1.0, 0.08], [0.82, 0.87, 1.0, 0.22], [1.0, 1.0, 1.0, 0.3],
            [1.0, 0.95, 0.82, 0.2], [1.0, 0.85, 0.65, 0.12], [1.0, 0.72, 0.5, 0.08]
        ]
        const random = (() => { let seed = 7; return () => (seed = (seed * 16807) % 2147483647) / 2147483647 })()
        for (let i = 0; i < count; i++) {
            // magnitude: N(< m) grows by about 10^(0.45 m), between 0.5 and 6.5
            const m = 6.5 - Math.log10(1 + random() * (Math.pow(10, 0.45 * 6) - 1)) / 0.45
            magnitudes[i] = m
            let direction = new THREE.Vector3().setFromSphericalCoords(1, Math.acos(2 * random() - 1), 2 * Math.PI * random())
            if (m > 4.5 && random() < 0.35) {
                // into the band: pull toward the galactic plane
                const latitude = direction.dot(galactic)
                direction.addScaledVector(galactic, - latitude * 0.85).normalize()
            }
            direction = direction.multiplyScalar(1000)
            positions.set([direction.x, direction.y, direction.z], i * 3)
            let pick = random(), c = palette[0]
            for (const entry of palette) { c = entry; pick -= entry[3]; if (pick <= 0) break }
            colors.set([c[0], c[1], c[2]], i * 3)
            phases[i] = random()
        }
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.setAttribute('aMagnitude', new THREE.Float32BufferAttribute(magnitudes, 1))
        geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3))
        geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1))
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uSunPosition: this.uniforms.uSunPosition,
                uClouds: { value: null },
                uResolution: { value: new THREE.Vector2(1, 1) },
                uPixelRatio: { value: 1 },
                uBrightness: { value: 1 },
                uTime: { value: 0 }
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

    /** The cloud cover the weather asks for now. */
    private targetCover(t: number) {
        if (this.cloudCoverOverride !== null)
            return this.cloudCoverOverride
        const weather = this.settings.get('weather')
        if (weather !== 'auto')
            return COVER[weather]
        // drifting on its own between clear spells and overcast, now and then rain
        return THREE.MathUtils.clamp(0.42 + 0.26 * Math.sin(t * 0.0021) + 0.12 * Math.sin(t * 0.0067 + 1.3), 0.1, 0.9)
    }

    update() {
        const player = this.state.player.position.current
        const sun = this.state.sun.position
        const dt = Math.min(this.state.time.delta, 0.1)

        this.group.position.set(player[0], player[1], player[2])
        this.uniforms.uSunPosition.value.set(sun.x, sun.y, sun.z)
        this.uniforms.uHazeRange.value = this.state.chunks.reach
        this.updateLight()

        // the wind carries the clouds; the weather moves the cover, slowly
        const t = this.state.time.elapsed
        this.uniforms.uCloudTime.value += dt * this.cloudEvolution
        const angle = THREE.MathUtils.degToRad(this.wind.direction)
        const wind = new THREE.Vector2(Math.cos(angle), Math.sin(angle))
        this.uniforms.uCloudOffset.value.addScaledVector(wind, this.wind.speed * dt)
        this.cover += (this.targetCover(t) - this.cover) * (1 - Math.exp(- dt * (this.cloudCoverOverride !== null ? 4 : 0.12)))
        this.uniforms.uCloudCover.value = this.cover

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

        // the stars (and the Milky Way) turn once a day about the pole
        const turn = new THREE.Quaternion().setFromAxisAngle(this.poleAxis, this.poleSign * this.state.day.progress * Math.PI * 2)
        this.stars.quaternion.copy(turn)

        const inverse = new THREE.Matrix4().multiplyMatrices(skyCamera.projectionMatrix, skyCamera.matrixWorldInverse).invert()
        const background = this.background.material.uniforms
        background.uInverseViewProjection.value.copy(inverse)
        background.uClouds.value = this.clouds.texture
        background.uCameraPosition.value.copy(main.position)
        background.uWindDirection.value.copy(wind)
        background.uCirrus.value = this.cirrus * (1 - THREE.MathUtils.smoothstep(this.cover, 0.75, 0.95) * 0.6)
        background.uSunSize.value = this.sunSize
        background.uMilkyWay.value = this.milkyWay
        background.uStarRotation.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(turn.clone().invert()))
        background.uTime.value = t

        const stars = this.stars.material.uniforms
        stars.uClouds.value = this.clouds.texture
        const size = this.renderer.instance.getDrawingBufferSize(new THREE.Vector2())
        stars.uResolution.value.copy(size)
        stars.uPixelRatio.value = this.renderer.instance.getPixelRatio()
        stars.uBrightness.value = this.starBrightness
        stars.uTime.value = t
    }

    resize() {
        this.clouds.setSize(this.viewport.width! * this.resolutionRatio, this.viewport.height! * this.resolutionRatio)
    }
}
