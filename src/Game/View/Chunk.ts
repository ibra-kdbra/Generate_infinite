import Game from '../Game'
import State from '../State/State'
import ChunkHelper from './ChunkHelper'
import ChunkState from '../State/Chunk'
import * as THREE from 'three'

export default class Chunk {
    game: Game
    state: State
    scene: THREE.Scene
    chunkState: ChunkState
    helper: ChunkHelper

    constructor(chunkState: ChunkState) {
        this.game = Game.getInstance()
        this.state = State.getInstance()
        this.scene = this.game.view.scene

        this.chunkState = chunkState

        this.helper = new ChunkHelper(this.chunkState)
    }

    update() {

    }

    destroy() {
    }
}
