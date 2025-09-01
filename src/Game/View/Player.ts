import * as THREE from 'three'

import Game from '../Game'
import View from './View'
import Debug from '../Debug/Debug'
import State from '../State/State'
import PlayerMaterial from './Materials/PlayerMaterial'

export default class Player {
    game: Game
    state: State
    view: View
    debug: Debug
    scene: THREE.Scene
    group!: THREE.Group
    helper!: THREE.Mesh

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()
        this.view = View.getInstance()
        this.debug = Debug.getInstance()

        this.scene = this.view.scene

        this.setGroup()
        this.setHelper()
        this.setDebug()
    }

    setGroup() {
        this.group = new THREE.Group()
        this.scene.add(this.group)
    }

    setHelper() {
        this.helper = new THREE.Mesh()
        this.helper.material = new PlayerMaterial()
            ; (this.helper.material as PlayerMaterial).uniforms.uColor.value = new THREE.Color('#fff8d6')
            ; (this.helper.material as PlayerMaterial).uniforms.uSunPosition.value = new THREE.Vector3(- 0.5, - 0.5, - 0.5)

        this.helper.geometry = new THREE.CapsuleGeometry(0.5, 0.8, 3, 16)
        this.helper.geometry.translate(0, 0.9, 0)
        this.group.add(this.helper)
    }

    setDebug() {
        if (!this.debug.active)
            return

        // Sphere
        const playerFolder = this.debug.ui.getFolder('view/player')

        playerFolder.addColor((this.helper.material as PlayerMaterial).uniforms.uColor, 'value')
    }


    update() {
        const playerState = this.state.player
        const sunState = this.state.sun

        this.group.position.set(
            playerState.position.current[0],
            playerState.position.current[1],
            playerState.position.current[2]
        )

        // Helper
        this.helper.rotation.y = playerState.rotation
            ; (this.helper.material as PlayerMaterial).uniforms.uSunPosition.value.set(sunState.position.x, sunState.position.y, sunState.position.z)
    }
}
