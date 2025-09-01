import Debug from './Debug/Debug'
import State from './State/State'
import View from './View/View'

export default class Game {
    static instance: Game

    seed!: string
    debug!: Debug
    state!: State
    view!: View

    static getInstance() {
        return Game.instance
    }

    domElement!: Element

    constructor(gameElement: Element) {
        if (Game.instance) {
            return Game.instance
        }

        Game.instance = this
        this.domElement = gameElement

        this.seed = 'p'
        
        // Ensure modules are created before they are needed by others
        this.debug = new Debug()
        this.state = new State()
        this.view = new View()

        // This line now works correctly because the View and Renderer have been fully constructed
        if (this.view && this.view.renderer && this.view.renderer.instance) {
            this.domElement.append(this.view.renderer.instance.domElement)
        }
        
        window.addEventListener('resize', () => {
            this.resize()
        })

        this.update()
    }

    update() {
        this.state.update()
        this.view.update()

        window.requestAnimationFrame(() => {
            this.update()
        })
    }

    resize() {
        this.state.resize()
        this.view.resize()
    }

    destroy() {

    }
}