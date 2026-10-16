import Game from '../Game'
import Settings, { DAY_LENGTHS, DayLength } from '../Settings'
import Camera from '../State/Camera'
import DayCycle from '../State/DayCycle'
import { TerrainShape } from '../Workers/TerrainShape'

type Slider = { label: string, min: number, max: number, step: number, get: () => number, set: (value: number) => void, format?: (value: number) => string, onRelease?: boolean }

const SHAPE_LABELS: Record<keyof TerrainShape, [string, number, number, number]> = {
    regionFrequency: ['Region size (freq)', 0.0001, 0.002, 0.00001],
    warpFrequency: ['Warp frequency', 0, 0.005, 0.0001],
    warpAmount: ['Warp amount (m)', 0, 300, 1],
    hillFrequency: ['Hill frequency', 0.0005, 0.02, 0.0001],
    plainsAmplitude: ['Plains height (m)', 0, 40, 0.5],
    hillsAmplitude: ['Hills height (m)', 0, 120, 1],
    hillsLift: ['Hills lift (fewer lakes)', - 0.5, 0.8, 0.01],
    mountainsStart: ['Mountains start', - 0.6, 0.6, 0.01],
    mountainsFull: ['Mountains full', - 0.4, 0.9, 0.01],
    mountainFrequency: ['Mountain frequency', 0.0002, 0.006, 0.0001],
    mountainAmplitude: ['Mountain height (m)', 0, 600, 5],
    mountainSharpness: ['Ridge sharpness', 0.5, 4, 0.05],
    lakeDepth: ['Lake depth (m)', 0.5, 40, 0.5]
}

/**
 * Developer panel (B): live performance with a frame-time graph, time of day, world seed and
 * terrain shape, clouds, rendering (exposure, look, AO, bloom), layer toggles, camera and
 * player tuning. Opens and closes without
 * reloading; every control works on the running game.
 */
export default class Debug {
    static instance: Debug

    static getInstance() {
        return Debug.instance
    }

    game: Game
    element: HTMLElement
    open = false
    private readouts = new Map<string, HTMLElement>()
    private graph!: HTMLCanvasElement
    private frameTimes: number[] = []
    private last = performance.now()
    private readoutTimer = 0
    private sliders: { input: HTMLInputElement, value: HTMLElement, slider: Slider }[] = []

    constructor(game: Game) {
        Debug.instance = this
        this.game = game

        this.element = document.createElement('div')
        this.element.className = 'dev-panel'
        this.element.hidden = true
        this.element.innerHTML = `<header><h2>Developer</h2><span>B closes</span></header>`
        document.querySelector('.ui')!.appendChild(this.element)

        this.build()
        game.state.controls.events.on('debugDown', () => this.toggle())
        if (location.hash === '#debug')
            this.toggle()
    }

    toggle() {
        this.open = !this.open
        this.element.hidden = !this.open
        if (this.open)
            this.refresh()
    }

    // ── building blocks ──

    private section(title: string, collapsed = false) {
        const details = document.createElement('details')
        details.open = !collapsed
        details.innerHTML = `<summary>${title}</summary>`
        const body = document.createElement('div')
        body.className = 'dev-body'
        details.appendChild(body)
        this.element.appendChild(details)
        return body
    }

    private readout(parent: HTMLElement, key: string, label: string) {
        const row = document.createElement('div')
        row.className = 'dev-row'
        row.innerHTML = `<span>${label}</span><output></output>`
        parent.appendChild(row)
        this.readouts.set(key, row.querySelector('output')!)
    }

    private slider(parent: HTMLElement, slider: Slider) {
        const row = document.createElement('label')
        row.className = 'dev-slider'
        row.innerHTML = `<span>${slider.label}</span><output></output><input type="range" min="${slider.min}" max="${slider.max}" step="${slider.step}">`
        const input = row.querySelector('input')!
        const value = row.querySelector('output')!
        input.addEventListener(slider.onRelease ? 'change' : 'input', () => {
            slider.set(Number(input.value))
            value.textContent = (slider.format ?? ((v: number) => String(v)))(Number(input.value))
        })
        if (slider.onRelease)
            input.addEventListener('input', () => { value.textContent = (slider.format ?? ((v: number) => String(v)))(Number(input.value)) })
        parent.appendChild(row)
        this.sliders.push({ input, value, slider })
    }

