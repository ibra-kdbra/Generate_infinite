import Debug from './Debug/Debug'
import State from './State/State'
import View from './View/View'
import Menu from './Menu'
import Loading from './Loading'
import Settings from './Settings'

// frames a second while the window is in the background (seen, but not being played)
const BACKGROUND_RATE = 20

export default class Game {
    static instance: Game

    seed!: string
    debug!: Debug
    state!: State
    view!: View
    menu!: Menu
    loading!: Loading

    static getInstance() {
        return Game.instance
    }

    domElement!: Element
    private nextFrame = 0

    constructor(gameElement: Element) {
        if (Game.instance) {
            return Game.instance
        }

        Game.instance = this
        this.domElement = gameElement

        // the world: ?seed=... in the address (the developer panel can change it)
        this.seed = new URLSearchParams(location.search).get('seed') || 'p'
        
        // the state first: the view reads it as it's built
        this.state = new State()
        this.view = new View()

        if (this.view && this.view.renderer && this.view.renderer.instance) {
            this.domElement.append(this.view.renderer.instance.domElement)
        }
        
        this.menu = new Menu()
        this.debug = new Debug(this)
        this.loading = new Loading(this)

        window.addEventListener('resize', () => {
            this.resize()
        })

        this.update()
    }

    /** The most frames a second now: the setting, fewer in the background (0: every frame the screen shows). */
    get frameRate() {
        const setting = Settings.getInstance().get('frameRate')
        const rate = setting === 'display' ? 0 : Number(setting)
        return document.hasFocus() ? rate : Math.min(rate || BACKGROUND_RATE, BACKGROUND_RATE)
    }

    update() {
        window.requestAnimationFrame(() => {
            this.update()
        })

        // capped: skip the screen's frames until the next one is due (a 144 Hz screen at 60:
        // two in five frames are drawn, alternately after 2 and 3 of its frames)
        const rate = this.frameRate
        if (rate) {
            const now = performance.now()
            const interval = 1000 / rate
            // (2 ms early is on time: the screen's frames don't fall exactly on the schedule)
            if (now < this.nextFrame - 2)
                return
            this.nextFrame += interval
            // behind (a stall, the first frame): the schedule starts again from now
            if (this.nextFrame < now)
                this.nextFrame = now + interval
        }

        this.state.update()
        this.view.update()
        this.menu?.update()
        this.debug?.update()
        this.loading?.update()
    }

    resize() {
        this.state.resize()
        this.view.resize()
    }
}