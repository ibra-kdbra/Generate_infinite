import Game from '../Game'
import State from './State'
import Debug from '../Debug/Debug'

export default class DayCycle {
    game: Game
    state: State
    debug: Debug
    autoUpdate: boolean
    timeProgress: number
    progress: number
    duration: number

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()
        this.debug = Debug.getInstance()

        this.autoUpdate = true
        this.timeProgress = 0
        this.progress = 0
        this.duration = 15 // Seconds

        this.setDebug()
    }

    update() {
        const time = this.state.time

        if (this.autoUpdate) {
            this.timeProgress += time.delta / this.duration
            this.progress = this.timeProgress % 1
        }
    }

    setDebug() {
        if (!this.debug.active)
            return

        const folder = this.debug.ui.getFolder('state/dayCycle')

        folder
            .add(this, 'autoUpdate')

        folder
            .add(this, 'progress')
            .min(0)
            .max(1)
            .step(0.001)

        folder
            .add(this, 'duration')
            .min(5)
            .max(100)
            .step(1)
    }
}