    private toggleControl(parent: HTMLElement, label: string, get: () => boolean, set: (on: boolean) => void) {
        const row = document.createElement('label')
        row.className = 'dev-toggle'
        row.innerHTML = `<input type="checkbox"><span>${label}</span>`
        const input = row.querySelector('input')!
        input.checked = get()
        input.addEventListener('change', () => set(input.checked))
        parent.appendChild(row)
    }

    private buttons(parent: HTMLElement, items: [string, () => void][]) {
        const row = document.createElement('div')
        row.className = 'dev-buttons'
        for (const [label, action] of items) {
            const button = document.createElement('button')
            button.textContent = label
            button.addEventListener('click', action)
            row.appendChild(button)
        }
        parent.appendChild(row)
    }

    // ── panel ──

    private build() {
        const { state, view } = this.game
        const settings = Settings.getInstance()

        // performance
        const performance = this.section('Performance')
        this.graph = document.createElement('canvas')
        this.graph.className = 'dev-graph'
        this.graph.width = 280
        this.graph.height = 54
        performance.appendChild(this.graph)
        for (const [key, label] of [['fps', 'Frame rate'], ['ms', 'Frame time (avg / worst)'], ['resolution', 'Render resolution'], ['calls', 'Draw calls'], ['triangles', 'Triangles'], ['world', 'Chunks · grass patches'], ['plants', 'Trees near · far · plants']])
            this.readout(performance, key, label)
        this.toggleControl(performance, 'Adaptive resolution', () => view.renderer.adaptive.enabled, (on) => {
            view.renderer.adaptive.enabled = on
            if (!on) {
                view.renderer.adaptive.scale = 1
                view.renderer.resize()
            }
        })

        // time
        const time = this.section('Time of day')
        this.slider(time, {
            label: 'Time', min: 0, max: 24, step: 0.05,
            get: () => state.day.hour,
            set: (hour) => { state.day.timeProgress = DayCycle.progressForHour(hour); state.day.progress = state.day.timeProgress },
            format: (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor(h * 60) % 60).padStart(2, '0')}`
        })
        const lengths = Object.keys(DAY_LENGTHS) as DayLength[]
        this.buttons(time, lengths.map((length) => [DAY_LENGTHS[length], () => settings.set('dayLength', length)]))

        // world
        const world = this.section('World')
        const seedRow = document.createElement('form')
        seedRow.className = 'dev-seed'
        seedRow.innerHTML = `<span>Seed</span><input type="text" value="${this.game.seed}" spellcheck="false"><button>Go</button>`
        seedRow.addEventListener('submit', (event) => {
            event.preventDefault()
            const value = (seedRow.querySelector('input') as HTMLInputElement).value.trim() || 'p'
            const url = new URL(location.href)
            url.searchParams.set('seed', value)
            url.hash = 'debug'
            location.href = url.toString()
        })
        world.appendChild(seedRow)
        this.buttons(world, [
            ['Random world', () => {
                const url = new URL(location.href)
                url.searchParams.set('seed', Math.random().toString(36).slice(2, 8))
                url.hash = 'debug'
                location.href = url.toString()
            }],
            ['Default shape', () => {
                Object.assign(state.terrains.shape, { ...state.terrains.defaultShape })
                this.regenerate()
                this.refresh()
            }]
        ])
        const shape = state.terrains.shape
        for (const key of Object.keys(SHAPE_LABELS) as (keyof TerrainShape)[]) {
            const [label, min, max, step] = SHAPE_LABELS[key]
            this.slider(world, { label, min, max, step, get: () => shape[key], set: (value) => { shape[key] = value; this.regenerate() }, onRelease: true })
        }

        // sky
        const sky = this.section('Sky', true)
        this.toggleControl(sky, 'Clouds follow the weather', () => view.sky.cloudCoverOverride === null, (on) => {
            view.sky.cloudCoverOverride = on ? null : view.sky.uniforms.uCloudCover.value
            this.refresh()
        })
        this.slider(sky, {
            label: 'Cloud cover', min: 0, max: 1, step: 0.01,
            get: () => view.sky.uniforms.uCloudCover.value,
            set: (value) => { view.sky.cloudCoverOverride = value },
            format: (v) => `${Math.round(v * 100)} %`
        })

        // rendering: exposure, the film look, ambient occlusion, bloom
        const rendering = this.section('Rendering', true)
        const renderer = view.renderer
        this.slider(rendering, { label: 'Exposure', min: 0.25, max: 4, step: 0.01, get: () => renderer.exposureBias, set: (v) => { renderer.exposureBias = v } })
        this.slider(rendering, { label: 'Contrast', min: 0.8, max: 1.6, step: 0.01, get: () => renderer.film.power, set: (v) => { renderer.film.power = v } })
        this.slider(rendering, { label: 'Saturation', min: 0.5, max: 1.8, step: 0.01, get: () => renderer.film.saturation, set: (v) => { renderer.film.saturation = v } })
        this.slider(rendering, { label: 'Vignette', min: 0, max: 0.6, step: 0.01, get: () => renderer.film.vignette, set: (v) => { renderer.film.vignette = v } })
        this.toggleControl(rendering, 'Ambient occlusion', () => renderer.aoPass.enabled, (on) => { renderer.aoPass.enabled = on })
        this.slider(rendering, { label: 'AO radius (m)', min: 0.2, max: 8, step: 0.1, get: () => renderer.aoPass.configuration.aoRadius, set: (v) => { renderer.aoPass.configuration.aoRadius = v } })
        this.slider(rendering, { label: 'AO intensity', min: 0, max: 10, step: 0.1, get: () => renderer.aoPass.configuration.intensity, set: (v) => { renderer.aoPass.configuration.intensity = v } })
        this.slider(rendering, { label: 'Bloom', min: 0, max: 3, step: 0.01, get: () => renderer.bloom.intensity, set: (v) => { renderer.bloom.intensity = v } })
        this.slider(rendering, { label: 'Bloom threshold', min: 0.2, max: 8, step: 0.05, get: () => renderer.bloom.luminanceMaterial.threshold, set: (v) => { renderer.bloom.luminanceMaterial.threshold = v } })

        // layers
        const layers = this.section('Layers', true)
        this.toggleControl(layers, 'Grass', () => view.grass.group.visible, (on) => { view.grass.group.visible = on })
        this.toggleControl(layers, 'Trees', () => true, (on) => {
            for (const variant of view.trees.variants) for (const mesh of [variant.bark, variant.leaves, variant.barkMid, variant.leavesMid]) mesh.visible = on
            if (view.trees.impostor) view.trees.impostor.mesh.visible = on
        })
        this.toggleControl(layers, 'Boulders', () => true, (on) => { for (const layer of view.vegetation.layers.values()) layer.mesh.visible = on })
        this.toggleControl(layers, 'Ferns', () => true, (on) => view.ferns.setVisible(on))
        this.toggleControl(layers, 'Water', () => view.water.mesh.visible, (on) => { view.water.mesh.visible = on })
        this.toggleControl(layers, 'Character', () => view.player.group.visible, (on) => { view.player.group.visible = on })
        this.toggleControl(layers, 'Terrain wireframe', () => view.terrains.material.wireframe, (on) => {
            view.terrains.material.wireframe = on
            view.scene.traverse((object) => {
                const material = (object as { material?: { uniforms?: Record<string, unknown>, wireframe?: boolean } }).material
                if (material?.uniforms && 'uTextureSize' in material.uniforms)
                    material.wireframe = on
            })
        })

        // camera & player
        const camera = this.section('Camera & player', true)
        this.buttons(camera, [
            ['Third person', () => this.setCameraMode(Camera.MODE_THIRDPERSON)],
            ['Free fly (V)', () => this.setCameraMode(Camera.MODE_FLY)]
        ])
        const player = state.player
        this.slider(camera, { label: 'Jog speed (m/s)', min: 1, max: 15, step: 0.1, get: () => player.walkSpeed, set: (v) => { player.walkSpeed = v } })
        this.slider(camera, { label: 'Sprint speed (m/s)', min: 2, max: 30, step: 0.1, get: () => player.runSpeed, set: (v) => { player.runSpeed = v } })
        this.slider(camera, { label: 'Jump speed (m/s)', min: 2, max: 25, step: 0.1, get: () => player.jumpSpeed, set: (v) => { player.jumpSpeed = v } })
        this.slider(camera, { label: 'Gravity (m/s²)', min: 2, max: 40, step: 0.1, get: () => player.gravity, set: (v) => { player.gravity = v } })
    }

    private setCameraMode(mode: number) {
        const camera = this.game.state.player.camera
        if (camera.mode === mode)
            return
        camera.mode = mode
        if (mode === Camera.MODE_FLY) {
            camera.thirdPerson.deactivate()
            camera.fly.activate()
        }
        else {
            camera.fly.deactivate()
            camera.thirdPerson.activate()
        }
    }

    /** New terrain shape: regenerate the terrain and the plants on it. */
    private regenerate() {
        const { state } = this.game
        state.terrains.recreate()
        state.vegetation.cells.clear()
        state.vegetation.version++
    }

    private refresh() {
        for (const { input, value, slider } of this.sliders) {
            const current = slider.get()
            input.value = String(current)
            value.textContent = (slider.format ?? ((v: number) => String(Number(v.toFixed(5)))))(current)
        }
    }

    update() {
        const now = performance.now()
        const frame = now - this.last
        this.last = now
        this.frameTimes.push(frame)
        if (this.frameTimes.length > 140)
            this.frameTimes.shift()
        if (!this.open)
            return

        this.readoutTimer -= frame
        if (this.readoutTimer > 0)
            return
        this.readoutTimer = 250

        const { state, view } = this.game
        const times = this.frameTimes
        const average = times.reduce((a, b) => a + b, 0) / times.length
        const worst = Math.max(...times)
        const renderer = view.renderer.instance
        const canvas = renderer.domElement
        const set = (key: string, text: string) => { this.readouts.get(key)!.textContent = text }
        set('fps', `${Math.round(1000 / average)} fps`)
        set('ms', `${average.toFixed(1)} / ${worst.toFixed(1)} ms`)
        set('resolution', `${canvas.width} × ${canvas.height}` + (view.renderer.adaptive.scale < 0.999 ? ` (${Math.round(view.renderer.adaptive.scale * 100)} %)` : ''))
        set('calls', String(renderer.info.render.calls))
        set('triangles', renderer.info.render.triangles.toLocaleString())
        set('world', `${state.terrains.terrains.size} · ${view.grass.visiblePatches}`)
        let plants = 0
        for (const cell of state.vegetation.cells.values())
            plants += cell.plants.length
        set('plants', `${view.trees.counts.near} · ${view.trees.counts.far} · ${plants.toLocaleString()}`)

        // frame-time graph: 16.7 ms line, taller = slower
        const context = this.graph.getContext('2d')!
        const { width, height } = this.graph
        context.clearRect(0, 0, width, height)
        context.fillStyle = 'rgba(255, 255, 255, 0.08)'
        context.fillRect(0, height - height * 16.7 / 50, width, 1)
        context.fillStyle = '#9fd36a'
        times.forEach((ms, i) => {
            const h = Math.min(height, height * ms / 50)
            context.fillStyle = ms > 33 ? '#e8806a' : ms > 20 ? '#e8c46a' : '#9fd36a'
            context.fillRect(i * (width / 140), height - h, Math.max(1, width / 140 - 0.5), h)
        })
    }
}
