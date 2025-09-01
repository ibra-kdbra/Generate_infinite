import { vec3, quat } from 'gl-matrix'

import Game from '../Game'
import State from './State'
import CameraThirdPerson from './CameraThirdPerson'
import CameraFly from './CameraFly'
import Player from './Player'
import Controls from './Controls'

export default class Camera {
    static MODE_THIRDPERSON = 1
    static MODE_FLY = 2

    game: Game
    state: State
    controls: Controls
    player: Player
    position: vec3
    quaternion: quat
    mode: number
    thirdPerson: CameraThirdPerson
    fly: CameraFly

    constructor(player: Player) {
        this.game = Game.getInstance()
        this.state = State.getInstance()

        this.controls = this.state.controls

        this.player = player

        this.position = vec3.create()
        this.quaternion = quat.create()
        this.mode = Camera.MODE_THIRDPERSON

        this.thirdPerson = new CameraThirdPerson(this.player)
        this.fly = new CameraFly(this.player)

        // Activate
        if (this.mode === Camera.MODE_THIRDPERSON)
            this.thirdPerson.activate()

        else if (this.mode === Camera.MODE_FLY)
            this.fly.activate()

        this.controls.events.on('cameraModeDown', () => {
            if (this.mode === Camera.MODE_THIRDPERSON) {
                this.mode = Camera.MODE_FLY
                this.fly.activate(this.position, this.quaternion)
                this.thirdPerson.deactivate()
            }

            else if (this.mode === Camera.MODE_FLY) {
                this.mode = Camera.MODE_THIRDPERSON
                this.fly.deactivate()
                this.thirdPerson.activate()
            }
        })

        this.setDebug()
    }

    update() {
        this.thirdPerson.update()
        this.fly.update()

        if (this.mode === Camera.MODE_THIRDPERSON) {
            vec3.copy(this.position, this.thirdPerson.position)
            quat.copy(this.quaternion, this.thirdPerson.quaternion)
        }

        else if (this.mode === Camera.MODE_FLY) {
            vec3.copy(this.position, this.fly.position)
            quat.copy(this.quaternion, this.fly.quaternion)
        }
    }

    setDebug() {
        const debug = this.game.debug

        if (!debug.active)
            return

        const folder = debug.ui.getFolder('state/player/view')

        folder
            .add(
                this,
                'mode',
                {
                    'MODE_THIRDPERSON': Camera.MODE_THIRDPERSON,
                    'MODE_FLY': Camera.MODE_FLY
                }
            )
            .onChange(() => {
                if (this.mode === Camera.MODE_THIRDPERSON) {
                    this.fly.deactivate()
                    this.thirdPerson.activate()
                }

                else if (this.mode === Camera.MODE_FLY) {
                    this.fly.activate(this.position, this.quaternion)
                    this.thirdPerson.deactivate()
                }
            })
    }
}
