import Time from './Time'
import Controls from './Controls'
import Viewport from './Viewport'
import DayCycle from './DayCycle'
import Sun from './Sun'
import Player from './Player'
import Terrains from './Terrains'
import Chunks from './Chunks'

export default class State {
    static instance: State

    time!: Time
    controls!: Controls
    viewport!: Viewport
    day!: DayCycle
    sun!: Sun
    player!: Player
    terrains!: Terrains
    chunks!: Chunks

    static getInstance() {
        return State.instance
    }

    constructor() {
        if (State.instance) {
            return State.instance
        }

        State.instance = this

        this.time = new Time()
        this.controls = new Controls()
        this.viewport = new Viewport()
        this.day = new DayCycle()
        this.sun = new Sun()
        this.player = new Player()
        this.terrains = new Terrains()
        this.chunks = new Chunks()
    }

    resize() {
        this.viewport.resize()
    }

    update() {
        this.time.update()
        this.controls.update()
        this.day.update()
        this.sun.update()
        this.player.update()
        this.chunks.update()
    }
}
