import * as THREE from 'three'

import View from './View'
import State from '../State/State'

export default class Water {
    view: View
    state: State
    scene: THREE.Scene
    mesh: THREE.Mesh

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.scene = this.view.scene

        this.mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1000, 1000),
            new THREE.MeshBasicMaterial({ color: '#1d3456' })
        )
        this.mesh.geometry.rotateX(- Math.PI * 0.5)
        // this.scene.add(this.mesh)
    }

    update() {
        const playerState = this.state.player

        this.mesh.position.set(
            playerState.position.current[0],
            0,
            playerState.position.current[2]
        )
    }
}
