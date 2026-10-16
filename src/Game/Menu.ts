import Settings, { CHARACTERS, DAY_LENGTHS, GRASS_STYLES, QUALITIES, CharacterName, DayLength, GrassStyle, Quality } from './Settings'
import State from './State/State'
import View from './View/View'

/**
 * Settings menu (gear button or Esc): character, graphics quality, grass style, day length,
 * plus a live frame rate / resolution / graphics card readout; and the clock in the corner.
 */
export default class Menu {
    settings: Settings
    state: State
    view: View
    element: HTMLElement
    panel: HTMLElement
    stats: HTMLElement
    clock: HTMLElement
    flyHint: HTMLElement
    breath: HTMLElement
    private open = false
    private frames = 0
    private elapsed = 0
    private startQuality: Quality
    private gpu: string

    constructor() {
        this.settings = Settings.getInstance()
        this.state = State.getInstance()
        this.view = View.getInstance()
        this.startQuality = this.settings.get('quality')
        this.gpu = this.gpuName()

        this.element = document.createElement('div')
        this.element.className = 'menu'
        this.element.innerHTML = `
            <button class="menu-toggle" aria-label="Settings" title="Settings (Esc)">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>
            </button>
            <div class="menu-panel" role="dialog" aria-label="Settings" hidden>
                <h2>Settings</h2>
                ${this.section('character', 'Character', CHARACTERS)}
                ${this.section('quality', 'Graphics', QUALITIES)}
                <p class="menu-note" data-note hidden>Anti-aliasing changes after a reload.</p>
                ${this.section('grass', 'Grass', GRASS_STYLES)}
                ${this.section('dayLength', 'Day length', DAY_LENGTHS)}
                <p class="menu-stats" data-stats>…</p>
                <p class="menu-hint">Esc closes</p>
            </div>`
        document.querySelector('.ui')!.appendChild(this.element)

        this.clock = document.createElement('div')
        this.clock.className = 'clock'
        document.querySelector('.ui')!.appendChild(this.clock)

        this.flyHint = document.createElement('div')
        this.flyHint.className = 'fly-hint'
        this.flyHint.hidden = true
        document.querySelector('.ui')!.appendChild(this.flyHint)

        // air left while diving
        this.breath = document.createElement('div')
        this.breath.className = 'breath'
        this.breath.hidden = true
        this.breath.innerHTML = '<span class="breath-label">Air</span><span class="breath-bar"><span></span></span>'
        document.querySelector('.ui')!.appendChild(this.breath)
        this.panel = this.element.querySelector('.menu-panel')!
        this.stats = this.element.querySelector('[data-stats]')!

        this.element.querySelector('.menu-toggle')!.addEventListener('click', () => this.toggle())
        window.addEventListener('keydown', (event) => {
            if (event.code === 'Escape')
                this.toggle()
        })
        this.panel.addEventListener('click', (event) => {
            const button = (event.target as HTMLElement).closest('button[data-key]') as HTMLButtonElement | null
            if (!button)
                return
            const key = button.dataset.key as 'character' | 'quality' | 'grass' | 'dayLength'
            const value = button.dataset.value!
            if (key === 'character') this.settings.set('character', value as CharacterName)
            if (key === 'quality') this.settings.set('quality', value as Quality)
            if (key === 'grass') this.settings.set('grass', value as GrassStyle)
            if (key === 'dayLength') this.settings.set('dayLength', value as DayLength)
            this.refresh()
        })
        this.refresh()
    }

    /** Which graphics card the browser renders with (laptops often default to the integrated one). */
    private gpuName() {
        const gl = this.view.renderer.instance.getContext()
        const info = gl.getExtension('WEBGL_debug_renderer_info')
        const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
        // Firefox reports a representative model per vendor instead of the real one (privacy):
        // every NVIDIA card shows up as "GeForce GTX 980", so name the vendor only
        if (/nvidia|geforce|quadro/i.test(name)) return 'NVIDIA graphics (dedicated)'
        if (/radeon|amd/i.test(name)) return 'AMD graphics'
        if (/intel/i.test(name)) return 'Intel graphics (integrated)'
        return name.replace(/^ANGLE \(([^,]+), /, '').replace(/\s*\(.*$|,.*$/, '').trim()
    }

    private section(key: string, title: string, options: Record<string, string>) {
        const buttons = Object.entries(options)
            .map(([value, label]) => `<button data-key="${key}" data-value="${value}">${label}</button>`)
            .join('')
        return `<section><h3>${title}</h3><div class="menu-options">${buttons}</div></section>`
    }

    private refresh() {
        for (const button of this.panel.querySelectorAll<HTMLButtonElement>('button[data-key]')) {
            const key = button.dataset.key as 'character' | 'quality' | 'grass' | 'dayLength'
            const selected = this.settings.get(key) === button.dataset.value
            button.classList.toggle('is-selected', selected)
            button.setAttribute('aria-pressed', String(selected))
        }
        const lowChanged = (this.settings.get('quality') === 'low') !== (this.startQuality === 'low')
        this.panel.querySelector<HTMLElement>('[data-note]')!.hidden = !lowChanged
    }

    toggle() {
        this.open = !this.open
        this.panel.hidden = !this.open
        this.element.classList.toggle('is-open', this.open)
    }

    update() {
        const player = this.state.player
        this.breath.hidden = !(player.diving || player.breath < 0.999)
        if (!this.breath.hidden) {
            const bar = this.breath.querySelector('.breath-bar span') as HTMLElement
            bar.style.width = `${Math.round(player.breath * 100)}%`
            this.breath.classList.toggle('low', player.breath < 0.25)
        }

        // clock: 0 = noon on the day cycle
        const hour = this.state.day.hour
        const minutes = Math.floor(hour * 60) % 60
        const text = `${String(Math.floor(hour)).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
        if (this.clock.dataset.time !== text) {
            this.clock.dataset.time = text
            const night = hour < 6 || hour >= 19
            this.clock.innerHTML = `<span aria-hidden="true">${night ? '☾' : '☀'}</span> ${text}`
        }

        // free camera: what the keys do, and the cruising speed
        const camera = this.state.player.camera
        const flying = camera.mode === 2
        this.flyHint.hidden = !flying
        if (flying) {
            const text = `Free camera · WASD fly · Space up · C down · Shift fast · wheel speed ${Math.round(camera.fly.speed)} m/s · V back`
            if (this.flyHint.textContent !== text)
                this.flyHint.textContent = text
        }

        this.frames++
        this.elapsed += this.state.time.delta
        if (this.elapsed < 0.5)
            return
        if (this.open) {
            const canvas = this.view.renderer.instance.domElement
            const scale = this.view.renderer.adaptive.scale
            this.stats.textContent = `${Math.round(this.frames / this.elapsed)} fps · ${canvas.width} × ${canvas.height} px` +
                (scale < 0.999 ? ` (auto ${Math.round(scale * 100)} %)` : '') + ` · ${this.gpu}`
        }
        this.frames = 0
        this.elapsed = 0
    }
}
