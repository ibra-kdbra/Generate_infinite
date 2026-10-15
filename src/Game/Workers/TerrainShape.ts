/**
 * Terrain height function (metres), shared by the terrain worker.
 *
 * Instead of one fbm mirrored into equally deep pits and high peaks, the world is built
 * the way real landscapes read:
 *  - a very low frequency "region" field decides between lowland plains, rolling hills
 *    and mountain ranges, so the character of the land changes as you travel;
 *  - the coordinates are domain-warped so ridges and valleys bend organically;
 *  - hills use an "eroded" fbm (detail damped on slopes, after Inigo Quilez) so slopes
 *    look worn smooth while tops and valley floors keep their detail;
 *  - mountains use a ridged multifractal (after Musgrave): sharp crests, detail gathered
 *    along the ridges, wide U-shaped valleys between them;
 *  - basins that fall below the water level become shallow lakes instead of pits.
 */

export const WATER_LEVEL = 0

/** 2D simplex noise returning a value in about [-1, 1] and its gradient in `out`. */
export type NoiseWithDerivatives = (x: number, y: number, out: Float64Array) => number

const F2 = 0.5 * (Math.sqrt(3) - 1)
const G2 = (3 - Math.sqrt(3)) / 6
const GRAD_X = [-1, 1, -1, 1, -1, 0, 0, 1]
const GRAD_Y = [-1, 0, 0, 1, 1, -1, 1, -1]

/** Simplex noise with analytic derivatives (after Stefan Gustavson's sdnoise2). */
export const createNoiseWithDerivatives = (random: () => number): NoiseWithDerivatives => {
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i++)
        p[i] = i
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        const t = p[i]
        p[i] = p[j]
        p[j] = t
    }
    const perm = new Uint8Array(512)
    for (let i = 0; i < 512; i++)
        perm[i] = p[i & 255]

    return (x, y, out) => {
        const s = (x + y) * F2
        const i = Math.floor(x + s)
        const j = Math.floor(y + s)
        const t = (i + j) * G2
        const x0 = x - (i - t)
        const y0 = y - (j - t)
        const i1 = x0 > y0 ? 1 : 0
        const j1 = 1 - i1
        const x1 = x0 - i1 + G2
        const y1 = y0 - j1 + G2
        const x2 = x0 - 1 + 2 * G2
        const y2 = y0 - 1 + 2 * G2
        const ii = i & 255
        const jj = j & 255

        let n = 0, dx = 0, dy = 0

        const t0 = 0.5 - x0 * x0 - y0 * y0
        if (t0 > 0) {
            const g = perm[ii + perm[jj]] & 7
            const t2 = t0 * t0, t4 = t2 * t2, dot = GRAD_X[g] * x0 + GRAD_Y[g] * y0
            n += t4 * dot
            const k = - 8 * t2 * t0 * dot
            dx += k * x0 + t4 * GRAD_X[g]
            dy += k * y0 + t4 * GRAD_Y[g]
        }
        const t1 = 0.5 - x1 * x1 - y1 * y1
        if (t1 > 0) {
            const g = perm[ii + i1 + perm[jj + j1]] & 7
            const t2 = t1 * t1, t4 = t2 * t2, dot = GRAD_X[g] * x1 + GRAD_Y[g] * y1
            n += t4 * dot
            const k = - 8 * t2 * t1 * dot
            dx += k * x1 + t4 * GRAD_X[g]
            dy += k * y1 + t4 * GRAD_Y[g]
        }
        const t2_ = 0.5 - x2 * x2 - y2 * y2
        if (t2_ > 0) {
            const g = perm[ii + 1 + perm[jj + 1]] & 7
            const t2 = t2_ * t2_, t4 = t2 * t2, dot = GRAD_X[g] * x2 + GRAD_Y[g] * y2
            n += t4 * dot
            const k = - 8 * t2 * t2_ * dot
            dx += k * x2 + t4 * GRAD_X[g]
            dy += k * y2 + t4 * GRAD_Y[g]
        }

        out[0] = 40 * dx
        out[1] = 40 * dy
        return 40 * n
    }
}

const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v
const smoothstep = (a: number, b: number, v: number) => {
    const t = clamp01((v - a) / (b - a))
    return t * t * (3 - 2 * t)
}

// Octaves are rotated (and scaled a little off 2) so their grids never line up
const ROT_C = 0.8
const ROT_S = 0.6

const derivative = new Float64Array(2)

