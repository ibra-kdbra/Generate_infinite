/**
 * Builds the player characters and their animations from Quaternius' CC0 packs:
 *   Universal Base Characters [Standard]          (heads, eyes, eyebrows, hair)
 *   Modular Character Outfits - Fantasy [Standard] (Ranger / Peasant outfits)
 *   Universal Animation Library [Standard]        (animations)
 * into public/models/characters/:
 *   <gender>_<outfit>.glb  outfit + the base character's head, one skeleton, WebP textures
 *   animations.glb         the clips the game uses: rotations only (plus the pelvis
 *                          translation), so they fit any body built on this skeleton
 *
 *   npm install --prefix tools/characters
 *   node tools/characters/build.mjs <base characters dir> <outfits dir> <UAL1_Standard.glb>
 *
 * Needs ImageMagick (`magick`) for the textures.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { compactPrimitive, dedup, mergeDocuments, prune, resample, unpartition } from '@gltf-transform/functions'

const [baseDir, outfitsDir, animationsPath] = process.argv.slice(2)
if (!baseDir || !outfitsDir || !animationsPath) {
    console.error('usage: node tools/characters/build.mjs <base characters dir> <outfits dir> <UAL1_Standard.glb>')
    process.exit(1)
}
const outDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../public/models/characters')
mkdirSync(outDir, { recursive: true })

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const tmp = mkdtempSync(path.join(tmpdir(), 'characters-'))

const CHARACTERS = [
    { name: 'male_ranger', gender: 'Male', outfit: 'Ranger', extras: ['Hair_Beard'] },          // hood up
    { name: 'female_ranger', gender: 'Female', outfit: 'Ranger', extras: [] },                 // hood up
    { name: 'male_peasant', gender: 'Male', outfit: 'Peasant', extras: ['Hair_SimpleParted'] },
    { name: 'female_peasant', gender: 'Female', outfit: 'Peasant', extras: ['Hair_Long'] }
]

const CLIPS = [
    'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
    'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Roll',
    'Swim_Idle_Loop', 'Swim_Fwd_Loop'
]

/** Read a .gltf whose image URIs may be misspelled ("T_Eye_Normal_png.png"). */
async function read(file) {
    const dir = path.dirname(file)
    const json = JSON.parse(readFileSync(file, 'utf8'))
    const resources = {}
    for (const item of [...(json.buffers || []), ...(json.images || [])]) {
        if (!item.uri)
            continue
        if (!existsSync(path.join(dir, item.uri)) && existsSync(path.join(dir, item.uri.replace(/_png\.png$/, '.png'))))
            item.uri = item.uri.replace(/_png\.png$/, '.png')
        resources[item.uri] = new Uint8Array(readFileSync(path.join(dir, item.uri)))
    }
    return io.readJSON({ json, resources })
}

/** Keep only the triangles of a skinned mesh that hang on these bones (the head). */
function keepTrianglesOnBones(node, boneNames, threshold) {
    const joints = node.getSkin().listJoints()
    const wanted = new Set(joints.map((joint, i) => boneNames.includes(joint.getName()) ? i : -1).filter(i => i >= 0))
    for (const primitive of node.getMesh().listPrimitives()) {
        const J = primitive.getAttribute('JOINTS_0')
        const W = primitive.getAttribute('WEIGHTS_0')
        const indices = primitive.getIndices()
        const weight = (v) => {
            const j = J.getElement(v, []), w = W.getElement(v, [])
            return j.reduce((sum, joint, k) => sum + (wanted.has(joint) ? w[k] : 0), 0)
        }
        const kept = []
        const source = indices.getArray()
        for (let i = 0; i < source.length; i += 3)
            if (weight(source[i]) >= threshold && weight(source[i + 1]) >= threshold && weight(source[i + 2]) >= threshold)
                kept.push(source[i], source[i + 1], source[i + 2])
        indices.setArray(new Uint32Array(kept))
        compactPrimitive(primitive)
    }
}

/** Largest difference between two skins' inverse bind matrices for the head and neck bones
 *  (the only ones the merged parts hang on; the packs' thumbs differ, which doesn't matter). */
function bindDifference(skinA, skinB) {
    const a = new Map(skinA.listJoints().map((joint, i) => [joint.getName(), skinA.getInverseBindMatrices().getElement(i, [])]))
    let max = 0
    skinB.listJoints().forEach((joint, i) => {
        if (!['Head', 'neck_01', 'spine_03'].includes(joint.getName()))
            return
        const m = a.get(joint.getName())
        if (!m) { max = Infinity; return }
        const n = skinB.getInverseBindMatrices().getElement(i, [])
        for (let k = 0; k < 16; k++) max = Math.max(max, Math.abs(m[k] - n[k]))
    })
    return max
}

