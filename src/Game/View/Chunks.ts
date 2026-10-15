import State from '../State/State'
import Chunk from './Chunk'
import ChunkState from '../State/Chunk'

export default class Chunks {
    state: State

    constructor() {
        this.state = State.getInstance()

        this.state.chunks.events.on('create', (chunkState: ChunkState) => {
            const chunk = new Chunk(chunkState)

            chunkState.events.on('destroy', () => {
                chunk.destroy()
            })
        })
    }

    update() {

    }
}
