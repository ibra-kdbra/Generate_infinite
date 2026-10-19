import seedrandom from 'seedrandom'

import Game from '../Game'
import State from './State'
import Settings, { Quality } from '../Settings'
import { createNoise2D, NoiseFunction2D } from '../Workers/SimplexNoise'
import { WATER_LEVEL } from '../Workers/TerrainShape'
import { vec3 } from 'gl-matrix'

export const PLANT = { CONIFER: 0, BROADLEAF: 1, BUSH: 2, ROCK: 3 } as const
export type PlantKind = typeof PLANT[keyof typeof PLANT]

export type Plant = {
    kind: PlantKind
    x: number
    y: number
    z: number
    scale: number        // trees: height (m); rocks: radius (m)
    rotation: number
    tint: number         // 0..1 colour variation
    collision: number    // radius the player can't enter (0 = walk through)
    felled?: boolean     // cut down (what stands is its stump)
    stump?: number       // the stump's height, once felled
}

/** A felled tree lying on the ground: its trunk (solid, can be stood on) and its crown (a thicket of branches). */
export type Log = {
    plant: Plant
    trunk: { a: number[], b: number[], radius: number }
    crown: { a: number[], b: number[], radius: number }
}

type Cell = { ix: number, iz: number, plants: Plant[], chunkSize: number }

// How far around the player the world is populated
const RADIUS: Record<Quality, number> = { low: 300, medium: 480, high: 640, ultra: 820 }

const smoothstep = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)
}

/**
 * Trees, bushes and rocks, placed deterministically per 32 m cell of the infinite world
 * (the same seed always grows the same forest) from noise and the terrain under them:
 * forests in broad patches, conifers taking over with altitude and on slopes, broadleaf
 * trees in the lowlands, a tree line around 200 m, nothing in the water or on cliffs;
 * boulders on slopes and toward the mountains, the odd one in a meadow. Cells are filled
 * as the terrain under them is generated and dropped behind the player; heights are
 * re-read when the terrain there gets more detailed. Trunks and big rocks collide.
 */
const THREE_clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** The point of segment a-b nearest to p. */
function closestOnSegment(p: vec3 | number[], a: number[], b: number[]) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const length = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]
    const t = length > 1e-9 ? THREE_clamp(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / length, 0, 1) : 0
    return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]
}

export default class Vegetation {
    logs: Log[] = []                          // felled trees lying on the ground (View/Trees)
    trunkRadius: ((plant: Plant, height: number) => number) | null = null      // a trunk's thickness as drawn (View/Trees)
    game: Game
    state: State
    cellSize = 32
    radius = RADIUS.medium
    cells = new Map<string, Cell>()
    version = 0                    // changes whenever the set of plants changes
    // plants cut down or felled (by position): never grown again in this world
    private removed = new Set<string>()

    private seed: string
    private forestNoise: NoiseFunction2D
    private detailNoise: NoiseFunction2D
    private timer = 0

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()
        this.seed = this.game.seed + 'vegetation'
        this.forestNoise = createNoise2D(seedrandom(this.seed + 'forest'))
        this.detailNoise = createNoise2D(seedrandom(this.seed + 'detail'))

