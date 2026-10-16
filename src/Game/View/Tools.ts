import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Settings from '../Settings'
import { PLANT, Plant } from '../State/Vegetation'
import { WATER_LEVEL } from '../Workers/TerrainShape'
import { createTool, createToolMaterials, createArrowGeometry, ToolName, ToolMaterials } from './ToolModels'
import { GRIP_LEFT, GRIP_RIGHT, HandTarget, ToolPose } from './CharacterPose'
import Trail from './Trail'

// Three tools per outfit: the ranger's and the farmer's
const SETS: Record<'ranger' | 'peasant', ToolName[]> = {
    ranger: ['sword', 'bow', 'torch'],
    peasant: ['axe', 'hoe', 'sickle']
}
export const TOOL_LABELS: Record<ToolName, string> = { sword: 'Sword', bow: 'Bow', torch: 'Torch', axe: 'Axe', hoe: 'Hoe', sickle: 'Sickle' }
const ACTIONS: Record<ToolName, string> = {
    sword: 'Slash · press again in time to chain',
    bow: 'Hold to draw · release to shoot',
    torch: 'Hold to raise the torch',
    axe: 'Chop · enough chops fell a tree',
    hoe: 'Till the soil',
    sickle: 'Reap the grass'
}
export const TOOL_ICONS: Record<ToolName, string> = {
    sword: '<path d="M19.5 4.5 9.5 14.5"/><path d="M19.5 4.5h-3.2M19.5 4.5v3.2"/><path d="m7 12 5 5"/><path d="m8.5 15.5-4 4"/>',
    bow: '<path d="M6.5 3.5c9 3 9 14 0 17"/><path d="M6.5 3.5v17"/><path d="M3.5 12h15"/><path d="m15.5 9 3 3-3 3"/>',
    torch: '<path d="M10.2 11h3.6L13 20.5h-2z"/><path d="M12 3c2.6 2.4 2.6 5.4 0 7-2.6-1.6-2.6-4.6 0-7z"/>',
    axe: '<path d="M5.5 20 15 7"/><path d="M12.4 6.6c2.6-2.9 6.5-2.4 7.6.3l-4.4 3.3z"/>',
    hoe: '<path d="M5 20 16.5 6.5"/><path d="m14.5 4.5 5 5-2.4 1.6"/>',
    sickle: '<path d="m6 20 3.4-4.2"/><path d="M9.4 15.8C4.6 10.4 9.6 3.4 17.8 4.4c-5 1.6-7.4 5.4-5.6 10"/>'
}

type V3 = [number, number, number]
// One key pose of a stroke, in the character's own space (x left, y up, z forward, from the
// feet, moving with the body when it crouches): the right hand's grip, the tool's direction
// (handle toward its working end), optionally the way its edge faces (otherwise the edge
// leads the motion), the chest's turn and lean, how far the knees bend. `ease` shapes the
// way into this key: 'in' accelerates (a strike into the hit), 'out' slows (follow-through).
type Key = { t: number, grip: V3, dir: V3, edge?: V3, twist?: number, lean?: number, lower?: number, ease?: 'in' | 'out' | 'inout' }
type Kind = 'blade' | 'chop' | 'dig' | 'reap'
type Swing = {
    keys: Key[]                  // the first is replaced by wherever the hands are, the last by the carry
    active: [number, number]     // when it can hit something
    kind: Kind
    step?: [number, number]      // a step into the strike: when, speed (m/s)
    chain?: number               // from here a new press (or the held button) goes on to the next stroke
    next?: number                // the combo's next stroke
}

const SWINGS: Partial<Record<ToolName, Swing[]>> = {
    // a three-stroke combo: forehand diagonal, rising backhand, overhead cut
    sword: [
        {
            keys: [
                { t: 0, grip: [0, 0, 0], dir: [0, 1, 0] },
                { t: 0.13, grip: [- 0.38, 1.5, 0.02], dir: [- 0.35, 0.55, - 0.76], twist: - 0.55, lean: - 0.05 },
                { t: 0.21, grip: [- 0.1, 1.22, 0.52], dir: [0.45, 0.25, 0.86], twist: 0.1, lean: 0.12, ease: 'in' },
                { t: 0.29, grip: [0.16, 0.98, 0.38], dir: [0.82, - 0.5, 0.28], twist: 0.55, lean: 0.2, ease: 'out' },
                { t: 0.6, grip: [0, 0, 0], dir: [0, 1, 0] }
            ], active: [0.15, 0.28], kind: 'blade', step: [0.12, 3.2], chain: 0.27, next: 1
        },
        {
            keys: [
                { t: 0, grip: [0, 0, 0], dir: [0, 1, 0] },
                { t: 0.09, grip: [0.26, 1.0, 0.2], dir: [0.75, 0.05, - 0.66], twist: 0.7, lean: 0.15 },
                { t: 0.17, grip: [0.02, 1.2, 0.55], dir: [- 0.45, 0.3, 0.84], lean: 0.08, ease: 'in' },
                { t: 0.25, grip: [- 0.34, 1.4, 0.28], dir: [- 0.85, 0.45, - 0.27], twist: - 0.55, lean: - 0.05, ease: 'out' },
                { t: 0.58, grip: [0, 0, 0], dir: [0, 1, 0] }
            ], active: [0.11, 0.24], kind: 'blade', step: [0.07, 2.6], chain: 0.24, next: 2
        },
        {
            keys: [
                { t: 0, grip: [0, 0, 0], dir: [0, 1, 0] },
                { t: 0.2, grip: [- 0.12, 1.76, 0.04], dir: [0, 0.45, - 0.89], twist: - 0.15, lean: - 0.15 },
                { t: 0.29, grip: [- 0.06, 1.32, 0.56], dir: [0.02, 0.35, 0.94], twist: 0.05, lean: 0.2, lower: 0.08, ease: 'in' },
                { t: 0.37, grip: [- 0.04, 0.92, 0.48], dir: [0.02, - 0.55, 0.83], twist: 0.08, lean: 0.38, lower: 0.15, ease: 'out' },
                { t: 0.76, grip: [0, 0, 0], dir: [0, 1, 0] }
            ], active: [0.25, 0.37], kind: 'blade', step: [0.22, 3.8]
        }
    ],
    // two-handed: wound up over the right shoulder, swung level into the trunk
    axe: [{
        keys: [
            { t: 0, grip: [0, 0, 0], dir: [0, 1, 0] },
            { t: 0.34, grip: [- 0.3, 1.52, - 0.02], dir: [- 0.32, 0.6, - 0.73], twist: - 0.65, lean: - 0.1 },
            { t: 0.45, grip: [- 0.04, 1.18, 0.46], dir: [0.5, 0.1, 0.86], twist: 0.15, lean: 0.15, lower: 0.06, ease: 'in' },
            { t: 0.54, grip: [0.18, 1.0, 0.34], dir: [0.86, - 0.18, 0.47], twist: 0.5, lean: 0.2, lower: 0.06, ease: 'out' },
            { t: 0.98, grip: [0, 0, 0], dir: [0, 1, 0] }
        ], active: [0.39, 0.52], kind: 'chop', step: [0.36, 1.2], chain: 0.62, next: 0
    }],
    // raised high, driven down into the ground a long step ahead
    hoe: [{
        keys: [
            { t: 0, grip: [0, 0, 0], dir: [0, 1, 0] },
            { t: 0.3, grip: [- 0.12, 1.6, 0.12], dir: [- 0.05, 0.8, - 0.6], twist: - 0.15, lean: - 0.15, edge: [0, 0.6, 0.8] },
            { t: 0.46, grip: [- 0.06, 0.82, 0.46], dir: [0, - 0.62, 0.78], lean: 0.4, lower: 0.12, ease: 'in' },
            { t: 0.58, grip: [- 0.06, 0.74, 0.44], dir: [0, - 0.7, 0.71], lean: 0.45, lower: 0.14, ease: 'out' },
            { t: 0.92, grip: [0, 0, 0], dir: [0, 1, 0] }
        ], active: [0.38, 0.58], kind: 'dig', chain: 0.62, next: 0
    }],
    // bent low, swept from right to left through the grass
    sickle: [{
        keys: [
            { t: 0, grip: [0, 0, 0], dir: [0, 1, 0] },
            { t: 0.15, grip: [- 0.42, 0.62, 0.3], dir: [- 0.55, 0.08, 0.83], twist: - 0.6, lean: 0.5, lower: 0.28 },
            { t: 0.36, grip: [0.36, 0.58, 0.42], dir: [0.62, 0.02, 0.78], twist: 0.55, lean: 0.5, lower: 0.28 },
            { t: 0.64, grip: [0, 0, 0], dir: [0, 1, 0] }
        ], active: [0.15, 0.37], kind: 'reap', chain: 0.38, next: 0
    }]
}

