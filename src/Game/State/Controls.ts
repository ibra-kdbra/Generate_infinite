import { EventEmitter } from 'events'

import Game from '../Game'
import State from './State'

interface KeyMapItem {
    codes: string[]
    name: string
}

export default class Controls {
    game: Game
    state: State
    events: EventEmitter
    keys: {
        map: KeyMapItem[]
        down: { [key: string]: boolean }
        findPerCode: (key: string) => KeyMapItem | undefined
    }
    pointer: {
        down: boolean
        deltaTemp: { x: number; y: number }
        delta: { x: number; y: number }
    }
    showKeyboardButton: HTMLButtonElement | null
    keyboardInput: HTMLInputElement | null

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()

        this.events = new EventEmitter()

        this.keys = {
            map: [],
            down: {},
            findPerCode: () => undefined
        }

        this.pointer = {
            down: false,
            deltaTemp: { x: 0, y: 0 },
            delta: { x: 0, y: 0 }
        }

        this.showKeyboardButton = document.querySelector('.show-keyboard')
        this.keyboardInput = document.querySelector('.keyboard-input')

        this.setKeys()
        this.setPointer()
        this.setMobile()

        // B toggles the developer panel (Debug/Debug.ts listens for 'debugDown')
    }

    setKeys() {
        // Map
        this.keys.map = [
            {
                codes: ['ArrowUp', 'KeyW'],
                name: 'forward'
            },
            {
                codes: ['ArrowRight', 'KeyD'],
                name: 'strafeRight'
            },
            {
                codes: ['ArrowDown', 'KeyS'],
                name: 'backward'
            },
            {
                codes: ['ArrowLeft', 'KeyA'],
                name: 'strafeLeft'
            },
            {
                codes: ['ShiftLeft', 'ShiftRight'],
                name: 'boost'
            },
            {
                codes: ['KeyP'],
                name: 'pointerLock'
            },
            {
                codes: ['KeyV'],
                name: 'cameraMode'
            },
            {
                codes: ['KeyB'],
                name: 'debug'
            },
            {
                codes: ['KeyF'],
                name: 'fullscreen'
            },
            {
                codes: ['Space'],
                name: 'jump'
            },
            {
                codes: ['KeyC'],    // not Ctrl: Ctrl+W closes the browser tab
                name: 'crouch'
            },
            { codes: ['Digit1', 'Numpad1'], name: 'tool1' },
            { codes: ['Digit2', 'Numpad2'], name: 'tool2' },
            { codes: ['Digit3', 'Numpad3'], name: 'tool3' },
            { codes: ['KeyE'], name: 'use' },
            { codes: ['KeyQ'], name: 'heavy' },
            { codes: ['KeyG'], name: 'hood' },
        ]

        // Down keys
        this.keys.down = {}

        for (const mapItem of this.keys.map) {
            this.keys.down[mapItem.name] = false
        }

        // Find in map per code
        this.keys.findPerCode = (key) => {
            return this.keys.map.find((mapItem) => mapItem.codes.includes(key))
        }

        // Handlers: keys pressed while a control of the interface has the focus (a slider, a
        // text field, a button in the menu) belong to that control, not to the game
        const keyDownHandler = (event: KeyboardEvent) => {
            if (Controls.isTyping(event.target))
                return
            const mapItem = this.keys.findPerCode(event.code)

            if (mapItem) {
                // a game key on a focused button outside the menu (a toolbar slot): the game's,
                // not a click on the button (Space would put the tool away)
                if ((event.target as HTMLElement)?.matches?.('button, a, [role="button"]'))
                    event.preventDefault()
                this.events.emit('keyDown', mapItem.name)
                this.events.emit(`${mapItem.name}Down`)
                this.keys.down[mapItem.name] = true
            }
        }

        const keyUpHandler = (event: KeyboardEvent) => {
            const mapItem = this.keys.findPerCode(event.code)

            if (mapItem) {
                if (!Controls.isTyping(event.target) && (event.target as HTMLElement)?.matches?.('button, a, [role="button"]'))
                    event.preventDefault()
                this.events.emit('keyUp', mapItem.name)
                this.events.emit(`${mapItem.name}Up`)
                this.keys.down[mapItem.name] = false
            }
        }

        // Events
        window.addEventListener('keydown', keyDownHandler)
        window.addEventListener('keyup', keyUpHandler)

        // (the hidden keyboard input's keys reach the window too: listening to it as well
        // counted every key twice, and taking a tool out put it straight back)
    }

    setPointer() {
        this.pointer.down = false
        this.pointer.deltaTemp = { x: 0, y: 0 }
        this.pointer.delta = { x: 0, y: 0 }

        // only presses on the world itself turn the camera (not on the menu or the toolbar)
        window.addEventListener('pointerdown', (event) => {
            if (!Controls.isInterface(event.target))
                this.pointer.down = true
        })

        // the first movement after the mouse is captured can be a bogus jump (the pointer's way to
        // where it was locked): skip that one. Browsers send one event a frame with all the
        // movement in it, so a quick flick is hundreds of pixels: it must not be cut.
        let skipNext = false
        document.addEventListener('pointerlockchange', () => { skipNext = !!document.pointerLockElement })
        window.addEventListener('pointermove', (event) => {
            if (skipNext) {
                skipNext = false
                return
            }
            if (Math.abs(event.movementX) > 4000 || Math.abs(event.movementY) > 4000)
                return
            this.pointer.deltaTemp.x += event.movementX
            this.pointer.deltaTemp.y += event.movementY
        })

        window.addEventListener('pointerup', () => {
            this.pointer.down = false
        })
    }

    update() {
        this.pointer.delta.x = this.pointer.deltaTemp.x
        this.pointer.delta.y = this.pointer.deltaTemp.y

        this.pointer.deltaTemp.x = 0
        this.pointer.deltaTemp.y = 0
    }

    /** Whether an event comes from the interface (anything but the game's canvas and the hidden keyboard input). */
    static isInterface(target: EventTarget | null) {
        const element = target as HTMLElement | null
        if (!element || !element.closest)
            return false
        if (element.classList?.contains('keyboard-input'))
            return false
        return !!element.closest('.ui') || element.matches('input, textarea, select, button')
    }

    /** Whether a key goes to the interface: a text field, or anything in the open menu. */
    static isTyping(target: EventTarget | null) {
        const element = target as HTMLElement | null
        if (!element || !element.closest || element.classList?.contains('keyboard-input'))
            return false
        return element.matches('input[type="text"], textarea, select') || !!element.closest('.drawer:not([hidden])')
    }

    setMobile() {
        if (this.showKeyboardButton && this.keyboardInput) {
            this.showKeyboardButton.addEventListener('click', () => {
                this.keyboardInput!.focus()
            })
        }
    }
}