        const settings = Settings.getInstance()
        this.radius = RADIUS[settings.get('quality')]
        settings.events.on('change:quality', (quality: Quality) => {
            this.radius = RADIUS[quality]
            this.timer = 0
        })
    }

    private elevation(x: number, z: number) {
        const e = this.state.chunks.getElevationForPosition(x, z)
        return typeof e === 'number' && !Number.isNaN(e) ? e : undefined
    }

    private chunkSizeAt(x: number, z: number) {
        const chunk = this.state.chunks.getDeepestChunkForPosition(x, z)
        return chunk ? chunk.size : Infinity
    }

    /** 0..1: how much this spot is forest (broad patches with ragged edges). */
    forestAt(x: number, z: number) {
        const n = this.forestNoise(x * 0.0016, z * 0.0016) * 0.75 + this.detailNoise(x * 0.007, z * 0.007) * 0.25
        return smoothstep(0.0, 0.35, n)
    }

    private generate(ix: number, iz: number): Plant[] | null {
        const size = this.cellSize
        const random = seedrandom(`${this.seed}:${ix}:${iz}`)
        const plants: Plant[] = []

        for (let i = 0; i < 22; i++) {
            const x = (ix + random()) * size
            const z = (iz + random()) * size
            const roll = random(), pick = random(), a = random(), b = random(), c = random()

            const e = this.elevation(x, z)
            if (e === undefined)
                return null                  // terrain not there yet: try again later
            if (this.removed.has(this.key(x, z)))
                continue
            const ex = this.elevation(x + 1.5, z) ?? e
            const ez = this.elevation(x, z + 1.5) ?? e
            const slope = 1 - 1.5 / Math.hypot(ex - e, 1.5, ez - e)     // 0 flat .. 1 vertical
            const height = e - WATER_LEVEL
            if (height < 0.4)
                continue                     // water and the waterline

            const forest = this.forestAt(x, z)
            const treeLine = 1 - smoothstep(165, 215, e + this.detailNoise(x * 0.01, z * 0.01) * 25)
            const flatEnough = 1 - smoothstep(0.28, 0.42, slope)
            const shore = smoothstep(0.6, 2.5, height)

            // trees: dense in forests, a few lone ones in the open
            const tree = (forest * 0.62 + 0.012) * treeLine * flatEnough * shore
            if (roll < tree) {
                const coniferous = smoothstep(35, 120, e + this.detailNoise(x * 0.004, z * 0.004) * 45) * 0.8 + slope * 0.6
                const conifer = pick < coniferous
                const scale = conifer ? 9 + a * 11 : 8 + a * 8
                plants.push({
                    kind: conifer ? PLANT.CONIFER : PLANT.BROADLEAF, x, y: e - 0.15, z, scale,
                    rotation: b * Math.PI * 2, tint: c, collision: conifer ? scale * 0.028 : scale * 0.035
                })
                continue
            }

            // bushes: forest edges and meadows
            const bush = (smoothstep(0.05, 0.4, forest) * (1 - smoothstep(0.6, 0.9, forest)) * 0.25 + 0.02) * treeLine * flatEnough * shore
            if (roll < tree + bush) {
                plants.push({ kind: PLANT.BUSH, x, y: e - 0.1, z, scale: 0.8 + a * 1.2, rotation: b * Math.PI * 2, tint: c, collision: 0 })
                continue
            }

            // rocks: slopes and mountains, the odd boulder in a meadow
            const rock = 0.012 + smoothstep(0.18, 0.5, slope) * 0.22 + smoothstep(120, 220, e) * 0.08
            if (roll < tree + bush + rock && slope < 0.75) {
                const scale = 0.35 + Math.pow(a, 2.2) * 2.6
                plants.push({
                    kind: PLANT.ROCK, x, y: e - scale * 0.35, z, scale,
                    rotation: b * Math.PI * 2, tint: c, collision: scale > 0.55 ? scale * 0.6 : 0
                })
            }
        }
        return plants
    }

    update() {
        this.timer -= this.state.time.delta
        if (this.timer > 0)
            return
        this.timer = 0.2

        const p = this.state.player.position.current
        const size = this.cellSize
        const reach = Math.ceil(this.radius / size)
        const cx = Math.floor(p[0] / size), cz = Math.floor(p[2] / size)
        let changed = false

        // drop cells left behind
        for (const [key, cell] of this.cells) {
            const dx = (cell.ix + 0.5) * size - p[0], dz = (cell.iz + 0.5) * size - p[2]
            if (Math.hypot(dx, dz) > this.radius + size * 2) {
                this.cells.delete(key)
                changed = true
            }
        }

        // fill new cells, nearest first, a budget per update
        let budget = 90
        for (let ring = 0; ring <= reach && budget > 0; ring++) {
            for (let ix = cx - ring; ix <= cx + ring && budget > 0; ix++) {
                for (let iz = cz - ring; iz <= cz + ring && budget > 0; iz++) {
                    if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring)
                        continue
                    const centerX = (ix + 0.5) * size, centerZ = (iz + 0.5) * size
                    const distance = Math.hypot(centerX - p[0], centerZ - p[2])
                    if (distance > this.radius)
                        continue
                    const key = `${ix}:${iz}`
                    const cell = this.cells.get(key)
                    const chunkSize = this.chunkSizeAt(centerX, centerZ)
                    if (cell) {
                        // the terrain got more detailed here: re-read the heights
                        if (chunkSize < cell.chunkSize && distance < 260) {
                            for (const plant of cell.plants) {
                                const e = this.elevation(plant.x, plant.z)
                                if (e !== undefined)
                                    plant.y = plant.kind === PLANT.ROCK ? e - plant.scale * 0.35 : e - 0.15
                            }
                            cell.chunkSize = chunkSize
                            changed = true
                            budget -= 2
                        }
                        continue
                    }
                    budget -= 6
                    const plants = this.generate(ix, iz)
                    if (plants) {
                        this.cells.set(key, { ix, iz, plants, chunkSize })
                        changed = true
                    }
                }
            }
        }

        if (changed)
            this.version++
    }

    /** How tall a plant's solid part is: a trunk up to where the crown starts, a boulder's top. */
    private solidTop(plant: Plant) {
        if (plant.stump !== undefined)
            return plant.y + plant.stump
        if (plant.kind === PLANT.ROCK)
            return plant.y + plant.scale * 1.05      // the scanned boulders: under ~1 m tall per metre across
        return plant.y + plant.scale * (plant.kind === PLANT.CONIFER ? 0.35 : 0.45)
    }

    /**
     * Push a point out of the trunks and boulders around it (the player's and the cameras'
     * collision). Returns whether anything was hit.
     */
    resolveCollision(position: vec3, radius: number) {
        const size = this.cellSize
        const cx = Math.floor(position[0] / size), cz = Math.floor(position[2] / size)
        let hit = false
        for (let ix = cx - 1; ix <= cx + 1; ix++) {
            for (let iz = cz - 1; iz <= cz + 1; iz++) {
                const cell = this.cells.get(`${ix}:${iz}`)
                if (!cell)
                    continue
                for (const plant of cell.plants) {
                    if (plant.collision <= 0 || position[1] > this.solidTop(plant) + radius)
                        continue
                    const dx = position[0] - plant.x, dz = position[2] - plant.z
                    const distance = Math.hypot(dx, dz)
                    const minimum = this.radiusOf(plant, position[1] - plant.y) + radius
                    if (distance < minimum && distance > 1e-4) {
                        position[0] = plant.x + dx / distance * minimum
                        position[2] = plant.z + dz / distance * minimum
                        hit = true
                    }
                }
            }
        }
        return hit
    }

    /**
     * How thick a plant is at this height as it's drawn: a trunk's bark (the view measures
     * its trees: `trunkRadius`), else its collider.
     */
    private radiusOf(plant: Plant, height: number) {
        if (plant.kind !== PLANT.ROCK && plant.kind !== PLANT.BUSH && this.trunkRadius)
            return this.trunkRadius(plant, THREE_clamp(height, 0.3, plant.stump ?? 1.6)) + 0.03
        return plant.collision
    }

    /**
     * The felled trees lying on the ground: their trunks are solid (the body is pushed out of
     * them, or stands on one stepped up onto) and their crowns are thickets that hold the body
     * back. Returns the height of a trunk's top to stand on (if any) and how freely one moves
     * here (1 in the open .. 0.35 deep in the branches); pushes `position` out of trunks and
     * takes away the velocity into them.
     */
    resolveLogs(position: vec3, velocity: vec3, radius: number) {
        let stand: number | null = null, free = 1
        for (const log of this.logs) {
            const t = log.trunk
            const c = closestOnSegment(position, t.a, t.b)
            const dx = position[0] - c[0], dz = position[2] - c[2]
            const horizontal = Math.hypot(dx, dz)
            const top = c[1] + t.radius
            if (horizontal < t.radius + radius) {
                if (position[1] >= top - 0.4) {
                    // stepped up onto it (or standing on it)
                    if (horizontal < t.radius + radius * 0.4)
                        stand = Math.max(stand ?? - Infinity, top)
                }
                else if (horizontal > 1e-4) {
                    const push = t.radius + radius - horizontal
                    position[0] += dx / horizontal * push
                    position[2] += dz / horizontal * push
                    const into = (velocity[0] * dx + velocity[2] * dz) / horizontal
                    if (into < 0) {
                        velocity[0] -= into * dx / horizontal
                        velocity[2] -= into * dz / horizontal
                    }
                }
            }
            const k = log.crown
            const cc = closestOnSegment(position, k.a, k.b)
            const d = Math.hypot(position[0] - cc[0], position[1] + 0.9 - cc[1], position[2] - cc[2])
            if (d < k.radius)
                free = Math.min(free, 0.35 + 0.65 * d / k.radius)
        }
        return { stand, free }
    }

    /** Whether a point is inside a trunk or a boulder (camera line-of-sight checks). */
    isSolid(x: number, y: number, z: number, radius: number) {
        return this.solidAt(x, y, z, radius) !== null
    }

    /** The trunk or boulder a point is inside, if any (tools and arrows hitting things). */
    solidAt(x: number, y: number, z: number, radius: number): Plant | null {
        const size = this.cellSize
        const cx = Math.floor(x / size), cz = Math.floor(z / size)
        for (let ix = cx - 1; ix <= cx + 1; ix++) {
            for (let iz = cz - 1; iz <= cz + 1; iz++) {
                const cell = this.cells.get(`${ix}:${iz}`)
                if (!cell)
                    continue
                for (const plant of cell.plants)
                    if (plant.collision > 0 && y > plant.y - 0.5 && y < this.solidTop(plant) + radius && Math.hypot(x - plant.x, z - plant.z) < this.radiusOf(plant, y - plant.y) + radius)
                        return plant
            }
        }
        return null
    }

    /** The nearest plant of these kinds within `range` of (x, z), if any. */
    nearest(x: number, z: number, range: number, kinds: PlantKind[]): Plant | null {
        const size = this.cellSize
        const cx = Math.floor(x / size), cz = Math.floor(z / size)
        let best: Plant | null = null, bestDistance = range
        for (let ix = cx - 1; ix <= cx + 1; ix++)
            for (let iz = cz - 1; iz <= cz + 1; iz++)
                for (const plant of this.cells.get(`${ix}:${iz}`)?.plants ?? []) {
                    if (!kinds.includes(plant.kind))
                        continue
                    const distance = Math.hypot(x - plant.x, z - plant.z)
                    if (distance < bestDistance) {
                        bestDistance = distance
                        best = plant
                    }
                }
        return best
    }

    private key(x: number, z: number) {
        return `${Math.round(x * 100)}:${Math.round(z * 100)}`
    }

    /** Take a plant out of the world for good (a bush cut down, a felled tree cleared away). */
    remove(plant: Plant) {
        this.removed.add(this.key(plant.x, plant.z))
        const cell = this.cells.get(`${Math.floor(plant.x / this.cellSize)}:${Math.floor(plant.z / this.cellSize)}`)
        if (cell) {
            const index = cell.plants.indexOf(plant)
            if (index >= 0)
                cell.plants.splice(index, 1)
        }
        this.version++
    }
}
