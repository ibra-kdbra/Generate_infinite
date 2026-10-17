/**
 * Gives the Rangers hair to wear under the hood (or with it down): copies a hairstyle from
 * the matching Villager build onto the Ranger's skeleton. Both outfits share the base
 * character's skeleton joint for joint, and the hair material (the eyebrows use it too).
 * Plain GLB surgery, no dependencies; build.mjs adds the same hair from the source packs.
 *
 *   node tools/characters/add-hair.mjs
 */
import path from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../public/models/characters')
const PATCHES = [
    { target: 'male_ranger', source: 'male_peasant', hair: 'Hair_SimpleParted' },
    { target: 'female_ranger', source: 'female_peasant', hair: 'Hair_Long' }
]

function readGlb(file) {
    const data = readFileSync(file)
    const jsonLength = data.readUInt32LE(12)
    const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'))
    const binStart = 20 + jsonLength + 8
    const bin = data.subarray(binStart, binStart + data.readUInt32LE(20 + jsonLength))
    return { json, bin }
}

function writeGlb(file, json, bin) {
    const pad = (buffer, byte) => Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4, byte)])
    const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20)
    const binChunk = pad(bin, 0)
    const header = Buffer.alloc(12)
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4)
    header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)
    const chunk = (buffer, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(buffer.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, buffer]) }
    writeFileSync(file, Buffer.concat([header, chunk(jsonChunk, 0x4e4f534a), chunk(binChunk, 0x004e4942)]))
}

for (const { target, source, hair } of PATCHES) {
    const file = path.join(dir, `${target}.glb`)
    const a = readGlb(file), b = readGlb(path.join(dir, `${source}.glb`))
    if (a.json.nodes.some((node) => node.name === hair)) {
        console.log(`${target}: already has ${hair}`)
        continue
    }
    const jointNames = (glb) => glb.json.skins[0].joints.map((i) => glb.json.nodes[i].name).join()
    if (jointNames(a) !== jointNames(b))
        throw new Error(`${source}: skeleton differs from ${target}'s`)

    const node = b.json.nodes.find((n) => n.name === hair)
    const mesh = b.json.meshes[node.mesh]
    let bin = Buffer.from(a.bin)
    const copied = new Map()
    const copyAccessor = (index) => {
        if (copied.has(index)) return copied.get(index)
        const accessor = { ...b.json.accessors[index] }
        const view = b.json.bufferViews[accessor.bufferView]
        const bytes = b.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
        bin = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)])
        a.json.bufferViews.push({ ...view, buffer: 0, byteOffset: bin.length })
        bin = Buffer.concat([bin, bytes])
        accessor.bufferView = a.json.bufferViews.length - 1
        a.json.accessors.push(accessor)
        copied.set(index, a.json.accessors.length - 1)
        return a.json.accessors.length - 1
    }
    const materialName = (glb, i) => glb.json.materials[i].name
    const primitives = mesh.primitives.map((primitive) => {
        const material = a.json.materials.findIndex((m) => m.name === materialName(b, primitive.material))
        if (material < 0)
            throw new Error(`${target}: no material ${materialName(b, primitive.material)}`)
        const attributes = Object.fromEntries(Object.entries(primitive.attributes).map(([name, i]) => [name, copyAccessor(i)]))
        return { ...primitive, attributes, indices: copyAccessor(primitive.indices), material }
    })
    a.json.meshes.push({ name: mesh.name, primitives })
    a.json.nodes.push({ name: hair, mesh: a.json.meshes.length - 1, skin: 0 })
    // beside the other skinned meshes
    const parent = a.json.nodes.find((n) => (n.children ?? []).some((c) => a.json.nodes[c].skin === 0))
    parent.children.push(a.json.nodes.length - 1)
    a.json.buffers[0].byteLength = bin.length
    writeGlb(file, a.json, bin)
    console.log(`${target}.glb + ${hair}  ${(readFileSync(file).length / 1024).toFixed(0)} KB`)
}
