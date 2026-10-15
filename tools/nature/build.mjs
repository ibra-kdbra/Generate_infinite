/**
 * Builds the photo-scanned rocks and ferns from Poly Haven's CC0 models (2K glTF downloads:
 * namaqualand_boulder_02, rock_moss_set_01, rock_moss_set_02, fern_02) into
 *   public/models/nature/rocks.glb   every rock, centred on its base, ~1 m across, in two
 *                                    levels of detail (simplified here: the scans have up to
 *                                    100k triangles)
 *   public/models/nature/ferns.glb   the four fern fronds
 *   public/textures/nature/<set>_color.webp    albedo (ferns: alpha = the frond's outline)
 *   public/textures/nature/<set>_normal.webp   normal map xy, roughness in blue
 *
 *   npm install --prefix tools/nature
 *   node tools/nature/build.mjs <directory with the five model folders>
 *
 * Needs ImageMagick (`magick`) for the textures.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'

const [sourceDir] = process.argv.slice(2)
if (!sourceDir) {
    console.error('usage: node tools/nature/build.mjs <directory with the Poly Haven model folders>')
    process.exit(1)
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const modelsDir = path.join(root, 'public/models/nature')
const texturesDir = path.join(root, 'public/textures/nature')
mkdirSync(modelsDir, { recursive: true })
mkdirSync(texturesDir, { recursive: true })
const io = new NodeIO()

// which rocks to keep from each set, and the triangle budgets of the two levels of detail
const ROCKS = [
    { set: 'namaqualand_boulder_02', meshes: null, roughness: 'arm' },
    { set: 'rock_moss_set_01', meshes: ['rock01', 'rock03', 'rock05'], roughness: 'rough' },
    { set: 'rock_moss_set_02', meshes: ['rock08', 'rock10', 'rock12'], roughness: 'rough' }
]
const LODS = [2400, 420]

// ─────────────────────────────── mesh simplification ───────────────────────────────

class Heap {
    constructor() { this.items = [] }
    push(item) {
        const items = this.items
        items.push(item)
        let i = items.length - 1
        while (i > 0) {
            const parent = (i - 1) >> 1
            if (items[parent].cost <= items[i].cost)
                break
            ;[items[parent], items[i]] = [items[i], items[parent]]
            i = parent
        }
    }
    pop() {
        const items = this.items
        const top = items[0]
        const last = items.pop()
        if (items.length) {
            items[0] = last
            let i = 0
            for (;;) {
                const l = i * 2 + 1, r = l + 1
                let smallest = i
                if (l < items.length && items[l].cost < items[smallest].cost) smallest = l
                if (r < items.length && items[r].cost < items[smallest].cost) smallest = r
                if (smallest === i)
                    break
                ;[items[smallest], items[i]] = [items[i], items[smallest]]
                i = smallest
            }
        }
        return top
    }
    get size() { return this.items.length }
}

/**
 * Quadric error simplification (Garland & Heckbert) by half-edge collapses: a vertex merges
 * into a neighbour, which keeps its exact position, normal and texture coordinates, so the
 * scan's textures and normal map still fit. Vertices on open borders don't move; vertices
 * on texture seams only slide along their seam (each side keeping its own coordinates), and
 * the seams and borders weigh in the error so their lines keep their shape. Collapses that
 * would flip a triangle or pinch the surface are refused.
 */