const fbm = (noise: NoiseWithDerivatives, x: number, y: number, octaves: number) => {
    let sum = 0, amplitude = 1, normalisation = 0
    for (let i = 0; i < octaves; i++) {
        sum += noise(x, y, derivative) * amplitude
        normalisation += amplitude
        amplitude *= 0.5
        const rx = (ROT_C * x - ROT_S * y) * 2.03
        y = (ROT_S * x + ROT_C * y) * 2.03
        x = rx
    }
    return sum / normalisation
}

/** fbm whose octaves fade where the slope accumulated so far is steep. */
const erodedFbm = (noise: NoiseWithDerivatives, x: number, y: number, octaves: number) => {
    let sum = 0, amplitude = 1, normalisation = 0, gx = 0, gy = 0
    for (let i = 0; i < octaves; i++) {
        const n = noise(x, y, derivative)
        gx += derivative[0]
        gy += derivative[1]
        sum += amplitude * n / (1 + (gx * gx + gy * gy) * 0.45)
        normalisation += amplitude
        amplitude *= 0.5
        const rx = (ROT_C * x - ROT_S * y) * 2.03
        y = (ROT_S * x + ROT_C * y) * 2.03
        x = rx
    }
    return sum / normalisation
}

/** Ridged multifractal in [0, 1]: crests where the noise crosses zero, detail along them. */
const ridged = (noise: NoiseWithDerivatives, x: number, y: number, octaves: number) => {
    let sum = 0, amplitude = 1, normalisation = 0, weight = 1
    for (let i = 0; i < octaves; i++) {
        let n = 1 - Math.abs(noise(x, y, derivative))
        n *= n * weight
        weight = clamp01(n * 1.8)
        sum += n * amplitude
        normalisation += amplitude
        amplitude *= 0.5
        const rx = (ROT_C * x - ROT_S * y) * 2.07
        y = (ROT_S * x + ROT_C * y) * 2.07
        x = rx
    }
    return sum / normalisation
}

export type TerrainShape = {
    regionFrequency: number
    warpFrequency: number
    warpAmount: number
    hillFrequency: number
    plainsAmplitude: number
    hillsAmplitude: number
    hillsLift: number            // raises the rolling ground so only its basins hold lakes
    mountainsStart: number       // region value where ranges begin / reach full height
    mountainsFull: number
    mountainFrequency: number
    mountainAmplitude: number
    mountainSharpness: number
    lakeDepth: number            // lakes approach (never exceed) this depth
}

export const defaultTerrainShape: TerrainShape = {
    regionFrequency: 0.00045,
    warpFrequency: 0.0012,
    warpAmount: 85,
    hillFrequency: 0.0042,
    plainsAmplitude: 10,
    hillsAmplitude: 38,
    hillsLift: 0.1,
    mountainsStart: -0.05,
    mountainsFull: 0.38,
    mountainFrequency: 0.0013,
    mountainAmplitude: 290,
    mountainSharpness: 2.2,
    lakeDepth: 7
}

export const getElevation = (
    noise: NoiseWithDerivatives,
    x: number,
    z: number,
    iterations: number,
    offsets: [number, number][],
    shape: TerrainShape = defaultTerrainShape
) => {
    // Regional character: plains .. hills .. mountain ranges
    const region = fbm(noise, x * shape.regionFrequency + offsets[0][0], z * shape.regionFrequency + offsets[0][1], 3)
    const hills = smoothstep(- 0.4, 0.15, region)
    const mountains = smoothstep(shape.mountainsStart, shape.mountainsFull, region)

    // Domain warp
    const wx = x + noise(x * shape.warpFrequency + offsets[1][0], z * shape.warpFrequency + offsets[1][1], derivative) * shape.warpAmount
    const wz = z + noise(x * shape.warpFrequency + offsets[2][0], z * shape.warpFrequency + offsets[2][1], derivative) * shape.warpAmount

    // Rolling ground everywhere
    const groundAmplitude = shape.plainsAmplitude + (shape.hillsAmplitude - shape.plainsAmplitude) * hills
    const ground = (erodedFbm(noise, wx * shape.hillFrequency + offsets[3][0], wz * shape.hillFrequency + offsets[3][1], iterations) + shape.hillsLift) * groundAmplitude

    // Mountain ranges rising out of it
    let ridges = 0
    if (mountains > 0) {
        const r = ridged(noise, wx * shape.mountainFrequency + offsets[4][0], wz * shape.mountainFrequency + offsets[4][1], iterations)
        ridges = Math.pow(r, shape.mountainSharpness) * shape.mountainAmplitude * mountains
    }

    let elevation = ground + ridges

    // Below the water level: shallow lake beds (smooth, slope 1 at the shore)
    if (elevation < WATER_LEVEL) {
        const depth = WATER_LEVEL - elevation
        elevation = WATER_LEVEL - depth / (1 + depth / shape.lakeDepth)
    }

    return elevation
}
