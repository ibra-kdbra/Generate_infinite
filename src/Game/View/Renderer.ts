import * as THREE from 'three'
import { EffectComposer, RenderPass, EffectPass, ShaderPass, BloomEffect, SMAAEffect, SMAAPreset, BlendFunction } from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import Game from '../Game'
import View from './View'
import State from '../State/State'
import Time from '../State/Time'
import Viewport from '../State/Viewport'
import Camera from './Camera'
import Settings, { Antialiasing, Quality, Resolution } from '../Settings'
import FilmEffect from './FilmEffect'
import UnderwaterEffect from './UnderwaterEffect'
import SharpenEffect from './SharpenEffect'
import TemporalPass from './TemporalPass'
import { WATER_LEVEL } from '../Workers/TerrainShape'

// Render resolution cap per quality (CSS pixel multiples). A 4K laptop panel at 225 %
// scaling would otherwise render ~3400 x 1900 pixels, far too many for an integrated GPU.
const MAX_PIXEL_RATIO: Record<Quality, number> = { low: 0.75, medium: 1, high: 1.5, ultra: 2 }

// Post-processing by quality: ambient occlusion (N8AO; half resolution is much cheaper),
// bloom on the brightest highlights and SMAA anti-aliasing. (No multisampling: N8AO can't
// read a multisampled depth buffer, the occlusion silently disappears.)
type AoQuality = 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'
const POST: Record<Quality, { ao: AoQuality | null, aoHalfRes: boolean, bloom: boolean, smaa: SMAAPreset | null }> = {
    low: { ao: null, aoHalfRes: true, bloom: false, smaa: null },
    medium: { ao: 'Performance', aoHalfRes: true, bloom: true, smaa: SMAAPreset.MEDIUM },
    high: { ao: 'Low', aoHalfRes: true, bloom: true, smaa: SMAAPreset.HIGH },
    // half resolution even here: at a 4K panel's pixel ratio that's still the full CSS size
    ultra: { ao: 'Medium', aoHalfRes: true, bloom: true, smaa: SMAAPreset.ULTRA }
}

export default class Renderer {
    game!: Game;
    view!: View;
    state!: State;
    scene!: THREE.Scene;
    viewport!: Viewport;
    time!: Time;
    camera!: Camera;
    instance!: THREE.WebGLRenderer;
    clearColor!: string;
    context!: WebGLRenderingContext | WebGL2RenderingContext;
    composer!: EffectComposer
    renderPass!: RenderPass
    aoPass!: N8AOPostPass
    bloom!: BloomEffect
    film!: FilmEffect
    underwater!: UnderwaterEffect
    smaa!: SMAAEffect
    effectPass!: EffectPass
    smaaPass!: EffectPass
    sharpen!: SharpenEffect
    sharpenPass!: EffectPass
    temporalPass!: TemporalPass
    exposureBias = 1                   // developer panel
    exposure = 1                       // current, after adaptation

    // Render resolution (the Resolution setting): 'auto' follows the frame time, since the
    // per-pixel terrain and grass shading is heavy at high resolutions (4K panels, pixel
    // ratio 2): down when frames run long, slowly back up when there's headroom. Below the
    // display's resolution the frame is sharpened as it's stretched (SharpenEffect).
    adaptive = { enabled: true, scale: 1, min: 0.5, samples: [] as number[], elapsed: 0, headroom: 0 }

    constructor() {
        this.game = Game.getInstance()
        this.view = View.getInstance()
        this.state = State.getInstance()

        this.scene = this.view.scene
        this.viewport = this.state.viewport
        this.time = this.state.time
        this.camera = this.view.camera

        this.setInstance()
        this.setComposer()
        const settings = Settings.getInstance()
        this.applyResolution(settings.get('resolution'))
        settings.events.on('change:quality', (quality: Quality) => {
            this.applyQuality(quality)
            this.applyResolution(settings.get('resolution'))
        })
        settings.events.on('change:resolution', (resolution: Resolution) => this.applyResolution(resolution))
        settings.events.on('change:antialiasing', (_: Antialiasing) => this.applyQuality(settings.get('quality')))
    }

    setInstance() {
        this.clearColor = '#222222'

        // the scene renders into the composer's buffers: no multisampling or depth on the canvas
        this.instance = new THREE.WebGLRenderer({
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: 'high-performance'
        })

        this.instance.outputColorSpace = THREE.SRGBColorSpace
        this.instance.toneMapping = THREE.NoToneMapping      // tone mapping is a post-processing effect
        this.instance.info.autoReset = false     // several passes per frame: counted together
        this.instance.domElement.style.top = '0'
        this.instance.domElement.style.left = '0'
        this.instance.domElement.style.width = '100%'
        this.instance.domElement.style.height = '100%'

        this.instance.setClearColor(this.clearColor, 1)
        // Add '!' to assert that these values are not null
        this.instance.setSize(this.viewport.width!, this.viewport.height!)
        this.instance.setPixelRatio(this.pixelRatio())

        this.context = this.instance.getContext()
    }


