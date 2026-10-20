import { EventEmitter } from 'events'
import Game from './Game'
import Settings, { ANTIALIASING, CHARACTERS, DAY_LENGTHS, GRASS_STYLES, MOUSE_LOOK, QUALITIES, RESOLUTIONS, WEATHERS, Antialiasing, CharacterName, DayLength, GrassStyle, MouseLook, Quality, Resolution, Weather } from './Settings'
import State from './State/State'
import View from './View/View'
import Ui from './Ui'

export type Tab = 'game' | 'graphics' | 'sound' | 'sky' | 'world' | 'visuals' | 'player' | 'stats' | 'controls' | 'about'
type Row = { keys: string[], label: string, combo?: boolean }   // combo: pressed together, else any of them
type Group = { title: string, rows: Row[], note?: string }

const CONTROLS: Group[] = [
    {
        title: 'Moving',
        rows: [
            { keys: ['W', 'A', 'S', 'D'], label: 'Move' },
            { keys: ['Shift'], label: 'Sprint (hold)' },
            { keys: ['Space'], label: 'Jump' },
            { keys: ['C'], label: 'Crouch (hold)' },
            { keys: ['Shift', 'C'], label: 'Slide, while sprinting', combo: true }
        ]
    },
    {
        title: 'Climbing',
        note: 'Walk into a slope too steep to stand on to grab hold. A short one (a couple of metres) you scramble up; a tall face you climb with a pair of axes. Stamina drains while you hang on; at the top you pull yourself up.',
        rows: [
            { keys: ['W', 'S'], label: 'Climb up or down' },
            { keys: ['A', 'D'], label: 'Move across the face' },
            { keys: ['Space'], label: 'Lunge up (costs stamina)' },
            { keys: ['S', 'Space'], label: 'Jump away from the face', combo: true },
            { keys: ['C'], label: 'Let go' }
        ]
    },
    {
        title: 'Water',
        note: 'Your air lasts about 30 seconds under water.',
        rows: [
            { keys: ['C'], label: 'Dive (hold)' },
            { keys: ['Space'], label: 'Swim up' }
        ]
    },
    {
        title: 'Tools',
        note: 'Gear is worn as people carried it: the Ranger\'s sword in its scabbard at the left hip, the bow slung on the back, arrows in a quiver at the right hip, the torch behind the belt; the Villager\'s axe in the belt at the right hip, the sickle sheathed at the left hip, the hoe slung on the back. With a tool in hand you still run where you steer (S turns you back toward the camera); drawing the bow keeps you facing the mark: S backs away, A and D step aside. Each press goes on to the next move (the name shows above the toolbar). Only the axe fells trees: 5 to 20 chops, more the thicker the trunk; the tree falls toward the cut. Other tools mark the bark.',
        rows: [
            { keys: ['1', '2', '3'], label: 'Take out a tool (again: put it away)' },
            { keys: ['E'], label: 'Use the tool: the next move each press' },
            { keys: ['Click'], label: 'Use the tool (the bow: hold)' },
            { keys: ['Q'], label: 'Heavy move (right button too)' }
        ]
    },
    {
        title: 'Sword',
        note: 'Real sword motion from the animation library: a slash, a backhand slash, a turning slash and an overhead strike in turn, one each press; a dash strike while running; Q for the two combos.',
        rows: [
            { keys: ['E'], label: 'The next stroke' },
            { keys: ['Shift', 'E'], label: 'Dash strike, while running', combo: true },
            { keys: ['Q'], label: 'A combo; again: the heavy combo' }
        ]
    },
    {
        title: 'Axe, hoe and sickle',
        note: 'Axe: a woodcutter\'s two-handed chop. Sickle: bent to the stalks, a harvest cut. Hoe: dig, draw back, chop, sweep, scrape, pry up; heavy: break the ground. Torch: held up as the animation library holds it; E raises it, Q thrusts or waves the flame (it scorches bark).',
        rows: [
            { keys: ['E'], label: 'The next move' },
            { keys: ['Q'], label: 'Heavy move' }
        ]
    },
    {
        title: 'Camera',
        rows: [
            { keys: ['Mouse'], label: 'Look around (after a click into the game; Esc frees the mouse)' },
            { keys: ['Drag'], label: 'Look around (touch, or with "Drag to look")' },
            { keys: ['P'], label: 'Capture or free the mouse' },
            { keys: ['Wheel'], label: 'Zoom' },
            { keys: ['V'], label: 'Free camera' }
        ]
    },
    {
        title: 'Interface',
        rows: [
            { keys: ['Esc'], label: 'Menu' },
            { keys: ['H'], label: 'Controls' },
            { keys: ['F'], label: 'Full screen' },
            { keys: ['M'], label: 'Mute sound' },
            { keys: ['G'], label: 'Hood up or down (Ranger)' },
            { keys: ['B'], label: 'Developer panel' }
        ]
    }
]

