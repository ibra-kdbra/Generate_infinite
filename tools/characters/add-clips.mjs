/**
 * Adds clips from Quaternius' Universal Animation Library glTFs (the free Standard packs,
 * CC0; same skeleton as the characters) to public/models/characters/animations.glb: the
 * bones' rotations, and the pelvis' translation (the body's bob), as build.mjs keeps them so
 * they fit any body on this skeleton. Plain GLB surgery, no dependencies; a clip already
 * there is replaced.
 *
 *   node tools/characters/add-clips.mjs <UAL1_Standard.glb> <UAL2_Standard.glb>
 */
import path from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

const CLIPS = {
    // the first library: holding a sword and a torch
    ual1: ['Sword_Idle', 'Sword_Attack', 'Idle_Torch_Loop'],
    // the second: sword attacks and their recoveries, the woodcutter's chop, farm work, a lantern held up
    ual2: ['Sword_Regular_A', 'Sword_Regular_A_Rec', 'Sword_Regular_B', 'Sword_Regular_B_Rec', 'Sword_Regular_C', 'Sword_Regular_Combo',
        'Sword_Heavy_Combo', 'Sword_Dash', 'Sword_Block', 'TreeChopping_Loop', 'Farm_Harvest', 'Farm_PlantSeed', 'Farm_Watering', 'Idle_Lantern_Loop', 'ClimbUp_1m']
}

const [ual1, ual2] = process.argv.slice(2)
if (!ual1 || !ual2) {
    console.error('usage: node tools/characters/add-clips.mjs <UAL1_Standard.glb> <UAL2_Standard.glb>')
    process.exit(1)
}
const target = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../public/models/characters/animations.glb')

function readGlb(file) {
    const data = readFileSync(file)
    const jsonLength = data.readUInt32LE(12)
    const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'))
    const binStart = 20 + jsonLength + 8
    return { json, bin: data.subarray(binStart, binStart + data.readUInt32LE(20 + jsonLength)) }
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

const out = readGlb(target)
const nodeByName = new Map(out.json.nodes.map((node, i) => [node.name, i]))
let bin = Buffer.from(out.bin)
const COMPONENTS = { SCALAR: 1, VEC3: 3, VEC4: 4 }

for (const [file, names] of [[ual1, CLIPS.ual1], [ual2, CLIPS.ual2]]) {
    const source = readGlb(file)
    const copy = (index) => {
        const accessor = source.json.accessors[index]
        const view = source.json.bufferViews[accessor.bufferView]
        if (accessor.componentType !== 5126 || (view.byteStride && view.byteStride !== COMPONENTS[accessor.type] * 4))
            throw new Error(`accessor ${index}: unexpected layout`)
        const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
        const bytes = source.bin.subarray(start, start + accessor.count * COMPONENTS[accessor.type] * 4)
        bin = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)])
        out.json.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: bytes.length })
        bin = Buffer.concat([bin, bytes])
        out.json.accessors.push({ ...accessor, bufferView: out.json.bufferViews.length - 1, byteOffset: 0 })
        return out.json.accessors.length - 1
    }
    for (const name of names) {
        const clip = source.json.animations.find((a) => a.name === name)
        if (!clip)
            throw new Error(`${path.basename(file)}: no clip ${name}`)
        const animation = { name, channels: [], samplers: [] }
        for (const channel of clip.channels) {
            const node = source.json.nodes[channel.target.node].name
            const path = channel.target.path
            // rotations carry the motion; the pelvis keeps its translation (the body's bob)
            if (path !== 'rotation' && !(path === 'translation' && node === 'pelvis'))
                continue
            if (!nodeByName.has(node))
                continue
            const sampler = clip.samplers[channel.sampler]
            animation.samplers.push({ input: copy(sampler.input), output: copy(sampler.output), interpolation: sampler.interpolation ?? 'LINEAR' })
            animation.channels.push({ sampler: animation.samplers.length - 1, target: { node: nodeByName.get(node), path } })
        }
        const existing = out.json.animations.findIndex((a) => a.name === name)
        if (existing >= 0) out.json.animations.splice(existing, 1)
        out.json.animations.push(animation)
        console.log(`${name}: ${animation.channels.length} channels`)
    }
}
out.json.buffers[0].byteLength = bin.length
writeGlb(target, out.json, bin)
console.log(`animations.glb  ${(readFileSync(target).length / 1024).toFixed(0)} KB  ${out.json.animations.length} clips`)
