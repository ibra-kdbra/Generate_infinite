import Stats from './Stats'
import UI from './UI'

export default class Debug {
    static instance: Debug

    ui!: UI
    stats!: Stats
    active: boolean = false

    static getInstance() {
        return Debug.instance
    }

    constructor() {
        if (Debug.instance) {
            return Debug.instance
        }

        Debug.instance = this

        if (location.hash === '#debug') {
            this.activate()
        }
    }

    activate() {
        if (this.active) {
            return
        }

        this.active = true
        this.ui = new UI()
        this.stats = new Stats()
    }
}