// the pages: what a player sets first, then the developer's tuning pages (dev)
const SECTIONS: { id: Tab, label: string, icon: string, dev?: boolean }[] = [
    { id: 'game', label: 'Game', icon: '<circle cx="12" cy="7.5" r="3.2"/><path d="M5.5 20c.6-3.8 3.2-6 6.5-6s5.9 2.2 6.5 6"/>' },
    { id: 'graphics', label: 'Graphics', icon: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/><path d="m7 13 3.2-3.6 2.4 2.2L17 7.5"/>' },
    { id: 'sound', label: 'Sound', icon: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11"/>' },
    { id: 'sky', label: 'Sky', icon: '<circle cx="9" cy="8.5" r="3"/><path d="M9 2.6v1.3M3.4 8.5H2.1M5 4.5l-.9-.9M13 4.5l.9-.9"/><path d="M8.5 19.5h8.8a3.3 3.3 0 0 0 0-6.6 4.3 4.3 0 0 0-8.2 1.3 2.7 2.7 0 0 0-.6 5.3z"/>' },
    { id: 'controls', label: 'Keys', icon: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/>' },
    { id: 'about', label: 'About', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.01"/>' },
    { id: 'world', label: 'World', icon: '<path d="M2.5 19.5 9 8.5l4 6.3 2.6-3.6 5.9 8.3z"/><circle cx="17" cy="6" r="1.6"/>', dev: true },
    { id: 'visuals', label: 'Visuals', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M12 7.5h4.5M12 12h6.2M12 16.5h4.5"/>', dev: true },
    { id: 'player', label: 'Player', icon: '<circle cx="12" cy="5.8" r="2.4"/><path d="M12 8.6v6.2m0 0-3.4 5.4M12 14.8l3.4 5.4M6.8 11.6h10.4"/>', dev: true },
    { id: 'stats', label: 'Stats', icon: '<path d="M4 19.5V4.5M4 19.5h16"/><path d="m7.5 15 3.3-4 3 2.4 5-6.4"/>', dev: true }
]
const TAB_KEY = 'generate-infinite:menu-tab'

const ICON = {
    gear: '<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2.6-1.5L14.1 2.6h-4.2l-.4 2.4a7.5 7.5 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 2.6 1.5l.4 2.4h4.2l.4-2.4a7.5 7.5 0 0 0 2.6-1.5l2.3.9 2-3.4z"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>'
}
const svg = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`
const keycaps = (keys: string[], combo = false) => `<span class="keycaps">${keys.map((key) => `<kbd>${key}</kbd>`).join(combo ? '<span class="plus">+</span>' : '')}</span>`

/**
 * The game's interface around the view.
 *
 *  - a drawer on the right (gear button or Esc, reopening on the page last used; H opens it
 *    on the controls): Game (character, the Ranger's hood, weather and day length), Graphics,
 *    Sound, Sky, every control grouped by what it's for, about the world; below them the
 *    developer's tuning pages (World, Visuals, Player, Stats)
 *  - the heads-up display: the clock, what the keys do right now (climbing, swimming), the
 *    stamina ring while climbing, the air bar under water, the free camera's keys, and a
 *    one-time pointer to the controls on the first visit
 */
export default class Menu {
    settings: Settings
    state: State
    view: View
    drawer: HTMLElement
    clock: HTMLElement
    flyHint: HTMLElement
    breath: HTMLElement
    hint: HTMLElement
    stamina: HTMLElement
    toast: HTMLElement
    private open = false
    private tab: Tab = 'game'
    events = new EventEmitter()
    private startQuality: Quality
    private gpu: string
    private hintText = ''
    private lastFocus: HTMLElement | null = null

    constructor() {
        this.settings = Settings.getInstance()
        this.state = State.getInstance()
        this.view = View.getInstance()
        this.startQuality = this.settings.get('quality')
        this.gpu = this.gpuName()
        const ui = document.querySelector('.ui')!

        // ── corner buttons ──
        const corner = document.createElement('div')
        corner.className = 'hud-corner'
        corner.innerHTML = `
            <button class="icon-button" data-open="controls" aria-label="Controls" title="Controls (H)">${svg(ICON.keyboard)}</button>
            <button class="icon-button" data-open="game" aria-label="Settings" title="Settings (Esc)">${svg(ICON.gear)}</button>`
        ui.appendChild(corner)
        corner.addEventListener('click', (event) => {
            const button = (event.target as HTMLElement).closest('[data-open]') as HTMLElement | null
            if (button)
                this.show(button.dataset.open as Tab, true)
        })

        // ── the drawer: a rail of pages beside the page ──
        this.drawer = document.createElement('aside')
        this.drawer.className = 'drawer'
        this.drawer.setAttribute('role', 'dialog')
        this.drawer.setAttribute('aria-labelledby', 'drawer-title')
        this.drawer.hidden = true
        this.drawer.innerHTML = `
            <header class="drawer-header">
                <h2 id="drawer-title">Settings</h2>
                <button class="icon-button is-quiet" data-close aria-label="Close" title="Close (Esc)">${svg(ICON.close)}</button>
            </header>
            <div class="drawer-main">
                <nav class="rail" role="tablist" aria-label="Menu" aria-orientation="vertical">
                    ${SECTIONS.map((section, i) =>
                        (section.dev && !SECTIONS[i - 1].dev ? '<span class="rail-label" aria-hidden="true">Developer</span>' : '')
                        + `<button role="tab" id="tab-${section.id}" data-tab="${section.id}" aria-controls="panel-${section.id}"${section.dev ? ' class="is-dev"' : ''}>${svg(section.icon)}<span>${section.label}</span></button>`).join('')}
                </nav>
                <div class="drawer-body">
                    <section class="tab-panel" role="tabpanel" id="panel-game" aria-labelledby="tab-game">
                        <h2 class="panel-title">Game</h2>
                        ${this.field('character', 'Character', CHARACTERS, 'choice-grid')}
                        ${this.field('mouseLook', 'Mouse', MOUSE_LOOK, 'segmented', 'Click to capture: after a click into the game the mouse turns the camera, as in most games; Esc frees it. Drag to look: hold a button and drag.')}
                        <div data-extra="game"></div>
                    </section>
                    <section class="tab-panel" role="tabpanel" id="panel-graphics" aria-labelledby="tab-graphics" hidden>
                        <h2 class="panel-title">Graphics</h2>
                        ${this.field('quality', 'Quality', QUALITIES)}
                        <p class="field-note" data-note hidden>Anti-aliasing changes after a reload.</p>
                        ${this.field('resolution', 'Resolution', RESOLUTIONS, 'segmented', 'Auto lowers it when frames run slow and raises it again when there\'s room.')}
                        ${this.field('antialiasing', 'Anti-aliasing', ANTIALIASING, 'segmented', 'Temporal: steadier edges and grass. SMAA: crisper in fast motion.')}
                        ${this.field('grass', 'Grass', GRASS_STYLES, 'choice-wrap')}
                        <dl class="readout"><div><dt>Graphics card</dt><dd>${this.gpu}</dd></div></dl>
                    </section>
                    <section class="tab-panel" role="tabpanel" id="panel-sound" aria-labelledby="tab-sound" hidden>
                        <h2 class="panel-title">Sound</h2>
                        <div data-extra="sound"></div>
                    </section>
                    ${(['sky', 'world', 'visuals', 'player', 'stats'] as Tab[]).map((id) =>
                        `<section class="tab-panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" hidden><h2 class="panel-title">${SECTIONS.find((section) => section.id === id)!.label}</h2></section>`).join('')}
                    <section class="tab-panel" role="tabpanel" id="panel-controls" aria-labelledby="tab-controls" hidden>
                        <h2 class="panel-title">Keys</h2>
                        ${CONTROLS.map((group) => `
                            <div class="control-group">
                                <h3>${group.title}</h3>
                                <ul>${group.rows.map((row) => `<li><span class="keys">${keycaps(row.keys, row.combo)}</span><span class="label">${row.label}</span></li>`).join('')}</ul>
                                ${group.note ? `<p class="field-note">${group.note}</p>` : ''}
                            </div>`).join('')}
                        <button class="text-button show-keyboard" data-keyboard>Show the on-screen keyboard</button>
                    </section>
                    <section class="tab-panel" role="tabpanel" id="panel-about" aria-labelledby="tab-about" hidden>
                        <h2 class="panel-title">About</h2>
                        <p class="about-lead">An endless landscape generated as you walk: hills, lakes, forests and mountains grown from a seed, with a full day and night, weather and living grass.</p>
                        <dl class="readout">
                            <div><dt>World seed</dt><dd>${this.escape(Game.getInstance().seed)}</dd></div>
                        </dl>
                        <p class="about-credit">Created for saruma.</p>
                        <h3>Made with</h3>
                        <ul class="credits">
                            <li>Characters and animations: <a href="https://quaternius.com" target="_blank" rel="noopener">Quaternius</a> (CC0)</li>
                            <li>Terrain, bark, rocks and ferns: <a href="https://polyhaven.com" target="_blank" rel="noopener">Poly Haven</a>, <a href="https://www.texturecan.com" target="_blank" rel="noopener">TextureCan</a> (CC0)</li>
                            <li>Trees: <a href="https://github.com/dgreenheck/ez-tree" target="_blank" rel="noopener">EZ-Tree</a> by Daniel Greenheck (MIT)</li>
                            <li>Rendering: <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a>, postprocessing, N8AO</li>
                        </ul>
                        <a class="text-button" href="https://github.com/ibra-kdbra/Generate_infinite" target="_blank" rel="noopener">Source on GitHub</a>
                    </section>
                </div>
            </div>
            <footer class="drawer-footer"><span><kbd>Esc</kbd> close</span><span><kbd>H</kbd> keys</span><span><kbd>M</kbd> mute</span><span><kbd>B</kbd> stats</span></footer>`
        ui.appendChild(this.drawer)

        this.drawer.querySelector('[data-close]')!.addEventListener('click', () => this.hide())
        const rail = this.drawer.querySelector('.rail')!
        rail.addEventListener('click', (event) => {
            const tab = (event.target as HTMLElement).closest('[data-tab]') as HTMLElement | null
            if (tab) this.select(tab.dataset.tab as Tab)
        })
        rail.addEventListener('keydown', (event) => {
            const e = event as KeyboardEvent
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const ids = SECTIONS.map((section) => section.id)
            const next = ids[(ids.indexOf(this.tab) + (e.key === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length]
            this.select(next)
            this.drawer.querySelector<HTMLElement>(`#tab-${next}`)!.focus()
        })
        this.drawer.querySelector('[data-keyboard]')!.addEventListener('click', () => {
            this.hide()
            document.querySelector<HTMLInputElement>('.keyboard-input')?.focus()
        })
        this.drawer.querySelector('.drawer-body')!.addEventListener('click', (event) => {
            const button = (event.target as HTMLElement).closest('button[data-key]') as HTMLButtonElement | null
            if (!button)
                return
            const key = button.dataset.key as 'character' | 'quality' | 'grass' | 'resolution' | 'antialiasing' | 'mouseLook'
            const value = button.dataset.value!
            if (key === 'character') this.settings.set('character', value as CharacterName)
            if (key === 'quality') this.settings.set('quality', value as Quality)
            if (key === 'grass') this.settings.set('grass', value as GrassStyle)
            if (key === 'resolution') this.settings.set('resolution', value as Resolution)
            if (key === 'antialiasing') this.settings.set('antialiasing', value as Antialiasing)
            if (key === 'mouseLook') this.settings.set('mouseLook', value as MouseLook)
            this.refresh()
        })
        // mouse look by capture: Esc frees the mouse (the browser takes that key) and pauses in the menu
        let locked = false, freedAt = - Infinity
        document.addEventListener('pointerlockchange', () => {
            const now = !!document.pointerLockElement
            if (locked && !now && !this.open && !this.state.viewport.pointerLock.releasing && this.settings.get('mouseLook') === 'capture') {
                freedAt = performance.now()
                this.show(this.tab)
            }
            locked = now
        })
        window.addEventListener('keydown', (event) => {
            if (event.code === 'Escape' && performance.now() - freedAt < 400)
                return          // the same Esc that freed the mouse (and opened the menu)
            const typing = (event.target as HTMLElement)?.matches?.('input[type="text"], textarea') && !(event.target as HTMLElement).classList.contains('keyboard-input')
            if (event.code === 'Escape') {
                if (this.open) this.hide()
                else this.show(this.tab, true)
            }
            else if (event.code === 'KeyH' && !typing && !event.repeat) {
                if (this.open && this.tab === 'controls') this.hide()
                else this.show('controls', true)
            }
        })

        // ── heads-up display ──
        this.clock = this.element('clock')
        this.flyHint = this.element('fly-hint', true)
        this.hint = this.element('context-hint', true)
        this.hint.setAttribute('aria-live', 'polite')
        this.breath = this.element('breath', true)
        this.breath.innerHTML = '<span class="breath-label">Air</span><span class="breath-bar"><span></span></span>'
        this.stamina = this.element('stamina', true)
        this.stamina.setAttribute('role', 'img')
        this.stamina.innerHTML = '<svg viewBox="0 0 44 44" aria-hidden="true"><circle class="stamina-track" cx="22" cy="22" r="17"/><circle class="stamina-fill" cx="22" cy="22" r="17" pathLength="100"/></svg>'
        this.toast = this.element('toast', true)
        this.toast.innerHTML = 'Press <kbd>H</kbd> for the controls, <kbd>Esc</kbd> for settings'
        try {
            if (!localStorage.getItem('generate-infinite:seen-controls')) {
                this.toast.hidden = false
                setTimeout(() => this.toast.classList.add('is-leaving'), 7000)
                setTimeout(() => { this.toast.hidden = true }, 7600)
                localStorage.setItem('generate-infinite:seen-controls', '1')
            }
        }
        catch { /* storage blocked: no tip */ }

        const kit = new Ui()
        // the Ranger's hood (only the Rangers wear one)
        const character = kit.group(this.drawer.querySelector<HTMLElement>('[data-extra="game"]')!, 'Appearance')
        const mouse = kit.group(this.drawer.querySelector<HTMLElement>('[data-extra="game"]')!, 'Mouse')
        kit.slider(mouse, { label: 'Sensitivity', min: 0.1, max: 3, step: 0.05, get: () => this.settings.get('mouseSpeed'), set: (v) => this.settings.set('mouseSpeed', v), format: (v) => `${v.toFixed(2)}×` })
        kit.toggle(character, 'Hood up', () => this.settings.get('hood'), (on) => this.settings.set('hood', on), 'Ranger only · G')
        const showHood = () => { character.parentElement!.hidden = !this.settings.get('character').includes('ranger') }
        showHood()
        this.settings.events.on('change:character', showHood)
        this.settings.events.on('change:hood', () => kit.refresh())

        // the world's weather and day, the ones players change most (the Sky page has the rest)
        const world = kit.group(this.drawer.querySelector<HTMLElement>('[data-extra="game"]')!, 'World', 'Time of day, clouds and wind are on the Sky page.')
        kit.choice(world, WEATHERS, () => this.settings.get('weather'), (value: Weather) => {
            this.settings.set('weather', value)
            this.view.sky.cloudCoverOverride = null
        }, 'Weather', true)
        kit.choice(world, DAY_LENGTHS, () => this.settings.get('dayLength'), (value: DayLength) => this.settings.set('dayLength', value), 'Length of a day')
        this.settings.events.on('change:weather', () => kit.refresh())
        this.settings.events.on('change:dayLength', () => kit.refresh())

        // sound
        const sound = kit.group(this.drawer.querySelector<HTMLElement>('[data-extra="sound"]')!, 'Volume', 'All of it is made as you play. M mutes and unmutes.')
        const percent = (v: number) => v === 0 ? 'Off' : `${Math.round(v * 100)} %`
        kit.toggle(sound, 'Mute', () => this.settings.get('muted'), (on) => this.settings.set('muted', on))
        kit.slider(sound, { label: 'Volume', min: 0, max: 1, step: 0.01, get: () => this.settings.get('volume'), set: (v) => this.settings.set('volume', v), format: percent })
        const channels: [string, 'volumeAmbience' | 'volumeNature' | 'volumeBody' | 'volumeTools' | 'volumeWeather'][] = [
            ['Wind', 'volumeAmbience'], ['Birds, crickets and animals', 'volumeNature'], ['Footsteps and water', 'volumeBody'], ['Tools and hits', 'volumeTools'], ['Rain and thunder', 'volumeWeather']
        ]
        const mix = kit.group(this.drawer.querySelector<HTMLElement>('[data-extra="sound"]')!, 'Mix')
        for (const [label, key] of channels)
            kit.slider(mix, { label, min: 0, max: 1, step: 0.01, get: () => this.settings.get(key), set: (v) => this.settings.set(key, v), format: percent })
        kit.buttons(mix, [['Reset the mix', () => {
            for (const [, key] of channels) this.settings.reset(key)
            this.settings.reset('volume')
            kit.refresh()
        }]])
        this.settings.events.on('change:muted', () => kit.refresh())
        this.events.on('show', () => kit.refresh())

        for (const key of ['character', 'quality', 'grass', 'resolution', 'antialiasing', 'mouseLook'])
            this.settings.events.on(`change:${key}`, () => this.refresh())
        let remembered: Tab = 'game'
        try {
            const stored = localStorage.getItem(TAB_KEY) as Tab | null
            if (stored && SECTIONS.some((section) => section.id === stored)) remembered = stored
        }
        catch { /* storage blocked */ }
        this.select(remembered)
        this.refresh()
    }

    private element(className: string, hidden = false) {
        const element = document.createElement('div')
        element.className = className
        element.hidden = hidden
        document.querySelector('.ui')!.appendChild(element)
        return element
    }

    private escape(text: string) {
        return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    }

    /** Which graphics card the browser renders with (laptops often default to the integrated one). */
    private gpuName() {
        const gl = this.view.renderer.instance.getContext()
        const info = gl.getExtension('WEBGL_debug_renderer_info')
        const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
        // Firefox reports a representative model per vendor instead of the real one (privacy):
        // every NVIDIA card shows up as "GeForce GTX 980", so name the vendor only
        if (/nvidia|geforce|quadro/i.test(name)) return 'NVIDIA (dedicated)'
        if (/radeon|amd/i.test(name)) return 'AMD'
        if (/intel/i.test(name)) return 'Intel (integrated)'
        return name.replace(/^ANGLE \(([^,]+), /, '').replace(/\s*\(.*$|,.*$/, '').trim()
    }

    private field(key: string, title: string, options: Record<string, string>, layout = 'segmented', note = '') {
        const buttons = Object.entries(options)
            .map(([value, label]) => `<button data-key="${key}" data-value="${value}">${label}</button>`)
            .join('')
        return `<div class="field"><h3 id="field-${key}">${title}</h3><div class="${layout}" role="group" aria-labelledby="field-${key}">${buttons}</div>${note ? `<p class="field-note">${note}</p>` : ''}</div>`
    }

    private refresh() {
        for (const button of this.drawer.querySelectorAll<HTMLButtonElement>('button[data-key]')) {
            const key = button.dataset.key as 'character' | 'quality' | 'grass' | 'resolution' | 'antialiasing' | 'mouseLook'
            const selected = this.settings.get(key) === button.dataset.value
            button.classList.toggle('is-selected', selected)
            button.setAttribute('aria-pressed', String(selected))
        }
        const lowChanged = (this.settings.get('quality') === 'low') !== (this.startQuality === 'low')
        this.drawer.querySelector<HTMLElement>('[data-note]')!.hidden = !lowChanged
    }

    private select(tab: Tab) {
        // a page that doesn't exist (an old link, a stale name) opens the first one, never an empty drawer
        if (!SECTIONS.some((section) => section.id === tab))
            tab = 'game'
        this.tab = tab
        try { localStorage.setItem(TAB_KEY, tab) }
        catch { /* storage blocked */ }
        for (const button of this.drawer.querySelectorAll<HTMLElement>('[role="tab"]')) {
            const selected = button.dataset.tab === tab
            button.setAttribute('aria-selected', String(selected))
            button.tabIndex = selected ? 0 : - 1
        }
        for (const panel of this.drawer.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
            panel.hidden = panel.id !== `panel-${tab}`
        this.drawer.querySelector('.drawer-body')!.scrollTop = 0
        if (this.open)
            this.events.emit('show', tab)
    }

    /** A page of the drawer, for others to fill (Debug.ts). */
    panel(tab: Tab) {
        return this.drawer.querySelector<HTMLElement>(`#panel-${tab}`)!
    }

    get isOpen() {
        return this.open
    }

    get currentTab() {
        return this.tab
    }

    show(tab: Tab, focus = false) {
        this.select(tab)
        if (!this.open) {
            this.open = true
            this.events.emit('show', tab)
            this.lastFocus = document.activeElement as HTMLElement | null
            this.drawer.hidden = false
            document.querySelector('.ui')!.classList.add('has-drawer')
            requestAnimationFrame(() => this.drawer.classList.add('is-open'))
            // the cursor is needed in the menu
            if (document.pointerLockElement)
                document.exitPointerLock()
        }
        this.toast.hidden = true
        if (focus)
            this.drawer.querySelector<HTMLElement>(`#tab-${tab}`)?.focus({ preventScroll: true })
    }

    hide() {
        if (!this.open)
            return
        this.open = false
        this.drawer.classList.remove('is-open')
        document.querySelector('.ui')!.classList.remove('has-drawer')
        setTimeout(() => { if (!this.open) this.drawer.hidden = true }, 220)
        // the keys go back to the game
        if (this.lastFocus && this.lastFocus !== document.body && !this.drawer.contains(this.lastFocus)) this.lastFocus.focus?.({ preventScroll: true })
        else (document.activeElement as HTMLElement | null)?.blur()
    }

    toggle(tab: Tab = this.tab) {
        if (this.open && this.tab === tab) this.hide()
        else this.show(tab, true)
    }

    /** What the keys do right now, for the hint above the tools. */
    private contextHint() {
        const player = this.state.player
        if (player.camera.mode === 2)
            return ''
        if (player.climbing)
            return [`${keycaps(['W', 'S'])} climb`, `${keycaps(['A', 'D'])} across`, `${keycaps(['Space'])} lunge`, `${keycaps(['C'])} let go`].map((item) => `<span class="hint-item">${item}</span>`).join('')
        if (player.diving)
            return [`${keycaps(['Space'])} swim up`, `${keycaps(['C'])} dive deeper`].map((item) => `<span class="hint-item">${item}</span>`).join('')
        if (player.swimming)
            return [`${keycaps(['C'])} dive`, `${keycaps(['Shift'])} swim faster`].map((item) => `<span class="hint-item">${item}</span>`).join('')
        return ''
    }

    update() {
        const player = this.state.player

        // air while diving
        this.breath.hidden = !(player.diving || player.breath < 0.999)
        if (!this.breath.hidden) {
            const bar = this.breath.querySelector('.breath-bar span') as HTMLElement
            bar.style.transform = `scaleX(${player.breath.toFixed(3)})`
            this.breath.classList.toggle('is-low', player.breath < 0.25)
        }

        // stamina: shown while it's being used or refilling
        const showStamina = player.climbing || player.mantle !== null || player.stamina < 0.995
        this.stamina.hidden = !showStamina
        if (showStamina) {
            const fill = this.stamina.querySelector('.stamina-fill') as SVGCircleElement
            fill.style.strokeDashoffset = String(100 - player.stamina * 100)
            this.stamina.classList.toggle('is-low', player.stamina < 0.3)
            this.stamina.classList.toggle('is-exhausted', player.exhausted)
            this.stamina.setAttribute('aria-label', `Stamina ${Math.round(player.stamina * 100)} %`)
        }

        // what the keys do now
        const hint = this.contextHint()
        if (hint !== this.hintText) {
            this.hintText = hint
            this.hint.innerHTML = hint
            this.hint.hidden = !hint
        }

        // clock: 0 = noon on the day cycle
        const hour = this.state.day.hour
        const minutes = Math.floor(hour * 60) % 60
        const text = `${String(Math.floor(hour)).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
        if (this.clock.dataset.time !== text) {
            this.clock.dataset.time = text
            const night = hour < 6 || hour >= 19
            this.clock.innerHTML = `<span class="clock-icon" aria-hidden="true">${night ? '☾' : '☀'}</span><span>${text}</span>`
        }

        // free camera: what the keys do, and the cruising speed
        const camera = player.camera
        const flying = camera.mode === 2
        this.flyHint.hidden = !flying
        if (flying) {
            const text = ['<strong>Free camera</strong>', `${keycaps(['W', 'A', 'S', 'D'])} fly`, `${keycaps(['Space'])} up`, `${keycaps(['C'])} down`, `${keycaps(['Shift'])} fast`, `wheel ${Math.round(camera.fly.speed)} m/s`, `${keycaps(['V'])} back`]
                .map((item) => `<span class="hint-item">${item}</span>`).join('')
            if (this.flyHint.dataset.text !== text) {
                this.flyHint.dataset.text = text
                this.flyHint.innerHTML = text
            }
        }

    }
}
