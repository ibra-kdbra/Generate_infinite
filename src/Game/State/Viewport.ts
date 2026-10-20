import Game from '../Game'
import State from './State'
import Controls from './Controls'
import Settings from '../Settings'

export default class Viewport {
    game: Game
    state: State
    controls: Controls
    domElement: HTMLElement
    width: number | null
    height: number | null
    smallestSide: number | null
    biggestSide: number | null
    pixelRatio: number | null
    clampedPixelRatio: number | null
    pointerLock: {
        active: boolean
        releasing: boolean          // freed on purpose (P, the menu), not by Esc
        toggle: () => void
        activate: () => void
        deactivate: () => void
    }
    fullscreen: {
        active: boolean
        toggle: () => void
        activate: () => void
        deactivate: () => void
    }

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()
        this.controls = this.state.controls
        this.domElement = this.game.domElement as HTMLElement

        this.width = null
        this.height = null
        this.smallestSide = null
        this.biggestSide = null
        this.pixelRatio = null
        this.clampedPixelRatio = null

        this.pointerLock = {
            active: false,
            releasing: false,
            toggle: () => { },
            activate: () => { },
            deactivate: () => { }
        }

        this.fullscreen = {
            active: false,
            toggle: () => { },
            activate: () => { },
            deactivate: () => { }
        }

        this.setPointerLock()
        this.setFullscreen()

        this.controls.events.on('pointerLockDown', () => {
            this.pointerLock.toggle()
        })

        this.controls.events.on('fullscreenDown', () => {
            this.fullscreen.toggle()
        })

        this.resize()
    }

    setPointerLock() {
        this.pointerLock.active = false

        this.pointerLock.toggle = () => {
            if (this.pointerLock.active)
                this.pointerLock.deactivate()
            else
                this.pointerLock.activate()
        }

        this.pointerLock.activate = () => {
            // the mouse's own movement, without the system's pointer acceleration, where the
            // browser offers it (Chrome); else as the system moves the pointer. (Refused for a
            // moment after Esc frees it; the next click tries again.)
            const element = this.domElement as HTMLElement & { requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void }
            try {
                const request = element.requestPointerLock({ unadjustedMovement: true }) as unknown
                if (request instanceof Promise)
                    request.catch(() => { (element.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => { }) })
            }
            catch {
                element.requestPointerLock()
            }
        }

        this.pointerLock.deactivate = () => {
            this.pointerLock.releasing = true
            document.exitPointerLock()
        }

        document.addEventListener('pointerlockchange', () => {
            this.pointerLock.active = !!document.pointerLockElement
            if (!this.pointerLock.active)
                setTimeout(() => { this.pointerLock.releasing = false }, 0)
        })
    }

    setFullscreen() {
        this.fullscreen.active = false

        this.fullscreen.toggle = () => {
            if (this.fullscreen.active)
                this.fullscreen.deactivate()
            else
                this.fullscreen.activate()
        }

        this.fullscreen.activate = () => {
            this.domElement.requestFullscreen()
        }

        this.fullscreen.deactivate = () => {
            document.exitFullscreen()
        }

        document.addEventListener('fullscreenchange', () => {
            this.fullscreen.active = !!document.fullscreenElement
        })
    }

    /**
     * How far the mouse turns the camera (radians): a drag across the window's smaller side
     * turns it about 2 radians; a captured mouse turns it by its own counts (0.01° a count:
     * 10 cm turns about 30° at 800 DPI, 55° at 1600), the same for any window size. Both
     * scaled by the sensitivity setting.
     */
    look(pixelCoordinates: { x: number; y: number }) {
        const speed = Settings.getInstance().get('mouseSpeed')
        if (this.pointerLock.active)
            return { x: pixelCoordinates.x * 0.00018 * speed, y: pixelCoordinates.y * 0.00018 * speed }
        const normalised = this.normalise(pixelCoordinates)
        return { x: normalised.x * 2 * speed, y: normalised.y * 2 * speed }
    }

    normalise(pixelCoordinates: { x: number; y: number }) {
        const minSize = Math.min(this.width!, this.height!)
        return {
            x: pixelCoordinates.x / minSize,
            y: pixelCoordinates.y / minSize,
        }
    }

    resize() {
        this.width = window.innerWidth
        this.height = window.innerHeight
        this.smallestSide = this.width < this.height ? this.width : this.height
        this.biggestSide = this.width > this.height ? this.width : this.height
        this.pixelRatio = window.devicePixelRatio
        this.clampedPixelRatio = Math.min(this.pixelRatio, 2)
    }
}
