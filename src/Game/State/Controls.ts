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

        // Two ways the mouse turns the view: dragging (pointer events, mouse and touch alike),
        // and the captured mouse (mouse events).
        window.addEventListener('pointermove', (event) => {
            if (document.pointerLockElement)
                return
            this.pointer.deltaTemp.x += event.movementX
            this.pointer.deltaTemp.y += event.movementY
        })

        // The captured mouse. What Firefox on Wayland sends, the mouse moved steadily right:
        //   time 16257 move 2 · 16256 -151 · 16266 4 · 16264 -149 · 16276 2 · 16271 -148 ...
        // after each movement a second event, stamped a little earlier, with the pointer's offset
        // from where it was captured (and the button of the click that captured it): the view
        // turned many times too far, in lurches. An event out of time order is that one: dropped.
        // The movement itself comes in the screen's own pixels (2.2 of them a CSS pixel there,
        // as in Chrome), so it's brought to the CSS pixels dragging gets: the same speed.
        // The first movement after the capture can be a jump (the pointer's way to where it was
        // locked): skipped. Where the system puts the pointer back in the middle of the window
        // and reports that too (the same movement the other way, X11), it's dropped.
        let skipNext = false, lastTime = - Infinity
        document.addEventListener('pointerlockchange', () => {
            skipNext = !!document.pointerLockElement
            lastTime = - Infinity
        })
        let recent: { x: number, y: number, time: number }[] = []
        window.addEventListener('mousemove', (event) => {
            if (!document.pointerLockElement)
                return
            if (event.timeStamp < lastTime)
                return
            lastTime = event.timeStamp
            if (skipNext) {
                skipNext = false
                return
            }
            const x = event.movementX, y = event.movementY
            if (Math.abs(x) > 4000 || Math.abs(y) > 4000)
                return
            recent = recent.filter((move) => event.timeStamp - move.time < 50)
            if (Math.abs(x) + Math.abs(y) > 6) {
                let sumX = 0, sumY = 0
                for (let i = recent.length - 1; i >= Math.max(0, recent.length - 5); i--) {
                    sumX += recent[i].x
                    sumY += recent[i].y
                    if (Math.abs(x + sumX) <= 1 && Math.abs(y + sumY) <= 1) {
                        recent = []
                        return
                    }
                }
            }
            recent.push({ x, y, time: event.timeStamp })
            const scale = 1 / (window.devicePixelRatio || 1)
            this.pointer.deltaTemp.x += x * scale
            this.pointer.deltaTemp.y += y * scale
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
