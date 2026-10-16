import Game from '../Game'
import Settings, { DAY_LENGTHS, THREADS, WEATHERS, DayLength, Threads, Weather } from '../Settings'
import Camera from '../State/Camera'
import DayCycle from '../State/DayCycle'
import { TerrainShape } from '../Workers/TerrainShape'
import Ui from '../Ui'
import { Tab } from '../Menu'

const SHAPE_LABELS: Record<keyof TerrainShape, [string, number, number, number]> = {
    regionFrequency: ['Region size (frequency)', 0.0001, 0.002, 0.00001],
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

const percent = (v: number) => `${Math.round(v * 100)} %`
const clock = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor(h * 60) % 60).padStart(2, '0')}`
const compass = (degrees: number) => ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][Math.round(((degrees % 360) + 360) % 360 / 45) % 8]

/**
 * The menu's tuning pages (they used to be a separate developer panel): Sky (time of day,
 * weather, clouds and wind, the night sky), World (seed and terrain shape), Visuals (exposure,
 * the film look, ambient occlusion, bloom, layers), Player (camera and movement) and Stats
 * (live performance with a frame-time graph, and the performance options). B opens Stats.
 * Every control works on the running game without reloading.
 */
export default class Debug {
    static instance: Debug

    static getInstance() {
        return Debug.instance
    }

    game: Game
    private ui = new Ui()
    private graph!: HTMLCanvasElement
    private frameTimes: number[] = []
    private last = performance.now()
    private readoutTimer = 0
    private setStat!: (key: string, text: string) => void

    constructor(game: Game) {
        Debug.instance = this
        this.game = game
        const menu = game.menu

        this.buildSky(menu.panel('sky'))
        this.buildWorld(menu.panel('world'))
        this.buildVisuals(menu.panel('visuals'))
        this.buildPlayer(menu.panel('player'))
        this.buildStats(menu.panel('stats'))

        menu.events.on('show', () => this.ui.refresh())
        game.state.controls.events.on('debugDown', () => menu.toggle('stats'))
        if (location.hash === '#debug')
            menu.show('stats')
    }

    /** Kept for older callers: opens the Stats page. */
    toggle() {
        this.game.menu.toggle('stats')
    }

    // ── pages ──

    private buildSky(page: HTMLElement) {
        const { state, view } = this.game
        const settings = Settings.getInstance()
        const sky = view.sky
        const ui = this.ui

        const time = ui.group(page, 'Time')
        ui.slider(time, {
            label: 'Time of day', min: 0, max: 24, step: 0.05,
            get: () => state.day.hour,
            set: (hour) => { state.day.timeProgress = DayCycle.progressForHour(hour); state.day.progress = state.day.timeProgress },
            format: clock
        })
        ui.choice(time, DAY_LENGTHS, () => settings.get('dayLength'), (value: DayLength) => settings.set('dayLength', value), 'Length of a day')

        const weather = ui.group(page, 'Weather', 'Changing drifts between clear spells, cloudy days and rain on its own; the others settle to that weather over a few seconds.')
        ui.choice(weather, WEATHERS, () => settings.get('weather'), (value: Weather) => { settings.set('weather', value); sky.cloudCoverOverride = null; this.ui.refresh() }, undefined, true)
        ui.toggle(weather, 'Set the cloud cover myself', () => sky.cloudCoverOverride !== null, (on) => { sky.cloudCoverOverride = on ? sky.cover : null; this.ui.refresh() })
        ui.slider(weather, { label: 'Cloud cover', min: 0, max: 1, step: 0.01, get: () => sky.cloudCoverOverride ?? sky.cover, set: (v) => { sky.cloudCoverOverride = v }, format: percent })

        const clouds = ui.group(page, 'Clouds and wind')
        ui.slider(clouds, { label: 'Wind speed', min: 0, max: 60, step: 0.5, get: () => sky.wind.speed, set: (v) => { sky.wind.speed = v }, format: (v) => `${v.toFixed(1)} m/s` })
        ui.slider(clouds, { label: 'Wind direction', min: 0, max: 360, step: 1, get: () => sky.wind.direction, set: (v) => { sky.wind.direction = v }, format: (v) => `${Math.round(v)}° ${compass(v)}` })
        ui.slider(clouds, { label: 'Cloud change speed', min: 0, max: 6, step: 0.1, get: () => sky.cloudEvolution, set: (v) => { sky.cloudEvolution = v }, format: (v) => `${v.toFixed(1)}×` })
        ui.slider(clouds, { label: 'High wispy clouds', min: 0, max: 1, step: 0.01, get: () => sky.cirrus, set: (v) => { sky.cirrus = v }, format: percent })

        const night = ui.group(page, 'Sun and night sky')
        ui.slider(night, { label: 'Sun size', min: 0.5, max: 3, step: 0.05, get: () => sky.sunSize, set: (v) => { sky.sunSize = v }, format: (v) => `${v.toFixed(2)}×` })
        ui.slider(night, { label: 'Stars', min: 0, max: 3, step: 0.05, get: () => sky.starBrightness, set: (v) => { sky.starBrightness = v }, format: (v) => `${v.toFixed(2)}×` })
        ui.slider(night, { label: 'Milky Way', min: 0, max: 3, step: 0.05, get: () => sky.milkyWay, set: (v) => { sky.milkyWay = v }, format: (v) => `${v.toFixed(2)}×` })
    }

    private buildWorld(page: HTMLElement) {
        const { state } = this.game
        const ui = this.ui

        const seed = ui.group(page, 'Seed', 'The same seed always grows the same world.')
        const form = document.createElement('form')
        form.className = 'ctl-seed'
        form.innerHTML = `<input type="text" value="${this.game.seed.replace(/"/g, '&quot;')}" spellcheck="false" aria-label="World seed"><button>Go</button>`
        form.addEventListener('submit', (event) => {
            event.preventDefault()
            const value = (form.querySelector('input') as HTMLInputElement).value.trim() || 'p'
            this.goTo(value)
        })
        seed.appendChild(form)
        ui.buttons(seed, [['Random world', () => this.goTo(Math.random().toString(36).slice(2, 8))]])

        const shapeGroup = ui.group(page, 'Terrain shape', 'Changes apply when a slider is let go: the terrain and its plants grow again.')
        ui.buttons(shapeGroup, [['Default shape', () => {
            Object.assign(state.terrains.shape, { ...state.terrains.defaultShape })
            this.regenerate()
            this.ui.refresh()
        }]])
        const shape = state.terrains.shape
        for (const key of Object.keys(SHAPE_LABELS) as (keyof TerrainShape)[]) {
            const [label, min, max, step] = SHAPE_LABELS[key]
            ui.slider(shapeGroup, { label, min, max, step, get: () => shape[key], set: (value) => { shape[key] = value; this.regenerate() }, onRelease: true })
        }
    }

    private buildVisuals(page: HTMLElement) {
        const { view } = this.game
        const renderer = view.renderer
        const ui = this.ui

        const look = ui.group(page, 'Look')
        ui.slider(look, { label: 'Exposure', min: 0.25, max: 4, step: 0.01, get: () => renderer.exposureBias, set: (v) => { renderer.exposureBias = v } })
        ui.slider(look, { label: 'Contrast', min: 0.8, max: 1.6, step: 0.01, get: () => renderer.film.power, set: (v) => { renderer.film.power = v } })
        ui.slider(look, { label: 'Saturation', min: 0.5, max: 1.8, step: 0.01, get: () => renderer.film.saturation, set: (v) => { renderer.film.saturation = v } })
        ui.slider(look, { label: 'Vignette', min: 0, max: 0.6, step: 0.01, get: () => renderer.film.vignette, set: (v) => { renderer.film.vignette = v } })
        ui.slider(look, { label: 'Sharpening', min: 0, max: 1, step: 0.01, get: () => renderer.sharpen.sharpness, set: (v) => { renderer.sharpen.sharpness = v } })

        const light = ui.group(page, 'Light')
        ui.toggle(light, 'Ambient occlusion', () => renderer.aoPass.enabled, (on) => { renderer.aoPass.enabled = on }, 'Soft contact shadows in creases')
        ui.slider(light, { label: 'Occlusion radius', min: 0.2, max: 8, step: 0.1, get: () => renderer.aoPass.configuration.aoRadius, set: (v) => { renderer.aoPass.configuration.aoRadius = v }, format: (v) => `${v.toFixed(1)} m` })
        ui.slider(light, { label: 'Occlusion strength', min: 0, max: 10, step: 0.1, get: () => renderer.aoPass.configuration.intensity, set: (v) => { renderer.aoPass.configuration.intensity = v } })
        ui.slider(light, { label: 'Bloom', min: 0, max: 3, step: 0.01, get: () => renderer.bloom.intensity, set: (v) => { renderer.bloom.intensity = v } })
        ui.slider(light, { label: 'Bloom threshold', min: 0.2, max: 8, step: 0.05, get: () => renderer.bloom.luminanceMaterial.threshold, set: (v) => { renderer.bloom.luminanceMaterial.threshold = v } })

        const layers = ui.group(page, 'Layers', 'Hide parts of the world, to see what each one costs (Stats) or just to look.')
        let trees = true, rocks = true, ferns = true
        ui.toggle(layers, 'Grass', () => view.grass.group.visible, (on) => { view.grass.group.visible = on })
        ui.toggle(layers, 'Trees and bushes', () => trees, (on) => {
            trees = on
            for (const variant of view.trees.variants) for (const mesh of [variant.bark, variant.leaves, variant.barkMid, variant.leavesMid]) mesh.visible = on
            if (view.trees.impostor) view.trees.impostor.mesh.visible = on
        })
        ui.toggle(layers, 'Boulders', () => rocks, (on) => { rocks = on; for (const layer of view.vegetation.layers.values()) layer.mesh.visible = on })
        ui.toggle(layers, 'Ferns', () => ferns, (on) => { ferns = on; view.ferns.setVisible(on) })
        ui.toggle(layers, 'Water', () => view.water.mesh.visible, (on) => { view.water.mesh.visible = on })
        ui.toggle(layers, 'Character', () => view.player.group.visible, (on) => { view.player.group.visible = on })
        ui.toggle(layers, 'Terrain wireframe', () => view.terrains.material.wireframe, (on) => {
            view.terrains.material.wireframe = on
            view.scene.traverse((object) => {
                const material = (object as { material?: { uniforms?: Record<string, unknown>, wireframe?: boolean } }).material
                if (material?.uniforms && 'uTextureSize' in material.uniforms)
                    material.wireframe = on
            })
        })
    }

    private buildPlayer(page: HTMLElement) {
        const { state } = this.game
        const player = state.player
        const ui = this.ui

        const camera = ui.group(page, 'Camera')
        ui.choice(camera, { third: 'Follow', fly: 'Free fly (V)' } as Record<'third' | 'fly', string>,
            () => player.camera.mode === Camera.MODE_FLY ? 'fly' : 'third',
            (mode) => this.setCameraMode(mode === 'fly' ? Camera.MODE_FLY : Camera.MODE_THIRDPERSON))
        ui.slider(camera, { label: 'Distance', min: 2.5, max: 18, step: 0.1, get: () => player.camera.thirdPerson.targetDistance, set: (v) => { player.camera.thirdPerson.targetDistance = v }, format: (v) => `${v.toFixed(1)} m` })

        const moving = ui.group(page, 'Moving')
        ui.slider(moving, { label: 'Jog speed', min: 1, max: 15, step: 0.1, get: () => player.walkSpeed, set: (v) => { player.walkSpeed = v }, format: (v) => `${v.toFixed(1)} m/s` })
        ui.slider(moving, { label: 'Sprint speed', min: 2, max: 30, step: 0.1, get: () => player.runSpeed, set: (v) => { player.runSpeed = v }, format: (v) => `${v.toFixed(1)} m/s` })
        ui.slider(moving, { label: 'Jump speed', min: 2, max: 25, step: 0.1, get: () => player.jumpSpeed, set: (v) => { player.jumpSpeed = v }, format: (v) => `${v.toFixed(1)} m/s` })
        ui.slider(moving, { label: 'Gravity', min: 2, max: 40, step: 0.1, get: () => player.gravity, set: (v) => { player.gravity = v }, format: (v) => `${v.toFixed(1)} m/s²` })

        const climbing = ui.group(page, 'Climbing')
        ui.slider(climbing, { label: 'Climbing speed', min: 0.5, max: 5, step: 0.1, get: () => player.climbSpeed, set: (v) => { player.climbSpeed = v }, format: (v) => `${v.toFixed(1)} m/s` })
        ui.slider(climbing, { label: 'Stamina lasts', min: 5, max: 120, step: 1, get: () => 1 / player.climbDrain, set: (v) => { player.climbDrain = 1 / v }, format: (v) => `${Math.round(v)} s` })
        ui.toggle(climbing, 'Endless stamina', () => player.climbDrain === 0, (on) => { player.climbDrain = on ? 0 : 1 / 22; this.ui.refresh() })
    }

    private buildStats(page: HTMLElement) {
        const { view } = this.game
        const settings = Settings.getInstance()
        const ui = this.ui

        const live = ui.group(page, 'Live')
        this.graph = document.createElement('canvas')
        this.graph.className = 'ctl-graph'
        this.graph.width = 600
        this.graph.height = 110
        this.graph.setAttribute('aria-label', 'Frame times of the last seconds')
        live.appendChild(this.graph)
        this.setStat = ui.readouts(live, [
            ['fps', 'Frame rate'], ['ms', 'Frame time (average / worst)'], ['resolution', 'Render resolution'],
            ['calls', 'Draw calls'], ['triangles', 'Triangles'], ['world', 'Chunks · grass patches'], ['plants', 'Trees near · mid · far · plants'], ['hidden', 'Trees hidden behind hills']
        ])

        const options = ui.group(page, 'Performance')
        ui.toggle(options, 'Adaptive resolution', () => settings.get('resolution') === 'auto', (on) => settings.set('resolution', on ? 'auto' : 'full'), 'Lower the resolution while frames run slow')
        ui.toggle(options, 'Hide trees behind hills', () => settings.get('hideHidden'), (on) => settings.set('hideHidden', on), 'Skip drawing what the terrain hides from the camera')
        ui.toggle(options, 'Compressed ground textures', () => settings.get('textureCompression'), (on) => settings.set('textureCompression', on), 'A quarter of the graphics memory; applies after a reload')
        ui.choice(options, THREADS, () => settings.get('threads'), (value: Threads) => settings.set('threads', value), 'World generation threads')
        // more switches join here
        const holder = document.createElement('div')
        holder.className = 'ctl-body'
        holder.dataset.performance = ''
        options.appendChild(holder)
        void view
    }

    /** Where other parts add their performance switches (Stats page). */
    get performanceGroup() {
        return this.game.menu.panel('stats').querySelector<HTMLElement>('[data-performance]')!
    }

    private goTo(seed: string) {
        const url = new URL(location.href)
        url.searchParams.set('seed', seed)
        url.hash = 'debug'
        location.href = url.toString()
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

    update() {
        const now = performance.now()
        const frame = now - this.last
        this.last = now
        this.frameTimes.push(frame)
        if (this.frameTimes.length > 180)
            this.frameTimes.shift()
        const menu = this.game.menu
        if (!menu.isOpen || menu.currentTab !== ('stats' as Tab))
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
        const set = this.setStat
        set('fps', `${Math.round(1000 / average)} fps`)
        set('ms', `${average.toFixed(1)} / ${worst.toFixed(1)} ms`)
        set('resolution', `${canvas.width} × ${canvas.height}` + (view.renderer.adaptive.scale < 0.999 ? ` (${Math.round(view.renderer.adaptive.scale * 100)} %)` : ''))
        set('calls', String(renderer.info.render.calls))
        set('triangles', renderer.info.render.triangles.toLocaleString())
        set('world', `${state.terrains.terrains.size} · ${view.grass.visiblePatches}`)
        let plants = 0
        for (const cell of state.vegetation.cells.values())
            plants += cell.plants.length
        set('plants', `${view.trees.counts.near} · ${view.trees.counts.mid} · ${view.trees.counts.far} · ${plants.toLocaleString()}`)
        set('hidden', view.horizon.enabled ? view.trees.counts.hidden.toLocaleString() : 'off')

        // frame-time graph: lines at 60 and 30 fps, taller = slower
        const context = this.graph.getContext('2d')!
        const { width, height } = this.graph
        const scale = (ms: number) => height - Math.min(height, height * ms / 50)
        context.clearRect(0, 0, width, height)
        context.fillStyle = 'rgba(255, 255, 255, 0.12)'
        context.fillRect(0, scale(16.7), width, 1)
        context.fillRect(0, scale(33.3), width, 1)
        context.font = '18px system-ui, sans-serif'
        context.fillStyle = 'rgba(255, 255, 255, 0.45)'
        context.fillText('60', 6, scale(16.7) - 5)
        context.fillText('30', 6, scale(33.3) - 5)
        const bar = width / 180
        times.forEach((ms, i) => {
            context.fillStyle = ms > 33 ? '#f08a76' : ms > 20 ? '#f2c26b' : '#b9de7c'
            context.fillRect(i * bar, scale(ms), Math.max(1, bar - 1), height - scale(ms))
        })
    }
}
