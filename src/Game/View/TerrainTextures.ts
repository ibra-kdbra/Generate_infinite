import * as THREE from 'three'

/**
 * Photo-scanned ground textures (Poly Haven, CC0) for the terrain's close-up detail, in two
 * texture arrays (colour, OpenGL normal maps), one layer per material:
 */
export const GROUND_LAYERS = [
    'rocky_terrain_02',      // 0 grassy ground
    'forrest_ground_01',     // 1 soil
    'cliff_side',            // 2 rock
    'coast_sand_01',         // 3 sand
    'snow_02',               // 4 snow
    'leafy_grass'            // 5 forest floor
]

const SIZE = 1024

async function decode(url: string) {
    const blob = await (await fetch(url)).blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(SIZE, SIZE)
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(bitmap, 0, 0, SIZE, SIZE)
    bitmap.close()
    return context.getImageData(0, 0, SIZE, SIZE).data
}

function arrayTexture(data: Uint8Array<ArrayBuffer>, layers: number, anisotropy: number) {
    const texture = new THREE.DataArrayTexture(data, SIZE, SIZE, layers)
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

/**
 * Loads all layers; resolves with the arrays and each layer's average colour (the shader
 * uses it to keep the terrain palette while taking the texture's detail).
 */
export async function loadTerrainTextures(anisotropy: number) {
    const layers = GROUND_LAYERS.length
    const albedo = new Uint8Array(SIZE * SIZE * 4 * layers)
    const normal = new Uint8Array(SIZE * SIZE * 4 * layers)
    const means: THREE.Vector3[] = []
    await Promise.all(GROUND_LAYERS.map(async (name, layer) => {
        const [color, bump] = await Promise.all([
            decode(`/textures/terrain/${name}_albedo.webp`),
            decode(`/textures/terrain/${name}_normal.webp`)
        ])
        albedo.set(color, layer * SIZE * SIZE * 4)
        normal.set(bump, layer * SIZE * SIZE * 4)
        let r = 0, g = 0, b = 0
        for (let i = 0; i < color.length; i += 64) {
            r += color[i]
            g += color[i + 1]
            b += color[i + 2]
        }
        const n = color.length / 64 * 255
        means[layer] = new THREE.Vector3(r / n, g / n, b / n)
    }))
    return {
        albedo: arrayTexture(albedo, layers, anisotropy),
        normal: arrayTexture(normal, layers, anisotropy),
        means
    }
}