function simplify(positions, normals, uvs, indices, target) {
    const vertexCount = positions.length / 3
    // weld split vertices (texture seams) into shared positions for the topology
    const welded = new Map()
    const point = new Int32Array(vertexCount)
    const corners = []
    for (let i = 0; i < vertexCount; i++) {
        const key = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`
        let p = welded.get(key)
        if (p === undefined) {
            p = corners.length
            welded.set(key, p)
            corners.push([])
        }
        point[i] = p
        corners[p].push(i)
    }
    const pointCount = corners.length
    const pos = new Float64Array(pointCount * 3)
    for (let p = 0; p < pointCount; p++)
        for (let k = 0; k < 3; k++)
            pos[p * 3 + k] = positions[corners[p][0] * 3 + k]

    const faceCount = indices.length / 3
    const faces = Int32Array.from(indices)            // corner (vertex) ids
    const alive = new Uint8Array(faceCount).fill(1)
    const facesOf = Array.from({ length: pointCount }, () => new Set())
    for (let f = 0; f < faceCount; f++)
        for (let k = 0; k < 3; k++)
            facesOf[point[faces[f * 3 + k]]].add(f)

    const faceNormal = (f, replace = -1, by = -1) => {
        const a = point[faces[f * 3]], b = point[faces[f * 3 + 1]], c = point[faces[f * 3 + 2]]
        const pa = a === replace ? by : a, pb = b === replace ? by : b, pc = c === replace ? by : c
        const ux = pos[pb * 3] - pos[pa * 3], uy = pos[pb * 3 + 1] - pos[pa * 3 + 1], uz = pos[pb * 3 + 2] - pos[pa * 3 + 2]
        const vx = pos[pc * 3] - pos[pa * 3], vy = pos[pc * 3 + 1] - pos[pa * 3 + 1], vz = pos[pc * 3 + 2] - pos[pa * 3 + 2]
        return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
    }

    // quadrics: the planes of the faces around each point, weighted by area
    const quadric = new Float64Array(pointCount * 10)
    const addPlane = (p, a, b, c, d, w) => {
        const q = quadric.subarray(p * 10, p * 10 + 10)
        q[0] += w * a * a; q[1] += w * a * b; q[2] += w * a * c; q[3] += w * a * d
        q[4] += w * b * b; q[5] += w * b * c; q[6] += w * b * d
        q[7] += w * c * c; q[8] += w * c * d; q[9] += w * d * d
    }
    for (let f = 0; f < faceCount; f++) {
        const n = faceNormal(f)
        const area = Math.hypot(...n)
        if (area < 1e-14)
            continue
        const a = n[0] / area, b = n[1] / area, c = n[2] / area
        const p0 = point[faces[f * 3]]
        const d = - (a * pos[p0 * 3] + b * pos[p0 * 3 + 1] + c * pos[p0 * 3 + 2])
        for (let k = 0; k < 3; k++)
            addPlane(point[faces[f * 3 + k]], a, b, c, d, area * 0.5)
    }
    const error = (p, x, y, z) => {
        const q = quadric.subarray(p * 10, p * 10 + 10)
        return q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x
            + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y
            + q[7] * z * z + 2 * q[8] * z + q[9]
    }

    // borders (edges with one face) are locked; seam edges (the two faces use different
    // corners) get a perpendicular plane in the error so the seam line holds its shape
    const locked = new Uint8Array(pointCount)
    const edgeFaces = new Map()
    for (let f = 0; f < faceCount; f++)
        for (let k = 0; k < 3; k++) {
            const a = point[faces[f * 3 + k]], b = point[faces[f * 3 + (k + 1) % 3]]
            const key = a < b ? a * pointCount + b : b * pointCount + a
            const list = edgeFaces.get(key)
            if (list) list.push(f)
            else edgeFaces.set(key, [f])
        }
    const cornerIn = (f, p) => {
        for (let k = 0; k < 3; k++)
            if (point[faces[f * 3 + k]] === p)
                return faces[f * 3 + k]
        return -1
    }
    const sameUv = (a, b) => uvs[a * 2] === uvs[b * 2] && uvs[a * 2 + 1] === uvs[b * 2 + 1]
    const constrain = (a, b, f, weight) => {
        // a plane through the edge, perpendicular to its face
        const n = faceNormal(f)
        const ex = pos[b * 3] - pos[a * 3], ey = pos[b * 3 + 1] - pos[a * 3 + 1], ez = pos[b * 3 + 2] - pos[a * 3 + 2]
        let px = ey * n[2] - ez * n[1], py = ez * n[0] - ex * n[2], pz = ex * n[1] - ey * n[0]
        const length = Math.hypot(px, py, pz)
        if (length < 1e-14)
            return
        px /= length; py /= length; pz /= length
        const d = - (px * pos[a * 3] + py * pos[a * 3 + 1] + pz * pos[a * 3 + 2])
        const w = weight * (ex * ex + ey * ey + ez * ez)
        addPlane(a, px, py, pz, d, w)
        addPlane(b, px, py, pz, d, w)
    }
    for (const [key, list] of edgeFaces) {
        const a = Math.floor(key / pointCount), b = key % pointCount
        if (list.length === 1) {
            locked[a] = locked[b] = 1
            constrain(a, b, list[0], 100)
        }
        else if (list.length === 2) {
            const seam = !sameUv(cornerIn(list[0], a), cornerIn(list[1], a)) || !sameUv(cornerIn(list[0], b), cornerIn(list[1], b))
            if (seam)
                constrain(a, b, list[0], 20)
        }
        else {
            locked[a] = locked[b] = 1          // non-manifold: leave alone
        }
    }

    const neighbours = (p) => {
        const result = new Set()
        for (const f of facesOf[p])
            for (let k = 0; k < 3; k++) {
                const q = point[faces[f * 3 + k]]
                if (q !== p)
                    result.add(q)
            }
        return result
    }

    const stamp = new Int32Array(pointCount)
    const dead = new Uint8Array(pointCount)
    const heap = new Heap()
    const consider = (v, u) => {
        if (locked[v] || dead[v] || dead[u])
            return
        const cost = error(v, pos[u * 3], pos[u * 3 + 1], pos[u * 3 + 2]) + error(u, pos[u * 3], pos[u * 3 + 1], pos[u * 3 + 2])
        heap.push({ cost, v, u, sv: stamp[v], su: stamp[u] })
    }
    for (const key of edgeFaces.keys()) {
        const a = Math.floor(key / pointCount), b = key % pointCount
        consider(a, b)
        consider(b, a)
    }

    let remaining = faceCount
    while (remaining > target && heap.size) {
        const { v, u, sv, su } = heap.pop()
        if (dead[v] || dead[u] || stamp[v] !== sv || stamp[u] !== su)
            continue
        // the faces along the edge disappear; the surface must stay a simple sheet there
        const shared = [...facesOf[v]].filter((f) => facesOf[u].has(f))
        if (shared.length === 0 || shared.length > 2)
            continue
        const common = [...neighbours(v)].filter((q) => neighbours(u).has(q))
        if (common.length !== shared.length)
            continue
        // refuse flips and slivers among the faces that stay
        let ok = true
        for (const f of facesOf[v]) {
            if (shared.includes(f))
                continue
            const before = faceNormal(f)
            const after = faceNormal(f, v, u)
            const lb = Math.hypot(...before), la = Math.hypot(...after)
            if (la < lb * 0.02 || (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) < 0.25 * lb * la) {
                ok = false
                break
            }
        }
        if (!ok)
            continue

        // each of v's corners becomes u's corner on the same side of any seam (from the faces
        // along the edge); a corner of v without such a face would tear the texture: refuse
        const cornerMap = new Map()
        for (const f of shared)
            cornerMap.set(cornerIn(f, v), cornerIn(f, u))
        let mapped = true
        for (const f of facesOf[v])
            if (!shared.includes(f) && !cornerMap.has(cornerIn(f, v)))
                mapped = false
        if (!mapped)
            continue
        // a seam vertex may only slide along its seam (the edge must be a seam edge)
        if (cornerMap.size === 1 && new Set(corners[v].map((c) => `${uvs[c * 2]},${uvs[c * 2 + 1]}`)).size > 1)
            continue
        for (const f of shared) {
            alive[f] = 0
            for (let k = 0; k < 3; k++)
                facesOf[point[faces[f * 3 + k]]].delete(f)
            remaining--
        }
        for (const f of facesOf[v]) {
            for (let k = 0; k < 3; k++)
                if (point[faces[f * 3 + k]] === v)
                    faces[f * 3 + k] = cornerMap.get(faces[f * 3 + k])
            facesOf[u].add(f)
        }
        facesOf[v].clear()
        dead[v] = 1
        for (let k = 0; k < 10; k++)
            quadric[u * 10 + k] += quadric[v * 10 + k]
        stamp[u]++
        for (const w of neighbours(u)) {
            stamp[w]++
            consider(w, u)
            consider(u, w)
            for (const x of neighbours(w))
                if (x !== u)
                    consider(w, x)
        }
    }

    // compact the corners still in use
    const remap = new Map()
    const outPositions = [], outNormals = [], outUvs = [], outIndices = []
    for (let f = 0; f < faceCount; f++) {
        if (!alive[f])
            continue
        for (let k = 0; k < 3; k++) {
            const c = faces[f * 3 + k]
            let index = remap.get(c)
            if (index === undefined) {
                index = remap.size
                remap.set(c, index)
                outPositions.push(positions[c * 3], positions[c * 3 + 1], positions[c * 3 + 2])
                outNormals.push(normals[c * 3], normals[c * 3 + 1], normals[c * 3 + 2])
                outUvs.push(uvs[c * 2], uvs[c * 2 + 1])
            }
            outIndices.push(index)
        }
    }
    return { positions: outPositions, normals: outNormals, uvs: outUvs, indices: outIndices }
}

// ─────────────────────────────────── models ───────────────────────────────────

function readPrimitive(node) {
    const primitive = node.getMesh().listPrimitives()[0]
    return {
        positions: Array.from(primitive.getAttribute('POSITION').getArray()),
        normals: Array.from(primitive.getAttribute('NORMAL').getArray()),
        uvs: Array.from(primitive.getAttribute('TEXCOORD_0').getArray()),
        indices: Array.from(primitive.getIndices().getArray())
    }
}

/** Centre on the base (x, z at the middle, lowest point at 0) and scale to ~1 m across. */
function normalise(data) {
    const min = [Infinity, Infinity, Infinity], max = [- Infinity, - Infinity, - Infinity]
    for (let i = 0; i < data.positions.length; i += 3)
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], data.positions[i + k])
            max[k] = Math.max(max[k], data.positions[i + k])
        }
    const center = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]
    const scale = 1 / Math.max(max[0] - min[0], max[2] - min[2])
    for (let i = 0; i < data.positions.length; i += 3)
        for (let k = 0; k < 3; k++)
            data.positions[i + k] = (data.positions[i + k] - center[k]) * scale
    return { height: (max[1] - min[1]) * scale }
}

function addMesh(document, buffer, name, data, extras) {
    const position = document.createAccessor().setType('VEC3').setArray(new Float32Array(data.positions)).setBuffer(buffer)
    const normal = document.createAccessor().setType('VEC3').setArray(new Float32Array(data.normals)).setBuffer(buffer)
    const uv = document.createAccessor().setType('VEC2').setArray(new Float32Array(data.uvs)).setBuffer(buffer)
    const indexArray = data.positions.length / 3 < 65536 ? new Uint16Array(data.indices) : new Uint32Array(data.indices)
    const index = document.createAccessor().setType('SCALAR').setArray(indexArray).setBuffer(buffer)
    const primitive = document.createPrimitive().setAttribute('POSITION', position).setAttribute('NORMAL', normal).setAttribute('TEXCOORD_0', uv).setIndices(index)
    const mesh = document.createMesh(name).addPrimitive(primitive).setExtras(extras)
    document.getRoot().listScenes()[0].addChild(document.createNode(name).setMesh(mesh))
}

function magick(...args) {
    execFileSync('magick', args, { stdio: 'inherit' })
}

function textures(set, folder, roughness, alphaFromRoughness = false) {
    const dir = path.join(folder, 'textures')
    const diffuse = path.join(dir, `${set}_diff_2k.jpg`)
    const normal = path.join(dir, `${set}_nor_gl_2k.jpg`)
    const rough = roughness === 'arm' ? path.join(dir, `${set}_arm_2k.jpg`) : path.join(dir, `${set}_rough_2k.jpg`)
    const roughChannel = roughness === 'arm' ? ['-channel', 'G', '-separate'] : ['-colorspace', 'gray']
    const color = path.join(texturesDir, `${set}_color.webp`)
    if (alphaFromRoughness)
        // the frond is where the roughness map isn't the background's flat white
        magick(diffuse, '-resize', '1024x1024', '(', rough, '-resize', '1024x1024', ...roughChannel, '-threshold', '90%', '-negate', '-morphology', 'Erode', 'Square:1', ')',
            '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', '-quality', '90', color)
    else
        magick(diffuse, '-resize', '1024x1024', '-quality', '88', color)
    magick(normal, '-resize', '1024x1024', '(', rough, '-resize', '1024x1024', ...roughChannel, ')', '-compose', 'CopyBlue', '-composite', '-quality', '92', path.join(texturesDir, `${set}_normal.webp`))
}

async function buildRocks() {
    const document = new Document()
    const buffer = document.createBuffer()
    document.createScene()
    for (const { set, meshes, roughness } of ROCKS) {
        const folder = path.join(sourceDir, set)
        const source = await io.read(path.join(folder, `${set}_2k.gltf`))
        const nodes = source.getRoot().listNodes().filter((node) => node.getMesh() && (!meshes || meshes.some((m) => node.getName().endsWith(m))))
        for (const node of nodes) {
            const data = readPrimitive(node)
            const { height } = normalise(data)
            const name = node.getName().replace(`${set}_`, '')
            LODS.forEach((budget, lod) => {
                const simplified = simplify(data.positions, data.normals, data.uvs, data.indices, budget)
                console.log(`${set} ${name} lod${lod}: ${data.indices.length / 3} -> ${simplified.indices.length / 3} triangles`)
                addMesh(document, buffer, `${set}_${name}_lod${lod}`, simplified, { textures: set, rock: `${set}/${name}`, lod, height })
            })
        }
        textures(set, folder, roughness)
    }
    await io.write(path.join(modelsDir, 'rocks.glb'), document)
}

async function buildFerns() {
    const set = 'fern_02'
    const folder = path.join(sourceDir, set)
    const source = await io.read(path.join(folder, `${set}_2k.gltf`))
    const document = new Document()
    const buffer = document.createBuffer()
    document.createScene()
    for (const node of source.getRoot().listNodes().filter((n) => n.getMesh())) {
        const data = readPrimitive(node)
        // fronds stay as they are (cut-out cards don't simplify well); just centred
        const min = [Infinity, Infinity, Infinity], max = [- Infinity, - Infinity, - Infinity]
        for (let i = 0; i < data.positions.length; i += 3)
            for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], data.positions[i + k])
                max[k] = Math.max(max[k], data.positions[i + k])
            }
        for (let i = 0; i < data.positions.length; i += 3) {
            data.positions[i] -= (min[0] + max[0]) / 2
            data.positions[i + 1] -= min[1]
            data.positions[i + 2] -= (min[2] + max[2]) / 2
        }
        console.log(`${set} ${node.getName()}: ${data.indices.length / 3} triangles, ${(max[1] - min[1]).toFixed(2)} m tall`)
        addMesh(document, buffer, node.getName(), data, { textures: set, height: max[1] - min[1] })
    }
    textures(set, folder, 'arm', true)
    await io.write(path.join(modelsDir, 'ferns.glb'), document)
}

if (!existsSync(sourceDir)) {
    console.error(`not found: ${sourceDir}`)
    process.exit(1)
}
await buildRocks()
await buildFerns()
