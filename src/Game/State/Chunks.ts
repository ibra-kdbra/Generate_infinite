import { EventEmitter } from 'events'

import State from './State'
import Chunk from './Chunk'
import Settings, { Quality } from '../Settings'

// Rings of the largest chunks (1024 m) around the one under the player: the terrain reaches
// at least this many kilometres in every direction (the haze hides its edge). The outer
// chunks are coarse and cheap.
const RINGS: Record<Quality, number> = { lowest: 2, low: 2, medium: 3, high: 4, ultra: 4 }

export default class Chunks {
    state: State
    minSize: number
    maxDepth: number
    maxSize: number
    splitRatioPerSize: number
    lastId: number
    events: EventEmitter
    mainChunks: Map<string, Chunk>
    allChunks: Map<number, Chunk>
    playerChunkKey: string | null
    rings: number
    visibilityNeedsUpdate = false

    constructor() {
        this.state = State.getInstance()

        this.minSize = 64
        this.maxDepth = 4
        this.maxSize = this.minSize * Math.pow(2, this.maxDepth)
        this.splitRatioPerSize = 1.3
        this.lastId = 0

        this.events = new EventEmitter()
        this.mainChunks = new Map()
        this.allChunks = new Map()
        this.playerChunkKey = null
        const settings = Settings.getInstance()
        this.rings = RINGS[settings.get('quality')]
        settings.events.on('change:quality', (quality: Quality) => {
            this.rings = RINGS[quality]
            this.check()
        })

        this.check()
    }

    check() {
        // Set all children flag for check
        for (const [, chunk] of this.allChunks)
            chunk.needsCheck = true

        // Get the coordinates to main chunks around the player
        const mainChunksCoordinates = this.getMainChunksCoordinates()

        // Destroy main chunks not in proximity anymore
        for (const [key, chunk] of this.mainChunks) {
            if (!mainChunksCoordinates.find((coordinates) => coordinates.key === key)) {
                chunk.destroy()
                this.mainChunks.delete(key)
            }
        }

        // Create new main chunks
        for (const coordinates of mainChunksCoordinates) {
            if (!this.mainChunks.has(coordinates.key)) {
                const chunk = this.create(null, '', this.maxSize, coordinates.x, coordinates.z, 0)
                this.mainChunks.set(coordinates.key, chunk)
            }
        }

        // Check chunks
        for (const [, chunk] of this.mainChunks)
            chunk.check()

        // Update neighbours
        this.updateAllNeighbours()
    }

    update() {
        // Check only if player coordinates changed to to another minimal chunk
        const player = this.state.player
        // separator matters: without it (1, 23) and (12, 3) produced the same key
        const playerChunkKey = `${Math.round(player.position.current[0] / this.minSize * 2 + 0.5)}:${Math.round(player.position.current[2] / this.minSize * 2 + 0.5)}`

        if (playerChunkKey !== this.playerChunkKey) {
            this.playerChunkKey = playerChunkKey
            this.check()
        }

        // Update main chunks
        for (const [, chunk] of this.mainChunks)
            chunk.update()

        if (this.visibilityNeedsUpdate) {
            this.visibilityNeedsUpdate = false
            for (const [, chunk] of this.mainChunks)
                this.updateVisibility(chunk, false)
        }
    }

    /**
     * Which ground is drawn: a chunk's own once it's ready, unless one of its parents still draws
     * its own over the same land. A chunk splitting keeps its coarse ground until all four
     * children are ready; until then their finer ground (ready one by one) stays hidden, or the
     * two levels of detail would be drawn through each other (the coarse one's peaks poking out
     * of the fine one, a clutter of both). A chunk merging back draws its children until its own
     * is ready, and they go at that moment.
     */
    private updateVisibility(chunk: Chunk, covered: boolean) {
        const terrain = chunk.terrain
        const own = chunk.final && !!terrain && terrain.ready
        if (terrain)
            terrain.setVisible(own && !covered)
        for (const [, child] of chunk.children)
            this.updateVisibility(child, covered || own)
    }

    create(parent: Chunk | null, quadPosition: string, halfSize: number, x: number, z: number, depth: number) {
        const id = this.lastId++
        const chunk = new Chunk(String(id), this, parent, quadPosition, halfSize, x, z, depth)

        this.allChunks.set(id, chunk)

        this.events.emit('create', chunk)

        return chunk
    }

