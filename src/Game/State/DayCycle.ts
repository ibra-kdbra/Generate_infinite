import Game from '../Game'
import State from './State'
import Settings, { DayLength } from '../Settings'

export default class DayCycle {
    game: Game
    state: State
    autoUpdate: boolean
    timeProgress: number
    progress: number
    duration: number

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()

        // progress: 0 noon, 0.25 sunset (18:00), 0.5 midnight, 0.75 sunrise (06:00)
        this.autoUpdate = true
        this.timeProgress = DayCycle.progressForHour(10)    // start mid-morning
        this.progress = this.timeProgress
        this.duration = 1200
        const settings = Settings.getInstance()
        this.applyDayLength(settings.get('dayLength'))
        settings.events.on('change:dayLength', (length: DayLength) => this.applyDayLength(length))
    }

    static progressForHour(hour: number) {
        return (((hour - 12) / 24) % 1 + 1) % 1
    }

    /** Time of day in hours, 0..24. */
    get hour() {
        return (12 + this.progress * 24) % 24
    }

    private applyDayLength(length: DayLength) {
        // seconds for a full day and night
        this.autoUpdate = length !== 'frozen'
        if (length !== 'frozen')
            this.duration = Number(length) * 60
    }

    update() {
        const time = this.state.time

        if (this.autoUpdate) {
            this.timeProgress += time.delta / this.duration
            this.progress = this.timeProgress % 1
        }
    }

}