    /**
     * The frame renders in linear light into a half-float buffer, then: ambient occlusion,
     * bloom, filmic tone mapping (AgX with a little more contrast and colour) and the sRGB
     * encoding for the display.
     */
    setComposer() {
        const camera = this.camera.instance
        this.composer = new EffectComposer(this.instance, { frameBufferType: THREE.HalfFloatType, stencilBuffer: false })
        this.renderPass = new RenderPass(this.scene, camera)
        this.composer.addPass(this.renderPass)
        // NaN / infinity guard: one invalid pixel (a shader dividing by zero on some GPU) would
        // otherwise spread over the whole frame through the bloom's blur and black it out
        this.composer.addPass(new ShaderPass(new THREE.ShaderMaterial({
            uniforms: { inputBuffer: { value: null } },
            vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }',
            fragmentShader: `
                uniform sampler2D inputBuffer;
                varying vec2 vUv;
                void main()
                {
                    vec4 color = texture2D(inputBuffer, vUv);
                    bool invalid = any(isnan(color)) || any(isinf(color)) || any(notEqual(color, color));
                    gl_FragColor = invalid ? vec4(0.0, 0.0, 0.0, 1.0) : min(color, vec4(4000.0));
                }`,
            depthTest: false,
            depthWrite: false
        })))

        const width = this.viewport.width!, height = this.viewport.height!
        this.aoPass = new N8AOPostPass(this.scene, camera, width, height)
        this.aoPass.configuration.aoRadius = 2.5
        this.aoPass.configuration.distanceFalloff = 1
        this.aoPass.configuration.intensity = 3
        this.aoPass.configuration.transparencyAware = false
        this.aoPass.configuration.gammaCorrection = false
        this.aoPass.configuration.color = new THREE.Color(0.02, 0.03, 0.06)
        this.composer.addPass(this.aoPass)

        this.bloom = new BloomEffect({ luminanceThreshold: 1.6, luminanceSmoothing: 0.6, intensity: 0.45, mipmapBlur: true, radius: 0.7 })
        this.film = new FilmEffect()
        this.underwater = new UnderwaterEffect()
        this.effectPass = new EffectPass(camera, this.underwater, this.bloom, this.film)
        this.composer.addPass(this.effectPass)