    updateAllNeighbours() {
        // Update main chunks neighbours
        for (const [key, chunk] of this.mainChunks) {
            const coordinates = key.split(',')
            const x = parseFloat(coordinates[0])
            const z = parseFloat(coordinates[1])

            const nChunkKey = `${x},${z - 1}`
            const eChunkKey = `${x + 1},${z}`
            const sChunkKey = `${x},${z + 1}`
            const wChunkKey = `${x - 1},${z}`

            const nChunk = this.mainChunks.get(nChunkKey) ?? false
            const eChunk = this.mainChunks.get(eChunkKey) ?? false
            const sChunk = this.mainChunks.get(sChunkKey) ?? false
            const wChunk = this.mainChunks.get(wChunkKey) ?? false

            chunk.setNeighbours(nChunk as Chunk, eChunk as Chunk, sChunk as Chunk, wChunk as Chunk)
        }

        // All not main chunks in depth order
        const chunks = [...this.allChunks.values()].filter(chunk => chunk.depth > 0).sort((a, b) => a.depth - b.depth)

        for (const chunk of chunks) {
            let nChunk: Chunk | boolean = false
            let eChunk: Chunk | boolean = false
            let sChunk: Chunk | boolean = false
            let wChunk: Chunk | boolean = false

            /**
             * North
             */
            // From quad
            if (chunk.quadPosition === 'sw')
                nChunk = chunk.parent!.children.get('nw')!

            // From quad
            else if (chunk.quadPosition === 'se')
                nChunk = chunk.parent!.children.get('ne')!

            // From parent neighbours
            else {
                const parentNeighbour = chunk.parent!.neighbours.get('n')
                if (parentNeighbour) {
                    if (parentNeighbour.splitted)
                        nChunk = parentNeighbour.children.get(chunk.quadPosition === 'nw' ? 'sw' : 'se')!
                    else
                        nChunk = parentNeighbour
                }
            }

            /**
             * East
             */
            // From quad
            if (chunk.quadPosition === 'nw')
                eChunk = chunk.parent!.children.get('ne')!

            // From quad
            else if (chunk.quadPosition === 'sw')
                eChunk = chunk.parent!.children.get('se')!

            // From parent neighbours
            else {
                const parentNeighbour = chunk.parent!.neighbours.get('e')
                if (parentNeighbour) {
                    if (parentNeighbour.splitted)
                        eChunk = parentNeighbour.children.get(chunk.quadPosition === 'ne' ? 'nw' : 'sw')!
                    else
                        eChunk = parentNeighbour
                }
            }

            /**
             * South
             */
            // From quad
            if (chunk.quadPosition === 'nw')
                sChunk = chunk.parent!.children.get('sw')!

            // From quad
            else if (chunk.quadPosition === 'ne')
                sChunk = chunk.parent!.children.get('se')!

            // From parent neighbours
            else {
                const parentNeighbour = chunk.parent!.neighbours.get('s')
                if (parentNeighbour) {
                    if (parentNeighbour.splitted)
                        sChunk = parentNeighbour.children.get(chunk.quadPosition === 'sw' ? 'nw' : 'ne')!
                    else
                        sChunk = parentNeighbour
                }
            }

            /**
             * West
             */
            // From quad
            if (chunk.quadPosition === 'ne')
                wChunk = chunk.parent!.children.get('nw')!

            // From quad
            else if (chunk.quadPosition === 'se')
                wChunk = chunk.parent!.children.get('sw')!

            // From parent neighbours
            else {
                const parentNeighbour = chunk.parent!.neighbours.get('w')
                if (parentNeighbour) {
                    if (parentNeighbour.splitted)
                        wChunk = parentNeighbour.children.get(chunk.quadPosition === 'nw' ? 'ne' : 'se')!
                    else
                        wChunk = parentNeighbour
                }
            }

            chunk.setNeighbours(nChunk as Chunk, eChunk as Chunk, sChunk as Chunk, wChunk as Chunk)
        }
    }

    getMainChunksCoordinates() {
        const player = this.state.player
        const currentX = Math.round(player.position.current[0] / this.maxSize)
        const currentZ = Math.round(player.position.current[2] / this.maxSize)

        // the chunk under the player and the rings around it
        const mainChunksCoordinates: { x: number, z: number, coordinatesX: number, coordinatesZ: number, key: string }[] = []
        for (let dz = - this.rings; dz <= this.rings; dz++)
            for (let dx = - this.rings; dx <= this.rings; dx++)
                mainChunksCoordinates.push({ x: currentX + dx, z: currentZ + dz, coordinatesX: 0, coordinatesZ: 0, key: '' })

        // Create key and multiply by max size of chunks
        for (const coordinates of mainChunksCoordinates) {
            coordinates.coordinatesX = coordinates.x
            coordinates.coordinatesZ = coordinates.z
            coordinates.key = `${coordinates.x},${coordinates.z}`
            coordinates.x *= this.maxSize
            coordinates.z *= this.maxSize
        }

        return mainChunksCoordinates
    }

    /** How far the terrain reaches at least, in every direction. */
    get reach() {
        return this.rings * this.maxSize
    }

    underSplitDistance(size: number, chunkX: number, chunkY: number) {
        const player = this.state.player
        const distance = Math.hypot(player.position.current[0] - chunkX, player.position.current[2] - chunkY)
        return distance < size * this.splitRatioPerSize
    }

    getChildChunkForPosition(x: number, z: number) {
        for (const [, chunk] of this.mainChunks) {
            if (chunk.isInside(x, z)) {
                return chunk
            }
        }
    }

    getDeepestChunkForPosition(x: number, z: number) {
        const baseChunk = this.getChildChunkForPosition(x, z)
        if (!baseChunk)
            return false

        const chunk = baseChunk.getChildChunkForPosition(x, z)
        return chunk
    }

    getElevationForPosition(x: number, z: number) {
        let chunk: Chunk | null | false | undefined = this.getDeepestChunkForPosition(x, z)
        // a chunk just split has no terrain yet: its parent's (coarser) is still there
        while (chunk && !(chunk.terrain && chunk.terrain.ready))
            chunk = chunk.parent
        if (!chunk || !chunk.terrain)
            return false
        return chunk.terrain.getElevationForPosition(x, z)
    }
}
