import * as THREE from 'three'

import CompressWorker from '../Workers/TextureCompress?worker'

/**
 * Photo-scanned ground textures (Poly Haven, CC0, tools/terrain/build.sh) for the terrain's
 * close-up detail, in two texture arrays, one layer per material: colour with ambient
 * occlusion in alpha (as 0.5 + 0.5 × AO), and normal maps packed with x in alpha, y in
 * green and roughness in red. 2048² on high and ultra quality, 1024² below.
 *
 * Where the graphics card supports it (desktop cards do) they're compressed to BC3 in
 * background workers on the first visit, mipmaps and all, and kept in the browser's cache
 * for the next ones: a quarter of the graphics memory (64 MB instead of 256 MB at 2048²) and
 * of the bandwidth the terrain shader spends reading them, which is most of its cost.
 */
export const GROUND_LAYERS = [
    'forrest_ground_01',     // 0 grassy ground (grass, twigs, dry leaves)
    'rocky_terrain_02',      // 1 soil on slopes (stony)
    'cliff_side',            // 2 rock
    'coast_sand_01',         // 3 sand
    'snow_02',               // 4 snow
    'leafy_grass'            // 5 forest floor
]

const CACHE = 'generate-infinite-textures-v1'
type Level = { width: number, height: number, data: Uint8Array }

async function decode(url: string, size: number) {
    const blob = await (await fetch(url)).blob()
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    const canvas = new OffscreenCanvas(size, size)
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(bitmap, 0, 0, size, size)
    bitmap.close()
    return new Uint8Array(context.getImageData(0, 0, size, size).data.buffer)
}

/** The normal maps' channel layout for this project: x to alpha, roughness to red (and blue). */
function repackNormal(data: Uint8Array) {
    for (let i = 0; i < data.length; i += 4) {
        const x = data[i], roughness = data[i + 2]
        data[i] = roughness
        data[i + 2] = roughness
        data[i + 3] = x
    }
    return data
}

function mean(data: Uint8Array) {
    let r = 0, g = 0, b = 0
    for (let i = 0; i < data.length; i += 64) {
        r += data[i]
        g += data[i + 1]
        b += data[i + 2]
    }
    const n = data.length / 64 * 255
    return new THREE.Vector3(r / n, g / n, b / n)
}

function arrayTexture(data: Uint8Array<ArrayBuffer>, size: number, layers: number, anisotropy: number) {
    const texture = new THREE.DataArrayTexture(data, size, size, layers)
    texture.format = THREE.RGBAFormat
    texture.type = THREE.UnsignedByteType
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = true
    texture.anisotropy = anisotropy
    texture.needsUpdate = true
    return texture
}

/** A pool of compression workers, one job per texture layer. */
class Compressor {
    private workers: Worker[] = []
    private jobs = new Map<number, (levels: Level[]) => void>()
    private next = 0
    private turn = 0

    constructor(count: number) {
        for (let i = 0; i < count; i++) {
            const worker = new CompressWorker()
            worker.onmessage = (event: MessageEvent<{ id: number, levels: Level[] }>) => {
                this.jobs.get(event.data.id)?.(event.data.levels)
                this.jobs.delete(event.data.id)
            }
            this.workers.push(worker)
        }
    }

    compress(data: Uint8Array, size: number, kind: 'albedo' | 'normal') {
        const id = this.next++
        return new Promise<Level[]>((resolve) => {
            this.jobs.set(id, resolve)
            this.workers[this.turn++ % this.workers.length].postMessage({ id, data, size, kind }, [data.buffer])
        })
    }

    dispose() {
        for (const worker of this.workers)
            worker.terminate()
    }
}

/** Level sizes of a full BC3 mip chain for a square texture. */
function chain(size: number) {
    const levels: { width: number, height: number, bytes: number }[] = []
    for (let s = size; ; s = Math.max(1, s >> 1)) {
        levels.push({ width: s, height: s, bytes: Math.ceil(s / 4) * Math.ceil(s / 4) * 16 })
        if (s === 1) break
    }
    return levels
}

