import { vec3 } from 'gl-matrix'

import Game from '../Game'
import State from './State'

const VERSION = 1
const EVERY = 10              // seconds between saves (and when the page is left)

type Saved = {
    version: number
    player: { x: number, y: number, z: number, rotation: number }
    day: number               // DayCycle progress
    removed: string[]         // plants taken out for good (State/Vegetation keys)
    stumps: [string, number][] // felled trees: their stumps' heights
}

/**
 * The world remembered between visits (in this browser, per seed): where the player is, the
 * time of day, and what was changed in it: the plants cut down and the trees felled, whose
 * stumps stand where they were. Saved every few seconds and when the page is left; read
 * once, when the world is made. Without storage (a private window, blocked site data) the
 * world simply starts fresh each time.
 */
export default class WorldSave {
    state: State
    private key: string
    private timer = EVERY
    private enabled = true

    constructor() {
        this.state = State.getInstance()
        this.key = `generate-infinite:world:${Game.getInstance().seed}`
        this.restore()
        const leave = () => this.save()
        window.addEventListener('pagehide', leave)
        document.addEventListener('visibilitychange', () => { if (document.hidden) leave() })
    }

    update() {
        this.timer -= this.state.time.delta
        if (this.timer <= 0) {
            this.timer = EVERY
            this.save()
        }
    }

    /** Forget this world: it starts fresh on the next visit (the menu reloads the page). */
    forget() {
        this.enabled = false
        try { localStorage.removeItem(this.key) }
        catch { /* storage blocked */ }
    }

    private restore() {
        let saved: Saved | null = null
        try {
            const text = localStorage.getItem(this.key)
            saved = text ? JSON.parse(text) as Saved : null
        }
        catch { saved = null }
        if (!valid(saved))
            return
        const { player, day, vegetation } = this.state
        const p = player.position.current
        p[0] = saved.player.x
        p[1] = saved.player.y
        p[2] = saved.player.z
        vec3.copy(player.position.previous, p)
        player.rotation = saved.player.rotation
        if (day.autoUpdate)
            day.timeProgress = day.progress = saved.day
        vegetation.restore(saved.removed, saved.stumps)
    }

    private save() {
        if (!this.enabled)
            return
        const { player, day, vegetation } = this.state
        const p = player.position.current
        // not from the air, the water's depths or a climb: the last firm footing will do
        if (!player.grounded && !player.swimming)
            return
        const memory = vegetation.memory()
        const saved: Saved = {
            version: VERSION,
            player: { x: p[0], y: p[1], z: p[2], rotation: player.rotation },
            day: day.timeProgress % 1,
            removed: memory.removed,
            stumps: memory.stumps
        }
        try { localStorage.setItem(this.key, JSON.stringify(saved)) }
        catch { /* storage full or blocked */ }
    }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A save as written by this version: anything else (an older format, a damaged or edited entry) starts the world fresh rather than putting the player at NaN. */
function valid(saved: unknown): saved is Saved {
    if (!saved || typeof saved !== 'object')
        return false
    const s = saved as Saved
    const p = s.player
    return s.version === VERSION
        && !!p && finite(p.x) && finite(p.y) && finite(p.z) && finite(p.rotation)
        && Math.abs(p.x) < 1e7 && Math.abs(p.z) < 1e7 && Math.abs(p.y) < 1e5
        && finite(s.day)
        && Array.isArray(s.removed) && s.removed.every((key) => typeof key === 'string')
        && Array.isArray(s.stumps) && s.stumps.every((stump) => Array.isArray(stump) && typeof stump[0] === 'string' && finite(stump[1]))
}
