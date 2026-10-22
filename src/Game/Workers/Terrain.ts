import seedrandom from 'seedrandom'
import { createNoise2D } from './SimplexNoise'
import { createNoiseWithDerivatives, getElevation, WATER_LEVEL, defaultTerrainShape } from './TerrainShape'
import { vec3 } from 'gl-matrix'

const linearStep = (edgeMin: number, edgeMax: number, value: number) => {
    return Math.max(0.0, Math.min(1.0, (value - edgeMin) / (edgeMax - edgeMin)))
}

onmessage = function (event) {
    const started = performance.now()
    const id = event.data.id
    const size = event.data.size
    const baseX = event.data.x
    const baseZ = event.data.z
    const seed = event.data.seed
    const forestSeed = event.data.forestSeed as string
    const subdivisions = event.data.subdivisions
    const iterations = event.data.iterations
    const iterationsOffsets = event.data.iterationsOffsets
    const shape = event.data.shape || defaultTerrainShape
    const skirt = event.data.skirt ?? 15        // how far the edges hang down (State/Terrains.ts)

    const segments = subdivisions + 1
    
    // a small seeded generator (a string hash, then a 32-bit mix) for the noises' permutation
    // tables: the same seed always builds the same world
    const createRandom = (seed: string) => {
        let h = 0;
        for (let i = 0; i < seed.length; i++) h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
        return () => {
            h = Math.imul(h ^ h >>> 16, 0x85ebca6b);
            h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
            return ((h ^= h >>> 16) >>> 0) / 4294967296;
        };
    };
    
    const elevationNoise = createNoiseWithDerivatives(createRandom(seed));
    const grassNoise2D = createNoise2D(createRandom(seed + 'grass'));

    /**
     * Elevation
     */
    const overflowElevations = new Float32Array((segments + 1) * (segments + 1)) // Bigger to calculate normals more accurately
    const elevations = new Float32Array(segments * segments)

    for (let iX = 0; iX < segments + 1; iX++) {
        const x = baseX + (iX / subdivisions - 0.5) * size

        for (let iZ = 0; iZ < segments + 1; iZ++) {
            const z = baseZ + (iZ / subdivisions - 0.5) * size
            const elevation = getElevation(elevationNoise, x, z, iterations, iterationsOffsets, shape)

            const i = iZ * (segments + 1) + iX
            overflowElevations[i] = elevation

            if (iX < segments && iZ < segments) {
                const i = iZ * segments + iX
                elevations[i] = elevation
            }
        }
    }

    /**
     * Positions
     */
    const skirtCount = subdivisions * 4 + 4
    const positions = new Float32Array(segments * segments * 3 + skirtCount * 3)

    for (let iZ = 0; iZ < segments; iZ++) {
        const z = baseZ + (iZ / subdivisions - 0.5) * size
        for (let iX = 0; iX < segments; iX++) {
            const x = baseX + (iX / subdivisions - 0.5) * size

            const elevation = elevations[iZ * segments + iX]

            const iStride = (iZ * segments + iX) * 3
            positions[iStride] = x
            positions[iStride + 1] = elevation
            positions[iStride + 2] = z
        }
    }

    /**
     * Normals
     */
    const normals = new Float32Array(segments * segments * 3 + skirtCount * 3)

    const interSegmentX = - size / subdivisions
    const interSegmentZ = - size / subdivisions

    for (let iZ = 0; iZ < segments; iZ++) {
        for (let iX = 0; iX < segments; iX++) {
            // Indexes
            const iOverflowStride = iZ * (segments + 1) + iX

            // Elevations
            const currentElevation = overflowElevations[iOverflowStride]
            const neighbourXElevation = overflowElevations[iOverflowStride + 1]
            const neighbourZElevation = overflowElevations[iOverflowStride + segments + 1]

            // Deltas
            const deltaX = vec3.fromValues(
                interSegmentX,
                currentElevation - neighbourXElevation,
                0
            )

            const deltaZ = vec3.fromValues(
                0,
                currentElevation - neighbourZElevation,
                interSegmentZ
            )

            // Normal
            const normal = vec3.create()
            vec3.cross(normal, deltaZ, deltaX)
            vec3.normalize(normal, normal)

            const iStride = (iZ * segments + iX) * 3
            normals[iStride] = normal[0]
            normals[iStride + 1] = normal[1]
            normals[iStride + 2] = normal[2]
        }
    }

    /**
     * UV
     */
    const uv = new Float32Array(segments * segments * 2 + skirtCount * 2)

    for (let iZ = 0; iZ < segments; iZ++) {
        for (let iX = 0; iX < segments; iX++) {
            const iStride = (iZ * segments + iX) * 2
            uv[iStride] = iX / (segments - 1)
            uv[iStride + 1] = iZ / (segments - 1)
        }
    }

    /**
     * Indices
     */
    const indicesCount = subdivisions * subdivisions
    const indices = new (indicesCount < 65535 ? Uint16Array : Uint32Array)(indicesCount * 6 + subdivisions * 4 * 6 * 4)

    for (let iZ = 0; iZ < subdivisions; iZ++) {
        for (let iX = 0; iX < subdivisions; iX++) {
            const row = subdivisions + 1
            const a = iZ * row + iX
            const b = iZ * row + (iX + 1)
            const c = (iZ + 1) * row + iX
            const d = (iZ + 1) * row + (iX + 1)

            const iStride = (iZ * subdivisions + iX) * 6
            indices[iStride] = a
            indices[iStride + 1] = d
            indices[iStride + 2] = b

            indices[iStride + 3] = d
            indices[iStride + 4] = a
            indices[iStride + 5] = c
        }
    }

    /**
     * Skirt
     */
    let skirtIndex = segments * segments
    let indicesSkirtIndex = segments * segments

    // North (negative Z)
    for (let iX = 0; iX < segments; iX++) {
        const iZ = 0
        const iPosition = iZ * segments + iX
        const iPositionStride = iPosition * 3

        // Position
        positions[skirtIndex * 3] = positions[iPositionStride + 0]
        positions[skirtIndex * 3 + 1] = positions[iPositionStride + 1] - skirt
        positions[skirtIndex * 3 + 2] = positions[iPositionStride + 2]

        // Normal
        normals[skirtIndex * 3] = normals[iPositionStride + 0]
        normals[skirtIndex * 3 + 1] = normals[iPositionStride + 1]
        normals[skirtIndex * 3 + 2] = normals[iPositionStride + 2]

        // UV
        uv[skirtIndex * 2] = iZ / (segments - 1)
        uv[skirtIndex * 2 + 1] = iX / (segments - 1)

        // Index
        if (iX < segments - 1) {
            const a = iPosition
            const b = iPosition + 1
            const c = skirtIndex
            const d = skirtIndex + 1

            const iIndexStride = indicesSkirtIndex * 6
            indices[iIndexStride] = b
            indices[iIndexStride + 1] = d
            indices[iIndexStride + 2] = a

            indices[iIndexStride + 3] = c
            indices[iIndexStride + 4] = a
            indices[iIndexStride + 5] = d

            indicesSkirtIndex++
        }

        skirtIndex++
    }

    // South (positive Z)
    for (let iX = 0; iX < segments; iX++) {
        const iZ = segments - 1
        const iPosition = iZ * segments + iX
        const iPositionStride = iPosition * 3

        // Position
        positions[skirtIndex * 3] = positions[iPositionStride + 0]
        positions[skirtIndex * 3 + 1] = positions[iPositionStride + 1] - skirt
        positions[skirtIndex * 3 + 2] = positions[iPositionStride + 2]

        // Normal
        normals[skirtIndex * 3] = normals[iPositionStride + 0]
        normals[skirtIndex * 3 + 1] = normals[iPositionStride + 1]
        normals[skirtIndex * 3 + 2] = normals[iPositionStride + 2]

        // UV
        uv[skirtIndex * 2] = iZ / (segments - 1)
        uv[skirtIndex * 2 + 1] = iX / (segments - 1)

        // Index
        if (iX < segments - 1) {
            const a = iPosition
            const b = iPosition + 1
            const c = skirtIndex
            const d = skirtIndex + 1

            const iIndexStride = indicesSkirtIndex * 6
            indices[iIndexStride] = a
            indices[iIndexStride + 1] = c
            indices[iIndexStride + 2] = b

            indices[iIndexStride + 3] = d
            indices[iIndexStride + 4] = b
            indices[iIndexStride + 5] = c

            indicesSkirtIndex++
        }

        skirtIndex++
    }

    // West (negative X)
    for (let iZ = 0; iZ < segments; iZ++) {
        const iX = 0
        const iPosition = (iZ * segments + iX)
        const iPositionStride = iPosition * 3

        // Position
        positions[skirtIndex * 3] = positions[iPositionStride + 0]
        positions[skirtIndex * 3 + 1] = positions[iPositionStride + 1] - skirt
        positions[skirtIndex * 3 + 2] = positions[iPositionStride + 2]

        // Normal
        normals[skirtIndex * 3] = normals[iPositionStride + 0]
        normals[skirtIndex * 3 + 1] = normals[iPositionStride + 1]
        normals[skirtIndex * 3 + 2] = normals[iPositionStride + 2]

        // UV
        uv[skirtIndex * 2] = iZ / (segments - 1)
        uv[skirtIndex * 2 + 1] = iX

        // Index
        if (iZ < segments - 1) {
            const a = iPosition
            const b = iPosition + segments
            const c = skirtIndex
            const d = skirtIndex + 1

            const iIndexStride = indicesSkirtIndex * 6
            indices[iIndexStride] = a
            indices[iIndexStride + 1] = c
            indices[iIndexStride + 2] = b

            indices[iIndexStride + 3] = d
            indices[iIndexStride + 4] = b
            indices[iIndexStride + 5] = c

            indicesSkirtIndex++
        }

        skirtIndex++
    }

    for (let iZ = 0; iZ < segments; iZ++) {
        const iX = segments - 1
        const iPosition = (iZ * segments + iX)
        const iPositionStride = iPosition * 3

        // Position
        positions[skirtIndex * 3] = positions[iPositionStride + 0]
        positions[skirtIndex * 3 + 1] = positions[iPositionStride + 1] - skirt
        positions[skirtIndex * 3 + 2] = positions[iPositionStride + 2]

        // Normal
        normals[skirtIndex * 3] = normals[iPositionStride + 0]
        normals[skirtIndex * 3 + 1] = normals[iPositionStride + 1]
        normals[skirtIndex * 3 + 2] = normals[iPositionStride + 2]

        // UV
        uv[skirtIndex * 2] = iZ / (segments - 1)
        uv[skirtIndex * 2 + 1] = iX / (segments - 1)

        // Index
        if (iZ < segments - 1) {
            const a = iPosition
            const b = iPosition + segments
            const c = skirtIndex
            const d = skirtIndex + 1

            const iIndexStride = indicesSkirtIndex * 6
            indices[iIndexStride] = b
            indices[iIndexStride + 1] = d
            indices[iIndexStride + 2] = a

            indices[iIndexStride + 3] = c
            indices[iIndexStride + 4] = a
            indices[iIndexStride + 5] = d

            indicesSkirtIndex++
        }

        skirtIndex++
    }

    /**
     * Texture
     */
    const texture = new Float32Array(segments * segments * 4)

    for (let iZ = 0; iZ < segments; iZ++) {
        for (let iX = 0; iX < segments; iX++) {
            const iPositionStride = (iZ * segments + iX) * 3
            const position = vec3.fromValues(
                positions[iPositionStride],
                positions[iPositionStride + 1],
                positions[iPositionStride + 2]
            )

            // Normal
            const iNormalStride = (iZ * segments + iX) * 3
            const normal = vec3.fromValues(
                normals[iNormalStride],
                normals[iNormalStride + 1],
                normals[iNormalStride + 2]
            )

            // Grass: thins into bare patches here and there, never at the waterline or on
            // the high alpine ground, fades on steep slopes
            const grassFrequency = 0.015
            const patches = linearStep(- 0.95, - 0.55, grassNoise2D(position[0] * grassFrequency + iterationsOffsets[0][0], position[2] * grassFrequency + iterationsOffsets[0][1]))
            const shore = linearStep(WATER_LEVEL + 0.2, WATER_LEVEL + 0.75, position[1])
            const alpine = 1 - linearStep(150, 205, position[1])
            const upward = linearStep(0.5, 0.85, Math.max(0, normal[1]))
            const grass = patches * shore * alpine * upward

            // Final texture
            const iTextureStride = (iZ * segments + iX) * 4
            // Horizontal normal components; the up component (always >= 0 on a heightmap) is
            // rebuilt in the shaders as sqrt(1 - x*x - z*z). Storing x/y and rebuilding z lost
            // z's sign and lit every north-facing slope as if it faced south.
            texture[iTextureStride] = normal[0];
            texture[iTextureStride + 1] = normal[2];
            texture[iTextureStride + 2] = grass; // Grass Density in Blue
            texture[iTextureStride + 3] = position[1]; // Elevation in Alpha
        }
    }

    /**
     * Forest canopy: how much of the ground the tree crowns cover, from the very rules
     * State/Vegetation places its trees with (same noise, same seeds). The terrain shows it
     * as distant forest beyond where trees are drawn.
     */
    const forestNoise = createNoise2D(seedrandom(forestSeed + 'forest'))
    const detailNoise = createNoise2D(seedrandom(forestSeed + 'detail'))
    const smooth = (a: number, b: number, x: number) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
        return t * t * (3 - 2 * t)
    }
    const vertexCount = positions.length / 3
    const forest = new Float32Array(vertexCount)
    for (let i = 0; i < vertexCount; i++) {
        const x = positions[i * 3], e = positions[i * 3 + 1], z = positions[i * 3 + 2]
        const n = forestNoise(x * 0.0016, z * 0.0016) * 0.75 + detailNoise(x * 0.007, z * 0.007) * 0.25
        const treeLine = 1 - smooth(165, 215, e + detailNoise(x * 0.01, z * 0.01) * 25)
        const flatEnough = 1 - smooth(0.28, 0.42, 1 - Math.max(0, normals[i * 3 + 1]))
        const shore = smooth(0.6, 2.5, e - WATER_LEVEL)
        forest[i] = smooth(0.0, 0.35, n) * treeLine * flatEnough * shore
    }

    // Post
    ;(self as unknown as Worker).postMessage({
        milliseconds: performance.now() - started,
        id: id,
        positions: positions,
        normals: normals,
        indices: indices,
        texture: texture,
        uv: uv,
        forest: forest
    }, [positions.buffer, normals.buffer, indices.buffer, texture.buffer, uv.buffer, forest.buffer] as Transferable[])     // handed over, not copied
}