// Carried: how each tool is held while walking about (weight: how much the arm gives up its swing)
const CARRY: Record<ToolName, { key: Key, weight: number }> = {
    sword: { key: { t: 0, grip: [- 0.25, 0.94, 0.16], dir: [0.06, - 0.55, 0.83], edge: [0, - 0.83, - 0.55] }, weight: 0.55 },
    sickle: { key: { t: 0, grip: [- 0.24, 0.92, 0.1], dir: [0.02, 0.3, 0.95], edge: [0, - 0.95, 0.3] }, weight: 0.5 },
    axe: { key: { t: 0, grip: [- 0.2, 1.2, 0.2], dir: [- 0.1, 0.55, - 0.83], edge: [0, 0.83, 0.55] }, weight: 1 },
    hoe: { key: { t: 0, grip: [- 0.2, 1.2, 0.2], dir: [- 0.12, 0.52, - 0.85], edge: [0, - 0.85, - 0.52] }, weight: 1 },
    torch: { key: { t: 0, grip: [- 0.24, 1.18, 0.3], dir: [0.05, 1, 0.12], edge: [0, - 0.12, 1] }, weight: 1 },
    bow: { key: { t: 0, grip: [0.24, 0.95, 0.12], dir: [0, 1, 0.08], edge: [0, - 0.08, 1] }, weight: 0.35 }
}
// two-handed tools: where the other (left) hand holds the handle, metres along it from the grip
const SECOND_HAND: Partial<Record<ToolName, number>> = { axe: - 0.27, hoe: - 0.34 }
// the working part, for hits (tool space: y along the handle, z the edge)
const BLADE: Record<ToolName, V3[]> = {
    sword: [[0, 0.35, 0], [0, 0.6, 0], [0, 0.84, 0]],
    axe: [[0, 0.42, 0.12], [0, 0.46, 0.06]],
    hoe: [[0, 0.95, 0.12], [0, 1.0, 0.08]],
    sickle: [[0, 0.2, 0.16], [0, 0.3, 0.1], [0, 0.12, 0.17]],
    torch: [[0, 0.44, 0]],
    bow: [[0, 0.7, 0]]
}
const TIP: Record<ToolName, number> = { sword: 0.86, axe: 0.45, hoe: 1.0, sickle: 0.3, torch: 0.45, bow: 0.7 }
// on the body when not in hand (bone space: x left, y up, z forward)
const HOLSTER: Record<ToolName, { bone: string, position: V3, dir: V3, edge: V3 }> = {
    sword: { bone: 'pelvis', position: [0.21, - 0.06, 0.05], dir: [0.1, - 0.86, - 0.5], edge: [0, - 0.5, 0.86] },
    bow: { bone: 'spine_03', position: [0, 0.02, - 0.17], dir: [0.55, 0.83, 0], edge: [0, 0, - 1] },
    torch: { bone: 'pelvis', position: [- 0.19, - 0.14, - 0.1], dir: [- 0.15, 0.8, - 0.58], edge: [0, 0.58, 0.8] },
    axe: { bone: 'spine_03', position: [0.1, - 0.22, - 0.17], dir: [- 0.45, 0.89, 0], edge: [0.89, 0.45, 0] },
    hoe: { bone: 'spine_03', position: [0.12, - 0.48, - 0.2], dir: [- 0.38, 0.92, 0], edge: [0, 0, - 1] },
    sickle: { bone: 'pelvis', position: [0.2, - 0.02, 0.06], dir: [0.05, - 0.95, 0.3], edge: [0, 0.3, 0.95] }
}
const DRAW_TIME = 0.36           // taking a tool from the body (or putting it back)
const MAX_ARROWS = 40

// hand space from tool space: the handle runs through the fist toward the thumb (hand +z),
// the edge lines up with the knuckles (hand +y); the same both ways
const HAND_IN_TOOL = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(- 1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)))
const UP = new THREE.Vector3(0, 1, 0)

type Pose = { grip: THREE.Vector3, dir: THREE.Vector3, edge: THREE.Vector3, twist: number, lean: number, lower: number }
type Arrow = {
    position: THREE.Vector3, velocity: THREE.Vector3, quaternion: THREE.Quaternion
    stuck: boolean, age: number, stuckAt: number, wobbleAxis: THREE.Vector3, floating: boolean
}
type SwingState = { tool: ToolName, def: Swing, keys: Key[], time: number, hits: Set<unknown>, queued: boolean, recoil: boolean, stepped: boolean }

const vector = (v: V3) => new THREE.Vector3(v[0], v[1], v[2])
const smooth = (t: number) => t * t * (3 - 2 * t)
const easeIn = (t: number) => t * t
const easeOut = (t: number) => 1 - (1 - t) * (1 - t)