/** One compressed layer: from the browser's cache, else decoded and compressed now (then cached). */
async function compressedLayer(name: string, kind: 'albedo' | 'normal', size: number, compressor: () => Compressor, cache: Cache | null) {
    const key = `/compressed/${name}-${kind}-${size}.bc3`
    const sizes = chain(size)
    const cached = await cache?.match(key)
    if (cached) {
        const buffer = await cached.arrayBuffer()
        const header = new Float32Array(buffer, 0, 4)
        let offset = 16
        const levels = sizes.map((level) => {
            const data = new Uint8Array(buffer, offset, level.bytes)
            offset += level.bytes
            return { width: level.width, height: level.height, data }
        })
        return { levels, mean: new THREE.Vector3(header[0], header[1], header[2]) }
    }
    const pixels = await decode(`/textures/terrain/${name}_${kind}.webp`, size)
    const average = kind === 'albedo' ? mean(pixels) : new THREE.Vector3()
    const levels = await compressor().compress(pixels, size, kind)
    if (cache) {
        const total = 16 + levels.reduce((sum, level) => sum + level.data.length, 0)
        const blob = new Uint8Array(total)
        new Float32Array(blob.buffer, 0, 4).set([average.x, average.y, average.z, 0])
        let offset = 16
        for (const level of levels) {
            blob.set(level.data, offset)
            offset += level.data.length
        }
        cache.put(key, new Response(blob, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {})
    }
    return { levels, mean: average }
}

function compressedArray(layers: Level[][], size: number, anisotropy: number) {
    const mipmaps = chain(size).map((level, i) => {
        const data = new Uint8Array(level.bytes * layers.length)
        layers.forEach((layer, l) => data.set(layer[i].data, l * level.bytes))
        return { data, width: level.width, height: level.height }
    })
    const texture = new THREE.CompressedArrayTexture(mipmaps as unknown as ImageData[], size, size, layers.length, THREE.RGBA_S3TC_DXT5_Format, THREE.UnsignedByteType)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.anisotropy = anisotropy
    texture.needsUpdate = true
    return texture
}

/**
 * Loads all layers; resolves with the arrays and each layer's average colour (the shader
 * uses it to keep the terrain palette while taking the texture's detail).
 */
export async function loadTerrainTextures(anisotropy: number, size: number, compress = false) {
    const layers = GROUND_LAYERS.length
    if (compress) {
        let compressor: Compressor | null = null
        const getCompressor = () => compressor ??= new Compressor(Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)))
        const cache = await caches?.open(CACHE).catch(() => null) ?? null
        try {
            const results = await Promise.all(GROUND_LAYERS.map((name) => Promise.all([
                compressedLayer(name, 'albedo', size, getCompressor, cache),
                compressedLayer(name, 'normal', size, getCompressor, cache)
            ])))
            return {
                albedo: compressedArray(results.map(([albedo]) => albedo.levels), size, anisotropy),
                normal: compressedArray(results.map(([, normal]) => normal.levels), size, anisotropy),
                means: results.map(([albedo]) => albedo.mean),
                compressed: true
            }
        }
        finally {
            (compressor as Compressor | null)?.dispose()
        }
    }

    const albedo = new Uint8Array(size * size * 4 * layers)
    const normal = new Uint8Array(size * size * 4 * layers)
    const means: THREE.Vector3[] = []
    await Promise.all(GROUND_LAYERS.map(async (name, layer) => {
        const [color, bump] = await Promise.all([
            decode(`/textures/terrain/${name}_albedo.webp`, size),
            decode(`/textures/terrain/${name}_normal.webp`, size)
        ])
        albedo.set(color, layer * size * size * 4)
        normal.set(repackNormal(bump), layer * size * size * 4)
        means[layer] = mean(color)
    }))
    return {
        albedo: arrayTexture(albedo, size, layers, anisotropy),
        normal: arrayTexture(normal, size, layers, anisotropy),
        means,
        compressed: false
    }
}
