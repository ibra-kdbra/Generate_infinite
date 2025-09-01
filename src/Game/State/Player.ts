import { vec3 } from 'gl-matrix'

import Game from '../Game'
import State from './State'
import Camera from './Camera'
import Time from './Time'
import Controls from './Controls'

export default class Player {
    game: Game
    state: State
    time: Time
    controls: Controls
    rotation: number
    inputSpeed: number
    inputBoostSpeed: number
    speed: number
    position: {
        current: vec3
        previous: vec3
        delta: vec3
    }
    camera: Camera

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()
        this.time = this.state.time
        this.controls = this.state.controls

        this.rotation = 0
        this.inputSpeed = 10
        this.inputBoostSpeed = 30
        this.speed = 0

        this.position = {
            current: vec3.fromValues(10, 0, 1),
            previous: vec3.create(),
            delta: vec3.create()
        }
        vec3.copy(this.position.previous, this.position.current)


        this.camera = new Camera(this)
    }

    update() {
        if (this.camera.mode !== Camera.MODE_FLY && (this.controls.keys.down.forward || this.controls.keys.down.backward || this.controls.keys.down.strafeLeft || this.controls.keys.down.strafeRight)) {
            this.rotation = this.camera.thirdPerson.theta

            if (this.controls.keys.down.forward) {
                if (this.controls.keys.down.strafeLeft)
                    this.rotation += Math.PI * 0.25
                else if (this.controls.keys.down.strafeRight)
                    this.rotation -= Math.PI * 0.25
            }
            else if (this.controls.keys.down.backward) {
                if (this.controls.keys.down.strafeLeft)
                    this.rotation += Math.PI * 0.75
                else if (this.controls.keys.down.strafeRight)
                    this.rotation -= Math.PI * 0.75
                else
                    this.rotation -= Math.PI
            }
            else if (this.controls.keys.down.strafeLeft) {
                this.rotation += Math.PI * 0.5
            }
            else if (this.controls.keys.down.strafeRight) {
                this.rotation -= Math.PI * 0.5
            }

            const speed = this.controls.keys.down.boost ? this.inputBoostSpeed : this.inputSpeed

            const x = Math.sin(this.rotation) * this.time.delta * speed
            const z = Math.cos(this.rotation) * this.time.delta * speed

            this.position.current[0] -= x
            this.position.current[2] -= z
        }

        vec3.sub(this.position.delta, this.position.current, this.position.previous)
        vec3.copy(this.position.previous, this.position.current)

        this.speed = vec3.len(this.position.delta)

        // Update view
        this.camera.update()

        // Update elevation
        const chunks = this.state.chunks
        const elevation = chunks.getElevationForPosition(this.position.current[0], this.position.current[2])

        if (elevation)
            this.position.current[1] = elevation
        else
            this.position.current[1] = 0
    }
}