/** Merge the skinned meshes of another file onto this document's skeleton. */
async function mergeOnto(document, skin, armature, sourcePath, keep) {
    const source = await read(sourcePath)
    const meshNodes = source.getRoot().listNodes().filter(node => node.getMesh() && node.getSkin())
    if (keep)
        keep(meshNodes)
    const difference = bindDifference(skin, meshNodes[0].getSkin())
    if (difference > 1e-3)
        console.warn(`  ! ${path.basename(sourcePath)}: bind pose differs from the outfit's (${difference.toFixed(4)})`)
    const map = mergeDocuments(document, source)
    for (const node of meshNodes) {
        const merged = map.get(node)
        merged.setSkin(skin)
        armature.addChild(merged)
    }
}

/** Resize and re-encode every texture as WebP. */
function compressTextures(document) {
    document.createExtension(EXTTextureWebP).setRequired(true)
    const normals = new Set(document.getRoot().listMaterials().map(m => m.getNormalTexture()).filter(Boolean))
    for (const texture of document.getRoot().listTextures()) {
        const input = path.join(tmp, 'in.png'), output = path.join(tmp, 'out.webp')
        writeFileSync(input, texture.getImage())
        const small = /eye/i.test(texture.getURI() + texture.getName())
        execFileSync('magick', [input, '-resize', small ? '256x256>' : '1024x1024>', '-quality', normals.has(texture) ? '92' : '84', output])
        texture.setImage(readFileSync(output)).setMimeType('image/webp')
        texture.setURI(path.basename(texture.getURI() || texture.getName() || 'texture', '.png') + '.webp')
    }
}

for (const character of CHARACTERS) {
    const outfitPath = path.join(outfitsDir, 'Exports/glTF (Godot-Unreal)/Outfits', `${character.gender}_${character.outfit}.gltf`)
    const document = await read(outfitPath)
    const root = document.getRoot()
    const scene = root.listScenes()[0]
    const skin = root.listSkins()[0]
    const armature = root.listNodes().find(node => node.getName() === 'Armature')

    // the base character's head (the outfit covers the rest), eyes and eyebrows
    await mergeOnto(document, skin, armature, path.join(baseDir, 'Base Characters/Godot - UE', `Superhero_${character.gender}_FullBody.gltf`), (nodes) => {
        for (const node of nodes)
            if (!/eye/i.test(node.getName()))
                keepTrianglesOnBones(node, ['Head', 'neck_01'], 0.5)
    })
    for (const extra of character.extras)
        await mergeOnto(document, skin, armature, path.join(baseDir, 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)', `${extra}.gltf`))

    // drop the merged files' own scenes and skeletons
    for (const other of root.listScenes())
        if (other !== scene)
            other.dispose()
    root.setDefaultScene(scene)
    await document.transform(prune(), dedup())
    compressTextures(document)
    await document.transform(prune(), dedup(), unpartition())
    await document.transform(prune())

    const file = path.join(outDir, `${character.name}.glb`)
    writeFileSync(file, await io.writeBinary(document))
    const triangles = root.listMeshes().flatMap(m => m.listPrimitives()).reduce((sum, p) => sum + p.getIndices().getCount() / 3, 0)
    console.log(`${character.name}.glb  ${(readFileSync(file).length / 1024).toFixed(0)} KB  ${triangles} triangles  ${root.listTextures().length} textures`)
}

// ── animations ──
{
    const document = await io.read(animationsPath)
    const root = document.getRoot()
    for (const animation of root.listAnimations()) {
        if (!CLIPS.includes(animation.getName())) {
            // samplers outlive their animation and would keep its keyframe data alive
            animation.listChannels().forEach(channel => channel.dispose())
            animation.listSamplers().forEach(sampler => sampler.dispose())
            animation.dispose()
            continue
        }
        // rotations carry the motion; the mannequin's bone lengths (translations) and scales
        // must not be forced onto other bodies. The pelvis keeps its translation (body bob).
        for (const channel of animation.listChannels()) {
            const path = channel.getTargetPath()
            if (path === 'scale' || (path === 'translation' && channel.getTargetNode().getName() !== 'pelvis')) {
                const sampler = channel.getSampler()
                channel.dispose()
                sampler.dispose()
            }
        }
    }
    for (const node of root.listNodes())
        if (node.getMesh())
            node.setMesh(null).setSkin(null)
    for (const mesh of root.listMeshes())
        mesh.dispose()
    await document.transform(resample(), prune(), dedup())

    const file = path.join(outDir, 'animations.glb')
    writeFileSync(file, await io.writeBinary(document))
    const pelvis = root.listNodes().find(node => node.getName() === 'pelvis')
    console.log(`animations.glb  ${(readFileSync(file).length / 1024).toFixed(0)} KB  ${root.listAnimations().map(a => a.getName()).join(', ')}  (mannequin pelvis ${pelvis.getTranslation().map(v => v.toFixed(4))})`)
}

rmSync(tmp, { recursive: true, force: true })
