import { EventEmitter } from 'events'
import seedrandom from 'seedrandom'

import Game from '../Game'
import State from './State'
import Debug from '../Debug/Debug'
import TerrainWorker from '../Workers/Terrain?worker'
import Terrain from './Terrain'

export default class Terrains {
    static ITERATIONS_FORMULA_MAX = 1
    static ITERATIONS_FORMULA_MIN = 2
    static ITERATIONS_FORMULA_MIX = 3
    static ITERATIONS_FORMULA_POWERMIX = 4

    game: Game
    state: State
    debug: Debug
    seed: string
    random: seedrandom.PRNG
    subdivisions: number
    lacunarity: number
    persistence: number
    maxIterations: number
    baseFrequency: number
    baseAmplitude: number
    power: number
    elevationOffset: number
    segments: number
    iterationsFormula: number
    lastId: number
    terrains: Map<string, Terrain>
    events: EventEmitter
    iterationsOffsets: [number, number][]
    worker!: Worker

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()
        this.debug = Debug.getInstance()

        this.seed = this.game.seed + 'b'
        this.random = seedrandom(this.seed)
        this.subdivisions = 120
        this.lacunarity = 2.2
        this.persistence = 0.4
        this.maxIterations = 8
        this.baseFrequency = 0.002
        this.baseAmplitude = 220
        this.power = 2.2
        this.elevationOffset = 1

        this.segments = this.subdivisions + 1
        this.iterationsFormula = Terrains.ITERATIONS_FORMULA_POWERMIX

        this.lastId = 0
        this.terrains = new Map()

        this.events = new EventEmitter()

        // Iterations offsets
        this.iterationsOffsets = []

        for (let i = 0; i < this.maxIterations; i++)
            this.iterationsOffsets.push([(this.random() - 0.5) * 200000, (this.random() - 0.5) * 200000])

        this.setWorkers()
        this.setDebug()
    }

    setWorkers() {
        this.worker = new TerrainWorker()

        this.worker.onmessage = (event) => {
            // console.timeEnd(`terrains: worker (${event.data.id})`)

            const terrain = this.terrains.get(event.data.id)

            if (terrain) {
                terrain.create(event.data)
            }
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
        const terrain = new Terrain(this, String(id), size, x, z, precision, this.elevationOffset)
        this.terrains.set(terrain.id, terrain)

        // Post to worker
        // console.time(`terrains: worker (${terrain.id})`)
        this.worker.postMessage({
            id: terrain.id,
            x,
            z,
            seed: this.seed,
            subdivisions: this.subdivisions,
            size: size,
            lacunarity: this.lacunarity,
            persistence: this.persistence,
            iterations: iterations,
            baseFrequency: this.baseFrequency,
            baseAmplitude: this.baseAmplitude,
            power: this.power,
            elevationOffset: this.elevationOffset,
            iterationsOffsets: this.iterationsOffsets
        })

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
            this.worker.postMessage({
                id: terrain.id,
                size: terrain.size,
                x: terrain.x,
                z: terrain.z,
                seed: this.seed,
                subdivisions: this.subdivisions,
                lacunarity: this.lacunarity,
                persistence: this.persistence,
                iterations: iterations,
                baseFrequency: this.baseFrequency,
                baseAmplitude: this.baseAmplitude,
                power: this.power,
                elevationOffset: this.elevationOffset,
                iterationsOffsets: this.iterationsOffsets
            })
        }
    }

    setDebug() {
        if (!this.debug.active)
            return

        const folder = this.debug.ui.getFolder('state/terrains')

        folder
            .add(this, 'subdivisions')
            .min(1)
            .max(400)
            .step(1)
            .onFinishChange(() => this.recreate())

        folder
            .add(this, 'lacunarity')
            .min(1)
            .max(5)
            .step(0.01)
            .onFinishChange(() => this.recreate())

        folder
            .add(this, 'persistence')
            .min(0)
            .max(1)
            .step(0.01)
            .onFinishChange(() => this.recreate())

        folder
            .add(this, 'maxIterations')
            .min(1)
            .max(10)
            .step(1)
            .onFinishChange(() => this.recreate())

        folder
            .add(this, 'baseFrequency')
            .min(0)
            .max(0.01)
            .step(0.0001)
            .onFinishChange(() => this.recreate())

        folder
            .add(this, 'baseAmplitude')
            .min(0)
            .max(500)
            .step(0.1)
            .onFinishChange(() => this.recreate())

        folder
            .add(this, 'power')
            .min(1)
            .max(10)
            .step(1)
            .onFinishChange(() => this.recreate())

        folder
            .add(this, 'elevationOffset')
            .min(- 10)
            .max(10)
            .step(1)
            .onFinishChange(() => this.recreate())

        folder
            .add(
                this,
                'iterationsFormula',
                {
                    'max': Terrains.ITERATIONS_FORMULA_MAX,
                    'min': Terrains.ITERATIONS_FORMULA_MIN,
                    'mix': Terrains.ITERATIONS_FORMULA_MIX,
                    'powerMix': Terrains.ITERATIONS_FORMULA_POWERMIX,
                }
            )
            .onFinishChange(() => this.recreate())


        // this.material.uniforms.uFresnelOffset.value = 0
        // this.material.uniforms.uFresnelScale.value = 0.5
        // this.material.uniforms.uFresnelPower.value = 2
    }
}