/** A rotation with +Y along `dir` and +Z as close to `edge` as it can be. */
function frame(dir: THREE.Vector3, edge: THREE.Vector3) {
    const y = dir.clone().normalize()
    const z = edge.clone().addScaledVector(y, - edge.dot(y))
    if (z.lengthSq() < 1e-6) z.set(0, 0, 1).addScaledVector(y, - y.z)
    z.normalize()
    const x = new THREE.Vector3().crossVectors(y, z)
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

/** Catmull-Rom through four values. */
function spline(a: number, b: number, c: number, d: number, t: number) {
    const t2 = t * t, t3 = t2 * t
    return 0.5 * (2 * b + (- a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (- a + 3 * b - 3 * c + d) * t3)
}

function keyOf(pose: Pose, t: number): Key {
    return { t, grip: pose.grip.toArray() as V3, dir: pose.dir.toArray() as V3, edge: pose.edge.toArray() as V3, twist: pose.twist, lean: pose.lean, lower: pose.lower }
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
    return {
        grip: a.grip.clone().lerp(b.grip, t),
        dir: a.dir.clone().lerp(b.dir, t).normalize(),
        edge: a.edge.clone().lerp(b.edge, t).normalize(),
        twist: a.twist + (b.twist - a.twist) * t,
        lean: a.lean + (b.lean - a.lean) * t,
        lower: a.lower + (b.lower - a.lower) * t
    }
}

/**
 * The player's tools. Keys 1-3 take one from the body (the same key puts it back), E or a
 * click uses it.
 *
 * Strokes are key poses the hands follow through smooth arcs (Catmull-Rom), accelerating into
 * the hit and slowing through the follow-through, with the chest turning into them and a
 * step forward; the hands turn to hold the tool (the arm solver in CharacterPose) and the
 * edge always leads the motion. Clicking again in time (or holding) chains the next stroke:
 * the sword has three. Hits are tested along the blade actually in the hand while the stroke
 * is live: a trunk or a rock stops it (a brief hit-stop, a camera jolt, chips or sparks, the
 * stroke rebounds), the axe bites and pulls out (enough chops fell the tree), the hoe digs
 * in and turns the soil, the sickle and low cuts mow the grass, bushes get cut down.
 *
 * The bow: holding the button draws (the camera comes in over the shoulder, a crosshair),
 * the string pulled back to the cheek with an arrow nocked; release shoots at the point under
 * the crosshair, aimed up for the drop. Arrows fly with gravity and air drag, stick in the
 * ground and in wood (quivering), glance off rock, splash into water and float.
 *
 * Tools not in hand ride on the body: the sword at the hip, the bow across the back, the
 * axe and hoe slung behind; taking one out reaches for it there.
 */
export default class Tools {
    view: View
    state: State
    settings: Settings
    group = new THREE.Group()
    materials: ToolMaterials
    equipped: ToolName | null = null
    // what the body is asked to do this frame (CharacterPose)
    pose: ToolPose = { right: null, left: null, weight: 0, twist: 0, lean: 0, lower: 0, pitch: 0 }
    aiming = false
    draw = 0                         // bow draw 0..1

    private models = new Map<ToolName, THREE.Group>()
    private inHand = new Set<ToolName>()
    private swing: SwingState | null = null
    private freeze = 0               // hit-stop
    private transition: { tool: ToolName, kind: 'draw' | 'stow', time: number, then: ToolName | null, from: Pose | null } | null = null
    private useHeld = false
    private recover = 0              // after a shot
    private stringTime = 10          // since the string was released
    private raised = 0               // the torch held up
    private chops = new Map<Plant, number>()
    private cuts = new Map<Plant, number>()
    private handWeight = 0
    private last: Pose | null = null
    private held: { right: HandTarget | null, left: HandTarget | null } = { right: null, left: null }
    private hud: HTMLElement
    private crosshair: HTMLElement
    private arrows: Arrow[] = []
    private arrowMesh: THREE.InstancedMesh
    private nocked: THREE.Mesh
    private flame: THREE.Group
    private flameLight: THREE.PointLight
    private flicker = 0
    private emberTime = 0
    private trail: Trail

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.settings = Settings.getInstance()
        this.materials = createToolMaterials()
        this.view.scene.add(this.group)

        const arrowGeometry = createArrowGeometry()
        const arrowMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })
        this.arrowMesh = new THREE.InstancedMesh(arrowGeometry, arrowMaterial, MAX_ARROWS)
        this.arrowMesh.count = 0
        this.arrowMesh.frustumCulled = false
        this.view.scene.add(this.arrowMesh)
        this.nocked = new THREE.Mesh(arrowGeometry, arrowMaterial)
        this.nocked.visible = false
        this.view.scene.add(this.nocked)

        this.trail = new Trail(this.view.scene)
        this.flame = this.createFlame()
        this.flameLight = new THREE.PointLight('#ffa248', 0, 14, 2)
        this.flame.add(this.flameLight)

        const ui = document.querySelector('.ui')!
        this.hud = document.createElement('div')
        this.hud.className = 'hotbar'
        this.hud.setAttribute('role', 'toolbar')
        this.hud.setAttribute('aria-label', 'Tools')
        ui.appendChild(this.hud)
        this.hud.addEventListener('click', (event) => {
            const slot = (event.target as HTMLElement).closest('[data-slot]') as HTMLElement | null
            if (slot)
                this.select(Number(slot.dataset.slot))
        })
        this.crosshair = document.createElement('div')
        this.crosshair.className = 'crosshair'
        this.crosshair.hidden = true
        this.crosshair.innerHTML = '<span class="crosshair-dot"></span><span class="crosshair-ring"></span>'
        ui.appendChild(this.crosshair)
        this.buildModels()
        this.renderHotbar()

        const controls = this.state.controls
        for (let i = 0; i < 3; i++)
            controls.events.on(`tool${i + 1}Down`, () => this.select(i))
        controls.events.on('useDown', () => this.useStart())
        controls.events.on('useUp', () => this.useEnd())
        // the mouse: with pointer lock a button press uses the tool; without, a press that
        // doesn't turn into a drag (dragging orbits the camera); the bow draws while held
        const canvas = this.view.renderer.instance.domElement
        let downAt = 0, moved = 0, pressing = false
        canvas.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return
            downAt = performance.now()
            moved = 0
            pressing = true
            if (document.pointerLockElement || this.equipped === 'bow') this.useStart()
        })
        canvas.addEventListener('pointermove', (event) => { if (pressing) moved += Math.abs(event.movementX) + Math.abs(event.movementY) })
        window.addEventListener('pointerup', (event) => {
            if (event.button !== 0 || !pressing) return
            pressing = false
            if (document.pointerLockElement || this.equipped === 'bow') this.useEnd()
            else if (moved < 6 && performance.now() - downAt < 350) {
                this.useStart()
                this.useEnd()
            }
        })
        this.settings.events.on('change:character', () => {
            this.equipped = null
            this.inHand.clear()
            this.swing = null
            this.transition = null
            this.aiming = false
            this.buildModels()
            this.renderHotbar()
        })
    }

    get set() {
        return this.settings.get('character').includes('peasant') ? SETS.peasant : SETS.ranger
    }

    private buildModels() {
        for (const model of this.models.values())
            model.visible = false
        for (const tool of this.set) {
            let model = this.models.get(tool)
            if (!model) {
                model = createTool(tool, this.materials)
                this.models.set(tool, model)
                this.group.add(model)
            }
            model.visible = true
            if (tool === 'torch')
                model.add(this.flame)
        }
    }

    private renderHotbar() {
        const slots = this.set.map((tool, i) => {
            const active = this.equipped === tool
            return `<button class="slot${active ? ' is-active' : ''}" data-slot="${i}" aria-pressed="${active}" title="${TOOL_LABELS[tool]} (${i + 1})">`
                + `<svg viewBox="0 0 24 24" aria-hidden="true">${TOOL_ICONS[tool]}</svg>`
                + `<kbd>${i + 1}</kbd><span class="slot-name">${TOOL_LABELS[tool]}</span></button>`
        }).join('')
        const hint = this.equipped
            ? `<p class="hotbar-hint"><kbd>E</kbd><span class="or">or click</span><span class="action">${ACTIONS[this.equipped]}</span></p>`
            : ''
        this.hud.innerHTML = `<div class="hotbar-slots">${slots}</div>${hint}`
    }

    /** Take out the tool in this slot (the same slot again puts it away). */
    select(slot: number | null) {
        const player = this.state.player
        if (player.swimming || player.climbing || player.mantle)
            return
        const tool = slot === null ? null : this.set[slot]
        const target = tool === this.equipped ? null : tool
        this.swing = null
        this.aiming = false
        this.draw = 0
        const from = this.last
        if (this.equipped && this.inHand.has(this.equipped))
            this.transition = { tool: this.equipped, kind: 'stow', time: 0, then: target, from }
        else if (target)
            this.transition = { tool: target, kind: 'draw', time: 0, then: null, from: null }
        this.equipped = target
        this.renderHotbar()
    }

    private useStart() {
        this.useHeld = true
        const tool = this.equipped
        const player = this.state.player
        if (!tool || player.swimming || player.climbing || player.mantle || this.transition || !this.inHand.has(tool))
            return
        if (tool === 'bow') {
            this.aiming = true
            return
        }
        if (!SWINGS[tool])
            return
        if (!this.swing)
            this.startSwing(tool, 0)
        else if (!this.swing.recoil)
            this.swing.queued = true
    }

    private useEnd() {
        this.useHeld = false
        if (this.equipped === 'bow' && this.aiming) {
            if (this.draw > 0.25)
                this.shoot()
            this.aiming = false
        }
    }

    // ── strokes ──

    private startSwing(tool: ToolName, index: number) {
        const def = SWINGS[tool]![index]
        const keys = def.keys.map((key) => ({ ...key }))
        // from wherever the hands are now, back to the carry at the end
        const from = this.last ?? this.carryPose(tool)
        keys[0] = keyOf(from, 0)
        keys[keys.length - 1] = { ...keyOf(this.carryPose(tool), keys[keys.length - 1].t), ease: 'inout' }
        this.swing = { tool, def, keys, time: 0, hits: new Set(), queued: false, recoil: false, stepped: false }
        this.trail.clear()
    }

    /** After hitting something solid: hold for a beat (the blade bites), then back to the carry. */
    private rebound(hold: number, recover: number) {
        if (!this.swing || !this.last)
            return
        const tool = this.swing.tool
        const at = { ...this.last, grip: this.last.grip.clone().addScaledVector(this.last.dir, - 0.05) }
        const keys: Key[] = [keyOf(at, 0), keyOf(at, hold), { ...keyOf(this.carryPose(tool), hold + recover), ease: 'inout' }]
        this.swing = { ...this.swing, keys, time: 0, recoil: true, queued: false, def: { ...this.swing.def, active: [- 1, - 1], step: undefined, chain: undefined, next: undefined } }
    }

    /** The stroke's pose at time t (before the edge is worked out). */
    private sampleKeys(keys: Key[], time: number) {
        let i = keys.length - 2
        for (let k = 0; k < keys.length - 1; k++)
            if (time < keys[k + 1].t) { i = k; break }
        const a = keys[Math.max(0, i - 1)], b = keys[i], c = keys[i + 1], d = keys[Math.min(keys.length - 1, i + 2)]
        let u = THREE.MathUtils.clamp((time - b.t) / Math.max(1e-4, c.t - b.t), 0, 1)
        u = c.ease === 'in' ? easeIn(u) : c.ease === 'out' ? easeOut(u) : smooth(u)
        const s3 = (pick: (key: Key) => V3) => new THREE.Vector3(
            spline(pick(a)[0], pick(b)[0], pick(c)[0], pick(d)[0], u),
            spline(pick(a)[1], pick(b)[1], pick(c)[1], pick(d)[1], u),
            spline(pick(a)[2], pick(b)[2], pick(c)[2], pick(d)[2], u))
        const s1 = (pick: (key: Key) => number) => spline(pick(a), pick(b), pick(c), pick(d), u)
        const grip = s3((key) => key.grip)
        const dir = s3((key) => vector(key.dir).normalize().toArray() as V3).normalize()
        const hintOf = (key: Key) => key.edge ?? [0, - 0.6, 0.8] as V3
        const edge = vector(hintOf(b)).lerp(vector(hintOf(c)), u)
        return { grip, dir, edge, twist: s1((key) => key.twist ?? 0), lean: s1((key) => key.lean ?? 0), lower: Math.max(0, s1((key) => key.lower ?? 0)) }
    }

    /** The pose with the edge leading the motion (the hint holds while the tool barely moves). */
    private strokePose(tool: ToolName, keys: Key[], time: number): Pose {
        const pose = this.sampleKeys(keys, time)
        const next = this.sampleKeys(keys, time + 0.012)
        const length = TIP[tool]
        const motion = next.grip.addScaledVector(next.dir, length).sub(pose.grip.clone().addScaledVector(pose.dir, length)).divideScalar(0.012)
        motion.addScaledVector(pose.dir, - motion.dot(pose.dir))
        const speed = motion.length()
        const edge = pose.edge.clone().addScaledVector(pose.dir, - pose.edge.dot(pose.dir)).normalize()
        if (speed > 1e-4)
            edge.lerp(motion.divideScalar(speed), THREE.MathUtils.smoothstep(speed, 0.8, 3))
        pose.edge = edge.normalize()
        return pose
    }

    private carryPose(tool: ToolName): Pose {
        const key = CARRY[tool].key
        return { grip: vector(key.grip), dir: vector(key.dir).normalize(), edge: vector(key.edge!), twist: 0, lean: 0, lower: 0 }
    }

    // ── the character's space ──

    private get facing() {
        // the character's yaw: its group's (the State's rotation) plus the model's own turn
        return this.state.player.rotation + this.view.player.modelYaw
    }

    /** A world point into the character's space (the model's frame). */
    private toLocal(world: THREE.Vector3) {
        const model = this.view.player.model
        return model ? model.worldToLocal(world.clone()) : world.clone()
    }

    private ground(x: number, z: number) {
        return this.state.player.groundAt(x, z)
    }

    /** The body's targets for holding a tool in this pose (character space). */
    private holdPose(tool: ToolName, pose: Pose, weight: number) {
        const hand = frame(pose.dir, pose.edge).multiply(HAND_IN_TOOL)
        const main = { position: pose.grip.clone(), quaternion: hand }
        const second = SECOND_HAND[tool]
        const other = second !== undefined ? { position: pose.grip.clone().addScaledVector(pose.dir, second), quaternion: hand.clone() } : null
        this.pose = tool === 'bow'
            ? { right: null, left: main, weight, twist: pose.twist, lean: pose.lean, lower: pose.lower, pitch: 0 }
            : { right: main, left: other, weight, twist: pose.twist, lean: pose.lean, lower: pose.lower, pitch: 0 }
    }

    /** A tool on the body, in the world (from its bone, as last posed). */
    private holsterWorld(tool: ToolName) {
        const holster = HOLSTER[tool]
        const bone = this.view.player.bone(holster.bone)
        if (!bone)
            return null
        bone.updateWorldMatrix(true, false)
        const boneQuaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(bone.matrixWorld))
        const position = vector(holster.position).applyQuaternion(boneQuaternion).add(new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld))
        const quaternion = boneQuaternion.multiply(frame(vector(holster.dir), vector(holster.edge)))
        return { position, quaternion }
    }

    /** A tool on the body, as a pose of the hand reaching for its grip (character space). */
    private holsterPose(tool: ToolName): Pose | null {
        const holster = this.holsterWorld(tool)
        const model = this.view.player.model
        if (!holster || !model)
            return null
        const inverse = model.getWorldQuaternion(new THREE.Quaternion()).invert()
        const quaternion = inverse.multiply(holster.quaternion)
        return {
            grip: this.toLocal(holster.position),
            dir: new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
            edge: new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion),
            twist: 0, lean: 0, lower: 0
        }
    }

    // ── world effects ──

    private jolt(amount: number) {
        this.state.player.camera.thirdPerson.shake(amount)
    }

    /** Tests the live stroke against the world, after the tool is placed in the hand. */
    private testHits() {
        const swing = this.swing
        if (!swing || swing.recoil || this.freeze > 0)
            return
        const def = swing.def
        const tool = swing.tool
        const model = this.models.get(tool)!
        model.updateMatrixWorld(true)
        const base = new THREE.Vector3(0, 0.3, 0).applyMatrix4(model.matrixWorld)
        const tip = new THREE.Vector3(0, TIP[tool], 0).applyMatrix4(model.matrixWorld)
        if (tool === 'sword' && swing.time >= def.active[0] - 0.03 && swing.time <= def.active[1] + 0.05)
            this.trail.push(base, tip)
        if (swing.time < def.active[0] || swing.time > def.active[1])
            return
        const particles = this.view.particles
        const p = this.state.player.position.current
        const away = new THREE.Vector3(tip.x - p[0], 0, tip.z - p[2]).normalize()

        for (const point of BLADE[tool].map((v) => vector(v).applyMatrix4(model.matrixWorld))) {
            // trunks and boulders stop the blade
            const plant = this.state.vegetation.solidAt(point.x, point.y, point.z, 0.03)
            if (plant && !swing.hits.has(plant)) {
                swing.hits.add(plant)
                const normal = new THREE.Vector3(point.x - plant.x, 0.3, point.z - plant.z).normalize()
                if (plant.kind === PLANT.ROCK) {
                    particles.emit('spark', point, 14, normal, 5, 0.7)
                    particles.emit('dust', point, 2, normal, 0.6, 0.8)
                    this.freeze = 0.09
                    this.jolt(0.32)
                    this.rebound(0.06, 0.4)
                    return
                }
                particles.emit('chip', point, tool === 'axe' ? 12 : 6, normal, tool === 'axe' ? 3.2 : 2.2, 0.65)
                this.view.trees.strike(plant.x, plant.z, plant.x - p[0], plant.z - p[2], tool === 'axe' ? 1 : 0.45)
                if (tool === 'axe') {
                    this.freeze = 0.1
                    this.jolt(0.34)
                    const chops = (this.chops.get(plant) ?? 0) + 1
                    this.chops.set(plant, chops)
                    if (chops >= Math.round(3 + plant.scale / 5)) {
                        this.chops.delete(plant)
                        this.view.trees.fell(plant, plant.x - p[0], plant.z - p[2])
                        particles.emit('leaf', new THREE.Vector3(plant.x, plant.y + plant.scale * 0.7, plant.z), 18, UP, 2.5, 0.9)
                    }
                    this.rebound(0.16, 0.42)
                }
                else {
                    this.freeze = 0.07
                    this.jolt(0.2)
                    this.rebound(0.05, 0.38)
                }
                return
            }

            const ground = this.ground(point.x, point.z)
            // the hoe digs in; any other blade striking the ground stops
            if (point.y < ground + (def.kind === 'dig' ? 0.04 : - 0.02)) {
                if (ground < WATER_LEVEL) {
                    particles.emit('splash', new THREE.Vector3(point.x, WATER_LEVEL, point.z), 10, UP, 2.6, 0.5)
                    this.rebound(0.05, 0.4)
                    return
                }
                const at = new THREE.Vector3(point.x, ground + 0.03, point.z)
                particles.emit('dirt', at, def.kind === 'dig' ? 16 : 7, away.clone().negate().setY(1.2), 2.6, 0.55)
                particles.emit('dust', at, 2, UP, 0.5, 0.8)
                if (def.kind === 'dig') {
                    this.view.groundWetness.till(at.x, at.z, 0.42, 0.3, this.facing + Math.PI / 2)
                    this.view.grass.trail.cut(at.x, at.z, 0.6, 1)
                    this.jolt(0.14)
                    this.freeze = 0.05
                    this.rebound(0.14, 0.42)
                }
                else {
                    this.jolt(0.18)
                    this.freeze = 0.06
                    this.rebound(0.05, 0.4)
                }
                return
            }
            if (point.y < WATER_LEVEL && !swing.hits.has('water')) {
                swing.hits.add('water')
                particles.emit('splash', new THREE.Vector3(point.x, WATER_LEVEL, point.z), 8, UP, 2.2, 0.5)
            }

            // bushes: shaken and, after a few cuts, cut down
            if (def.kind !== 'dig') {
                const bush = this.state.vegetation.nearest(point.x, point.z, 1.6, [PLANT.BUSH])
                if (bush && !swing.hits.has(bush) && Math.hypot(point.x - bush.x, point.z - bush.z) < bush.scale * 0.55 && point.y < bush.y + bush.scale * 1.1) {
                    swing.hits.add(bush)
                    this.view.trees.strike(bush.x, bush.z, bush.x - p[0], bush.z - p[2], 1.2)
                    particles.emit('leaf', point, 8, UP, 2.2, 0.9)
                    const cuts = (this.cuts.get(bush) ?? 0) + 1
                    this.cuts.set(bush, cuts)
                    if (cuts >= 3) {
                        this.cuts.delete(bush)
                        particles.emit('leaf', new THREE.Vector3(bush.x, bush.y + bush.scale * 0.5, bush.z), 26, UP, 3, 1)
                        this.state.vegetation.remove(bush)
                    }
                }
            }
        }

        // low cuts mow the grass along the arc
        const low = tip.y - this.ground(tip.x, tip.z)
        if ((def.kind === 'reap' || def.kind === 'blade') && low < 0.75 && low > - 0.1 && tip.y > WATER_LEVEL) {
            this.view.grass.trail.cut(tip.x, tip.z, def.kind === 'reap' ? 0.7 : 0.5, def.kind === 'reap' ? 1 : 0.85)
            if (Math.random() < (def.kind === 'reap' ? 0.9 : 0.5))
                particles.emit('grass', tip, def.kind === 'reap' ? 5 : 3, away.clone().setY(0.8), 2.2, 0.8)
        }
    }

    // ── the bow ──

    /** Where the crosshair points: the first ground or solid along the camera's view, or far away. */
    private aimPoint() {
        const camera = this.view.camera.instance
        const origin = camera.getWorldPosition(new THREE.Vector3())
        const direction = camera.getWorldDirection(new THREE.Vector3())
        const blocked = (q: THREE.Vector3) => q.y < this.ground(q.x, q.z) || this.state.vegetation.isSolid(q.x, q.y, q.z, 0)
        let distance = 1.5
        while (distance < 320) {
            if (blocked(origin.clone().addScaledVector(direction, distance))) {
                // narrow it down between the last two samples
                let lo = distance - (distance < 40 ? 0.5 : 2), hi = distance
                for (let i = 0; i < 6; i++) {
                    const mid = (lo + hi) / 2
                    if (blocked(origin.clone().addScaledVector(direction, mid))) hi = mid
                    else lo = mid
                }
                return origin.addScaledVector(direction, hi)
            }
            distance += distance < 40 ? 0.5 : 2
        }
        return origin.addScaledVector(direction, 320)
    }

    /** The aim's direction in the character's space (the bow arm follows it). */
    private aimLocal() {
        const direction = this.view.camera.instance.getWorldDirection(new THREE.Vector3())
        return direction.applyAxisAngle(UP, - this.facing).normalize()
    }

    private shoot() {
        const model = this.models.get('bow')!
        const start = this.nocked.visible ? this.nocked.position.clone() : new THREE.Vector3().setFromMatrixPosition(model.matrixWorld)
        const target = this.aimPoint()
        const speed = 24 + 38 * this.draw
        // the launch angle that drops onto the target (the flatter of the two)
        const dx = target.x - start.x, dz = target.z - start.z
        const d = Math.hypot(dx, dz), h = target.y - start.y, g = 9.81
        const disc = speed ** 4 - g * (g * d * d + 2 * h * speed * speed)
        const angle = disc >= 0 && d > 0.5 ? Math.atan((speed * speed - Math.sqrt(disc)) / (g * d)) : Math.atan2(h, Math.max(d, 1e-3)) + 0.05
        const horizontal = Math.max(d, 1e-4)
        const direction = new THREE.Vector3(dx / horizontal * Math.cos(angle), Math.sin(angle), dz / horizontal * Math.cos(angle))
        const player = this.state.player
        this.arrows.push({
            position: start,
            velocity: direction.multiplyScalar(speed).add(new THREE.Vector3(player.velocity[0], 0, player.velocity[2])),
            quaternion: new THREE.Quaternion().setFromUnitVectors(UP, direction.clone().normalize()),
            stuck: false, age: 0, stuckAt: 0, wobbleAxis: new THREE.Vector3(1, 0, 0), floating: false
        })
        if (this.arrows.length > MAX_ARROWS)
            this.arrows.shift()
        this.draw = 0
        this.recover = 0.38
        this.stringTime = 0
        this.jolt(0.05)
    }

    private updateArrows(dt: number) {
        const matrix = new THREE.Matrix4()
        const scale = new THREE.Vector3(1, 1, 1)
        const particles = this.view.particles
        this.arrows = this.arrows.filter((arrow) => (arrow.age += dt) < 60)
        for (const arrow of this.arrows) {
            if (arrow.stuck)
                continue
            const steps = 6
            for (let s = 0; s < steps && !arrow.stuck; s++) {
                const h = dt / steps
                const v = arrow.velocity
                const p = arrow.position
                if (arrow.floating) {
                    // drifting to a stop on the surface
                    p.addScaledVector(v, h)
                    p.y = WATER_LEVEL - 0.01
                    v.multiplyScalar(Math.exp(- 3 * h))
                    if (v.lengthSq() < 0.01) arrow.stuck = true
                    continue
                }
                const speed = v.length()
                // gravity and a little quadratic drag
                v.multiplyScalar(1 - Math.min(0.5, 0.0045 * speed * h))
                v.y -= 9.81 * h
                const previous = p.clone()
                p.addScaledVector(v, h)
                // the head leads: test there (the position is the shaft's middle)
                const along = v.clone().normalize()
                const head = p.clone().addScaledVector(along, 0.38)
                const ground = this.ground(head.x, head.z)
                const plant = this.state.vegetation.solidAt(head.x, head.y, head.z, 0.02)
                if (head.y < WATER_LEVEL && ground < WATER_LEVEL) {
                    // into the water: a splash, then it floats where it slows down
                    particles.emit('splash', new THREE.Vector3(head.x, WATER_LEVEL, head.z), 8, UP, 2.2, 0.5)
                    p.y = WATER_LEVEL - 0.01
                    v.set(v.x * 0.15, 0, v.z * 0.15)
                    arrow.quaternion.setFromUnitVectors(UP, new THREE.Vector3(v.x, 0, v.z).normalize())
                    arrow.floating = true
                }
                else if (plant?.kind === PLANT.ROCK && speed > 9) {
                    // glances off rock
                    const normal = new THREE.Vector3(head.x - plant.x, 0.4, head.z - plant.z).normalize()
                    particles.emit('spark', head, 8, normal, 3.5, 0.7)
                    v.reflect(normal).multiplyScalar(0.3).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2))
                    p.copy(previous)
                }
                else if (plant || head.y < ground) {
                    // sticks, driven in deeper the faster it flew
                    const depth = THREE.MathUtils.clamp(speed * (plant ? 0.004 : 0.006), 0.04, plant ? 0.2 : 0.3)
                    const contact = head.clone()
                    if (!plant) {
                        // back along the path to where the head met the ground
                        const before = previous.clone().addScaledVector(along, 0.38)
                        const above = before.y - this.ground(before.x, before.z), below = head.y - ground
                        contact.copy(before).lerp(head, THREE.MathUtils.clamp(above / Math.max(1e-4, above - below), 0, 1))
                    }
                    p.copy(contact).addScaledVector(along, depth - 0.38)
                    arrow.stuck = true
                    arrow.stuckAt = arrow.age
                    arrow.wobbleAxis.crossVectors(along, UP)
                    if (arrow.wobbleAxis.lengthSq() < 1e-3) arrow.wobbleAxis.set(1, 0, 0)
                    arrow.wobbleAxis.normalize()
                    if (plant) {
                        particles.emit('chip', contact, 4, along.clone().negate(), 1.6, 0.6)
                        this.view.trees.strike(plant.x, plant.z, v.x, v.z, 0.25)
                    }
                    else
                        particles.emit('dirt', new THREE.Vector3(contact.x, this.ground(contact.x, contact.z) + 0.02, contact.z), 5, along.clone().negate().setY(1), 1.6, 0.6)
                }
            }
            if (!arrow.stuck && !arrow.floating && arrow.velocity.lengthSq() > 1e-4)
                arrow.quaternion.setFromUnitVectors(UP, arrow.velocity.clone().normalize())
        }
        const wobble = new THREE.Quaternion()
        this.arrows.forEach((arrow, i) => {
            let quaternion = arrow.quaternion
            const since = arrow.age - arrow.stuckAt
            if (arrow.stuck && !arrow.floating && since < 0.8) {
                // a stuck arrow quivers
                wobble.setFromAxisAngle(arrow.wobbleAxis, Math.sin(since * 48) * Math.exp(- since * 7) * 0.12)
                quaternion = wobble.clone().multiply(arrow.quaternion)
            }
            // the arrow's position is its middle; when stuck, the head is in the target
            matrix.compose(arrow.position, quaternion, scale)
            this.arrowMesh.setMatrixAt(i, matrix)
        })
        this.arrowMesh.count = this.arrows.length
        this.arrowMesh.instanceMatrix.needsUpdate = true
    }

    private createFlame() {
        // soft additive glows, very bright (they bloom)
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 64
        const context = canvas.getContext('2d')!
        const gradient = context.createRadialGradient(32, 36, 2, 32, 32, 30)
        gradient.addColorStop(0, 'rgba(255,255,230,1)')
        gradient.addColorStop(0.3, 'rgba(255,190,90,0.8)')
        gradient.addColorStop(0.7, 'rgba(255,90,20,0.25)')
        gradient.addColorStop(1, 'rgba(255,60,0,0)')
        context.fillStyle = gradient
        context.fillRect(0, 0, 64, 64)
        const texture = new THREE.CanvasTexture(canvas)
        const group = new THREE.Group()
        group.position.y = 0.5
        for (let i = 0; i < 3; i++) {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: new THREE.Color(6, 3.4, 1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
            sprite.scale.setScalar(0.22 - i * 0.05)
            sprite.position.y = i * 0.05
            group.add(sprite)
        }
        return group
    }

    // ── per frame ──

    /** Taking a tool from the body or putting it back: the hand reaches the holster, the tool changes place there. */
    private updateTransition(dt: number) {
        const transition = this.transition!
        transition.time += dt
        const t = transition.time, half = DRAW_TIME * 0.45
        const tool = transition.tool
        const holster = this.holsterPose(tool)
        const carry = this.carryPose(tool)
        const carryWeight = CARRY[tool].weight
        if (holster) {
            let pose: Pose, weight: number
            if (t < half) {
                // toward the holster, from the carry (or the hand's rest by the hip)
                const u = smooth(t / half)
                const from = transition.kind === 'stow' ? (transition.from ?? carry) : { ...holster, grip: new THREE.Vector3(tool === 'bow' ? 0.22 : - 0.22, 0.95, 0.06) }
                pose = lerpPose(from, holster, u)
                weight = transition.kind === 'draw' ? Math.min(1, t / (half * 0.6)) : carryWeight + (1 - carryWeight) * u
            }
            else {
                // away from the holster: to the carry (drawn) or back to the hand's rest (stowed)
                const u = smooth(Math.min(1, (t - half) / (DRAW_TIME - half)))
                pose = transition.kind === 'draw' ? lerpPose(holster, carry, u) : holster
                weight = transition.kind === 'draw' ? 1 + (carryWeight - 1) * u : 1 - u
            }
            this.holdPose(tool, pose, weight)
            this.last = pose
        }
        // the tool changes hands at the holster
        if (t >= half) {
            if (transition.kind === 'draw') this.inHand.add(tool)
            else this.inHand.delete(tool)
        }
        if (t >= DRAW_TIME)
            this.transition = transition.then ? { tool: transition.then, kind: 'draw', time: 0, then: null, from: null } : null
    }

    private updateSwing(dt: number) {
        const swing = this.swing!
        const player = this.state.player
        if (this.freeze > 0)
            this.freeze -= dt
        else
            swing.time += dt
        const def = swing.def
        const end = swing.keys[swing.keys.length - 1].t
        const pose = this.strokePose(swing.tool, swing.keys, Math.min(swing.time, end))
        this.holdPose(swing.tool, pose, 1)
        this.last = pose
        // a step into the strike
        if (def.step && !swing.stepped && swing.time >= def.step[0] && player.grounded) {
            swing.stepped = true
            player.stepForward(Math.sin(this.facing), Math.cos(this.facing), def.step[1], 0.12)
        }
        // the next stroke when asked for in time (or the button held), else back to the carry
        const wantsMore = swing.queued || this.useHeld
        if (def.next !== undefined && def.chain !== undefined && swing.time >= def.chain && wantsMore)
            this.startSwing(swing.tool, def.next)
        else if (swing.time >= end) {
            this.swing = null
            if (this.useHeld && !swing.recoil && def.next === undefined)
                this.startSwing(swing.tool, 0)
            else if (this.useHeld && swing.recoil)
                this.startSwing(swing.tool, 0)
        }
    }

    /** The bow drawn: the bow arm along the aim, the string hand back to the cheek, the chest side-on. */
    private updateBow(dt: number) {
        if (this.aiming)
            this.draw = Math.min(1, this.draw + dt / 0.7)
        this.recover = Math.max(0, this.recover - dt)
        const aim = this.aimLocal()
        const draw = 1 - Math.pow(1 - this.draw, 2)
        const chest = new THREE.Vector3(0, 1.42, 0)
        const bowHand = chest.clone().addScaledVector(aim, 0.6).add(new THREE.Vector3(0.05, - 0.02, 0))
        const bowUp = UP.clone().addScaledVector(aim, - aim.y).normalize().applyAxisAngle(aim, - 0.12)
        const bowQuaternion = frame(bowUp, aim)
        const nockRest = bowHand.clone().addScaledVector(aim, - 0.14)
        const anchor = chest.clone().add(new THREE.Vector3(- 0.05, 0.13, 0)).addScaledVector(aim, 0.02)
        const stringHand = nockRest.clone().lerp(anchor, draw)
        // the drawing hand: fingers toward the bow hooked on the string, thumb up
        const handX = new THREE.Vector3().crossVectors(aim, bowUp)
        const stringQuaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(handX, aim, bowUp))
        // after the release the bow hand kicks forward, the string hand flies back
        const kick = this.recover > 0 ? Math.sin(Math.min(1, (0.38 - this.recover) / 0.38) * Math.PI) : 0
        this.pose = {
            left: { position: bowHand.addScaledVector(aim, kick * 0.03), quaternion: bowQuaternion.multiply(HAND_IN_TOOL) },
            right: { position: stringHand.addScaledVector(aim, - kick * 0.07), quaternion: stringQuaternion },
            weight: 1,
            twist: - 0.75,
            lean: 0,
            lower: 0,
            pitch: - Math.asin(THREE.MathUtils.clamp(aim.y, - 1, 1)) * 0.5
        }
    }

    /** Advance strokes, the bow and the hands' transitions; set this frame's targets for the body. */
    update() {
        const dt = Math.min(this.state.time.delta, 0.05)
        const player = this.state.player
        const previous = this.held
        this.pose = { right: null, left: null, weight: 0, twist: 0, lean: 0, lower: 0, pitch: 0 }

        // put the tool away to swim or climb
        if (this.equipped && (player.swimming || player.climbing || player.mantle)) {
            this.inHand.delete(this.equipped)
            this.equipped = null
            this.swing = null
            this.aiming = false
            this.transition = null
            this.renderHotbar()
        }

        const tool = this.equipped
        if (this.transition)
            this.updateTransition(dt)
        else if (this.swing)
            this.updateSwing(dt)
        else if (tool === 'bow' && (this.aiming || this.recover > 0))
            this.updateBow(dt)
        else if (tool && this.inHand.has(tool)) {
            // carried (the torch raised while the button is held)
            const carry = this.carryPose(tool)
            if (tool === 'torch') {
                this.raised += ((this.useHeld ? 1 : 0) - this.raised) * (1 - Math.exp(- dt * 8))
                carry.grip.lerp(new THREE.Vector3(- 0.2, 1.68, 0.3), this.raised)
                carry.dir.lerp(new THREE.Vector3(0, 1, 0.1), this.raised).normalize()
            }
            this.holdPose(tool, carry, CARRY[tool].weight)
            this.last = carry
        }
        else
            this.last = null

        // ease the hands in and out of the tool's control (fading out: toward the last targets)
        const want = this.pose.weight
        this.handWeight += (want - this.handWeight) * (1 - Math.exp(- dt * (want > this.handWeight ? 24 : 10)))
        if (want > 0)
            this.held = { right: this.pose.right, left: this.pose.left }
        else if (this.handWeight > 0.01) {
            this.pose.right = previous.right
            this.pose.left = previous.left
        }
        this.pose.weight = this.handWeight

        // face where the camera looks while aiming or striking
        player.aimYaw = this.aiming || this.swing !== null ? player.camera.thirdPerson.theta : null
        player.camera.thirdPerson.aim = this.aiming ? 1 : 0
        this.crosshair.hidden = !(this.aiming || (tool === 'bow' && this.recover > 0))
        this.crosshair.style.setProperty('--draw', this.draw.toFixed(3))
        this.updateArrows(dt)
        this.trail.update(dt)
    }

    /** Put the tools where they are (in the hand or on the body), after the character is posed. */
    place() {
        const set = this.set
        for (const tool of set) {
            const model = this.models.get(tool)!
            if (this.inHand.has(tool)) {
                const bone = this.view.player.bone(tool === 'bow' ? 'hand_l' : 'hand_r')
                if (!bone)
                    continue
                bone.updateWorldMatrix(true, false)
                const handQuaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(bone.matrixWorld))
                const grip = (tool === 'bow' ? GRIP_LEFT : GRIP_RIGHT).clone().applyQuaternion(handQuaternion)
                model.position.setFromMatrixPosition(bone.matrixWorld).add(grip)
                model.quaternion.copy(handQuaternion).multiply(HAND_IN_TOOL)
            }
            else {
                const holster = this.holsterWorld(tool)
                if (!holster)
                    continue
                model.position.copy(holster.position)
                model.quaternion.copy(holster.quaternion)
            }
        }

        this.placeString()
        this.testHits()
        this.placeTorch()
    }

    /** The bow's string pulled to the drawing fingers with an arrow nocked, quivering after the shot. */
    private placeString() {
        const bow = this.models.get('bow')
        if (!bow || !this.set.includes('bow'))
            return
        bow.updateMatrixWorld(true)
        const string = bow.getObjectByName('string') as THREE.Line
        const positions = string.geometry.getAttribute('position') as THREE.BufferAttribute
        const nock = new THREE.Vector3(0, 0, - 0.13)
        const drawing = this.equipped === 'bow' && this.inHand.has('bow') && this.aiming
        const hand = this.view.player.bone('hand_r')
        if (drawing && hand) {
            hand.updateWorldMatrix(true, false)
            const fingers = bow.worldToLocal(GRIP_RIGHT.clone().applyMatrix4(hand.matrixWorld))
            nock.y = THREE.MathUtils.clamp(fingers.y, - 0.1, 0.1)
            nock.z = Math.min(- 0.13, fingers.z)
        }
        else {
            this.stringTime += Math.min(this.state.time.delta, 0.05)
            nock.z += Math.sin(this.stringTime * 70) * Math.exp(- this.stringTime * 12) * 0.03
        }
        positions.setXYZ(1, nock.x, nock.y, nock.z)
        positions.needsUpdate = true
        // the nocked arrow lies from the string over the bow hand toward the target
        this.nocked.visible = drawing && this.draw > 0.02
        if (this.nocked.visible) {
            const nockWorld = bow.localToWorld(nock.clone())
            const front = bow.localToWorld(new THREE.Vector3(0, 0, 0.05))
            const along = front.sub(nockWorld).normalize()
            this.nocked.quaternion.setFromUnitVectors(UP, along)
            this.nocked.position.copy(nockWorld).addScaledVector(along, 0.33)
        }
    }

    /** The torch: a flickering flame and rising embers, lighting the character and the land around. */
    private placeTorch() {
        const torch = this.view.sky.uniforms.uTorch.value as THREE.Vector4
        const lit = this.equipped === 'torch' && this.inHand.has('torch')
        this.flame.visible = lit
        if (!lit) {
            torch.w = 0
            this.flameLight.intensity = 0
            return
        }
        const dt = Math.min(this.state.time.delta, 0.05)
        this.flicker += (Math.random() - 0.5) * 0.4
        this.flicker *= 0.85
        const strength = (3.2 + this.raised * 0.8) * (0.88 + 0.12 * Math.sin(this.state.time.elapsed * 23) + this.flicker * 0.3)
        this.flame.updateWorldMatrix(true, false)
        const at = new THREE.Vector3().setFromMatrixPosition(this.flame.matrixWorld)
        torch.set(at.x, at.y, at.z, strength)
        this.flameLight.intensity = strength * 2.2
        this.flame.children.forEach((sprite, i) => sprite.scale.setScalar((0.22 - i * 0.05) * (0.9 + Math.random() * 0.2)))
        this.emberTime += dt
        if (this.emberTime > 0.09) {
            this.emberTime = 0
            this.view.particles.emit('ember', at, 1, UP, 0.8, 0.5)
        }
    }
}