        this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH })
        this.smaaPass = new EffectPass(camera, this.smaa)
        this.composer.addPass(this.smaaPass)

        this.temporalPass = new TemporalPass(camera)
        this.temporalPass.enabled = false
        this.composer.addPass(this.temporalPass)

        this.sharpen = new SharpenEffect(0.55)
        this.sharpenPass = new EffectPass(camera, this.sharpen)
        this.sharpenPass.enabled = false
        this.composer.addPass(this.sharpenPass)

        this.applyQuality(Settings.getInstance().get('quality'))
    }

    applyQuality(quality: Quality) {
        const post = POST[quality]
        this.aoPass.enabled = post.ao !== null
        if (post.ao) {
            this.aoPass.setQualityMode(post.ao)
            this.aoPass.configuration.halfRes = post.aoHalfRes
        }
        // skipped entirely when off (not just faded out: that would still run it)
        this.bloom.blendMode.blendFunction = post.bloom ? BlendFunction.ADD : BlendFunction.SKIP
        // anti-aliasing: SMAA, or temporal (not on low quality)
        const temporal = post.smaa !== null && Settings.getInstance().get('antialiasing') === 'taa'
        this.smaaPass.enabled = post.smaa !== null && !temporal
        if (post.smaa !== null)
            this.smaa.applyPreset(post.smaa)
        if (temporal && !this.temporalPass.enabled)
            this.temporalPass.invalidate()
        this.temporalPass.enabled = temporal
        this.updateOutput()
    }

    /** The last pass that runs draws to the screen. */
    private updateOutput() {
        // sharpen when rendering noticeably below the display's own resolution
        this.sharpenPass.enabled = this.pixelRatio() < (this.viewport.pixelRatio ?? 1) * 0.92 || this.temporalPass.enabled
        const passes = [this.effectPass, this.smaaPass, this.temporalPass, this.sharpenPass]
        const last = passes.filter((pass) => pass.enabled).pop()
        for (const pass of passes)
            pass.renderToScreen = pass === last
    }

    /** The Resolution setting: adaptive, or a fixed share of the display's resolution. */
    applyResolution(resolution: Resolution) {
        this.adaptive.enabled = resolution === 'auto'
        this.adaptive.samples = []
        this.adaptive.elapsed = 0
        this.setScale(resolution === '75' ? 0.75 : resolution === '50' ? 0.5 : 1)
    }

    /** Device pixel ratio, capped by the quality setting, times the adaptive scale. */
    pixelRatio() {
        const cap = MAX_PIXEL_RATIO[Settings.getInstance().get('quality')]
        return Math.min(this.viewport.clampedPixelRatio!, cap) * this.adaptive.scale
    }

    private setScale(scale: number) {
        this.adaptive.scale = scale
        this.resize()
    }

    private updateAdaptiveResolution() {
        const adaptive = this.adaptive
        // only while someone is playing: a hidden or unfocused page gets throttled frames
        // that look exactly like a slow GPU
        if (!adaptive.enabled || document.hidden || !document.hasFocus()) {
            adaptive.samples = []
            adaptive.elapsed = 0
            return
        }

        adaptive.samples.push(this.time.delta)
        adaptive.elapsed += this.time.delta
        if (adaptive.elapsed < 1.5)
            return

        // median frame time of the last ~1.5 s (ignores the odd hitch)
        const sorted = adaptive.samples.sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        adaptive.samples = []
        adaptive.elapsed = 0

        if (median > 1 / 48) {
            adaptive.headroom = 0
            if (adaptive.scale > adaptive.min)
                this.setScale(Math.max(adaptive.min, adaptive.scale * 0.85))
        }
        else if (median < 1 / 58 && adaptive.scale < 1) {
            // only after ~6 s of headroom, so it doesn't flip between two sizes
            if (++adaptive.headroom >= 4) {
                adaptive.headroom = 0
                this.setScale(Math.min(1, adaptive.scale * 1.1))
            }
        }
        else {
            adaptive.headroom = 0
        }
    }

    resize() {
        this.instance.setPixelRatio(this.pixelRatio())
        this.instance.setSize(this.viewport.width!, this.viewport.height!)
        // the composer's buffers follow the drawing buffer size (pixel ratio included)
        this.composer?.setSize(this.viewport.width!, this.viewport.height!)
        if (this.sharpenPass)
            this.updateOutput()
    }

    /**
     * Exposure follows the light on open ground (the atmosphere's sun, sky and moon): like an
     * eye or a camera, it opens up at dusk and at night, though nights stay dark.
     */
    private updateExposure() {
        const { clamp, smoothstep } = THREE.MathUtils
        const sun = this.state.sun.position
        const y = sun.y / Math.max(1e-6, Math.hypot(sun.x, sun.y, sun.z))
        const atmosphere = this.view.sky?.light
        if (!atmosphere)
            return
        const luminance = (c: number[]) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722
        const light = luminance(atmosphere.sun) * Math.max(0, y) + luminance(atmosphere.sky) + luminance(atmosphere.moon) * Math.max(0, - y)
        const adaptation = clamp(Math.pow(2 / light, 0.33), 1, 3.2)
        this.exposure = this.exposureBias * adaptation
        this.film.exposure = this.exposure
        // colour vision fades only in real darkness (not at sunset)
        this.film.night = 1 - smoothstep(light, 0.07, 0.16)
    }

    /** Under the surface: absorption and the water's scattered light (UnderwaterEffect). */
    private updateUnderwater() {
        const depth = WATER_LEVEL - this.camera.instance.position.y
        this.underwater.underwater = THREE.MathUtils.smoothstep(depth, - 0.02, 0.08)
        this.underwater.cameraDepth = Math.max(0, depth)
        const light = this.view.sky?.light
        if (light) {
            const sunUp = Math.max(0, this.state.sun.position.y)
            const color = this.underwater.waterColor
            color.set(0.012, 0.05, 0.058).multiply(new THREE.Vector3(...light.sky).addScaledVector(new THREE.Vector3(...light.sun), sunUp * 0.5))
        }
    }

    update() {
        this.updateAdaptiveResolution()
        this.updateExposure()
        this.updateUnderwater()

        this.instance.info.reset()
        const temporal = this.temporalPass.enabled
        if (temporal) {
            const size = this.instance.getDrawingBufferSize(new THREE.Vector2())
            const p = this.state.player.position.current
            this.temporalPass.applyJitter(size.x, size.y, new THREE.Vector3(p[0], p[1], p[2]))
        }
        this.composer.render(this.time.delta)
        if (temporal)
            this.temporalPass.removeJitter()
    }

    destroy() {
        this.composer.dispose()
        this.instance.renderLists.dispose()
        this.instance.dispose()
    }
}
