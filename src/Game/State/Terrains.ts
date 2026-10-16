import { EventEmitter } from 'events'
import seedrandom from 'seedrandom'

import Game from '../Game'
import State from './State'
import TerrainWorker from '../Workers/Terrain?worker'
import Terrain from './Terrain'
import { defaultTerrainShape, TerrainShape } from '../Workers/TerrainShape'
import Settings, { Quality } from '../Settings'

// Mesh resolution per chunk size: chunks are 64 m around the player and double in size
// with distance; far ones need far fewer vertices for the same detail on screen
const SUBDIVISIONS: Record<Quality, Record<number, number>> = {
    low: { 64: 56, 128: 48, 256: 36, 512: 28, 1024: 20 },
    medium: { 64: 72, 128: 64, 256: 48, 512: 36, 1024: 28 },
    high: { 64: 96, 128: 80, 256: 64, 512: 48, 1024: 36 },
    ultra: { 64: 128, 128: 104, 256: 80, 512: 64, 1024: 48 }
}

export default class Terrains {
    static ITERATIONS_FORMULA_MAX = 1
    static ITERATIONS_FORMULA_MIN = 2
    static ITERATIONS_FORMULA_MIX = 3
    static ITERATIONS_FORMULA_POWERMIX = 4

    game: Game
    state: State
    seed: string
    random: seedrandom.PRNG
    subdivisions: number         // of the smallest chunks (the debug panel can override all)
    quality: Quality = 'medium'
    subdivisionsOverride = 0
    maxIterations: number
    shape: TerrainShape
    readonly defaultShape = { ...defaultTerrainShape }
    segments: number
    iterationsFormula: number
    lastId: number
    terrains: Map<string, Terrain>
    events: EventEmitter
    iterationsOffsets: [number, number][]
    workers: Worker[]
    workerIndex: number

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()

        this.seed = this.game.seed + 'b'
        this.random = seedrandom(this.seed)
        const settings = Settings.getInstance()
        this.quality = settings.get('quality')
        this.subdivisions = SUBDIVISIONS[this.quality][64]
        settings.events.on('change:quality', (quality: Quality) => {
            this.quality = quality
            this.subdivisions = SUBDIVISIONS[quality][64]
            this.segments = this.subdivisions + 1
            this.recreate()
        })
        this.maxIterations = 8
        this.shape = { ...defaultTerrainShape }   // see Workers/TerrainShape.ts

        this.segments = this.subdivisions + 1
        this.iterationsFormula = Terrains.ITERATIONS_FORMULA_POWERMIX

        this.lastId = 0
        this.terrains = new Map()

        this.events = new EventEmitter()

        // Iterations offsets
        this.iterationsOffsets = []

        for (let i = 0; i < this.maxIterations; i++)
            this.iterationsOffsets.push([(this.random() - 0.5) * 200000, (this.random() - 0.5) * 200000])

        this.workers = []
        this.workerIndex = 0
        this.setWorkers()
        Settings.getInstance().events.on('change:threads', () => {
            for (const worker of this.workers)
                worker.terminate()
            this.workers = []
            this.workerIndex = 0
            this.setWorkers()
            this.recreate()      // whatever was still being generated starts again
        })
    }

    get workerCount() {
        return this.workers.length
    }

    /**
     * The terrain is generated in background workers (Settings: threads): more of them fill
     * the world in faster, at the cost of more of the processor; "auto" leaves one core free
     * for the game itself.
     */
    setWorkers() {
        const threads = Settings.getInstance().get('threads')
        const workersCount = threads === 'auto' ? Math.max(1, (navigator.hardwareConcurrency || 4) - 1) : Number(threads)

        for (let i = 0; i < workersCount; i++) {
            const worker = new TerrainWorker()

            worker.onmessage = (event) => {
                const terrain = this.terrains.get(event.data.id)

                if (terrain) {
                    terrain.create(event.data)
                }
            }

            this.workers.push(worker)
        }
    }

    getIterationsForPrecision(precision: number) {
        if (this.iterationsFormula === Terrains.ITERATIONS_FORMULA_MAX)
            return this.maxIterations

        if (this.iterationsFormula === Terrains.ITERATIONS_FORMULA_MIN)
            return Math.floor((this.maxIterations - 1) * precision) + 1

        if (this.iterationsFormula === Terrains.ITERATIONS_FORMULA_MIX)
            return Math.round((this.maxIterations * precision + this.maxIterations) / 2)

        if (this.iterationsFormula === Terrains.ITERATIONS_FORMULA_POWERMIX)
            return Math.round((this.maxIterations * (1 - Math.pow(1 - precision, 2)) + this.maxIterations) / 2)

        return 0
    }

    create(size: number, x: number, z: number, precision: number) {
        // Create id
        const id = this.lastId++

        // Create terrain
        const iterations = this.getIterationsForPrecision(precision)
        const terrain = new Terrain(this, String(id), size, x, z, precision)
        this.terrains.set(terrain.id, terrain)

        // Post to worker
        // console.time(`terrains: worker (${terrain.id})`)
        const worker = this.workers[this.workerIndex++]
        if (this.workerIndex >= this.workers.length)
            this.workerIndex = 0

        this.post(worker, terrain, iterations)

        this.events.emit('create', terrain)

        return terrain
    }

    destroyTerrain(id: string) {
        const terrain = this.terrains.get(id)

        if (terrain) {
            terrain.destroy()
            this.terrains.delete(id)
        }
    }

    recreate() {
        for (const [, terrain] of this.terrains) {
            // this.create(terrain.size, terrain.x, terrain.z)

            // console.time(`terrains: worker (${terrain.id})`)
            const iterations = this.getIterationsForPrecision(terrain.precision)

            const worker = this.workers[this.workerIndex++]
            if (this.workerIndex >= this.workers.length)
                this.workerIndex = 0

            this.post(worker, terrain, iterations)
        }
    }

    subdivisionsFor(size: number) {
        if (this.subdivisionsOverride)
            return this.subdivisionsOverride
        const table = SUBDIVISIONS[this.quality]
        return table[size] ?? table[1024]
    }

    private post(worker: Worker, terrain: Terrain, iterations: number) {
        worker.postMessage({
            id: terrain.id,
            size: terrain.size,
            x: terrain.x,
            z: terrain.z,
            seed: this.seed,
            forestSeed: this.game.seed + 'vegetation',     // State/Vegetation's forest map
            subdivisions: this.subdivisionsFor(terrain.size),
            iterations: iterations,
            iterationsOffsets: this.iterationsOffsets,
            shape: this.shape
        })
    }

}
