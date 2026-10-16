import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Settings from '../Settings'
import { PLANT } from '../State/Vegetation'
import { WATER_LEVEL } from '../Workers/TerrainShape'
import { createTool, createToolMaterials, createArrowGeometry, ToolName, ToolMaterials } from './ToolModels'

// Three tools per outfit: the ranger's and the farmer's
const SETS: Record<'ranger' | 'peasant', ToolName[]> = {
    ranger: ['sword', 'bow', 'torch'],
    peasant: ['axe', 'hoe', 'sickle']
}
const LABELS: Record<ToolName, string> = { sword: 'Sword', bow: 'Bow', torch: 'Torch', axe: 'Axe', hoe: 'Hoe', sickle: 'Sickle' }

type V3 = [number, number, number]
// An action's key poses, in the character's own space (x left, y up, z forward, from the
// feet): when (s), the right hand, the tool's direction (handle toward its working end)
type Key = { t: number, hand: V3, dir: V3 }
type Action = { keys: Key[], duration: number, hit: number, twoHanded: boolean }

const ACTIONS: Partial<Record<ToolName, Action>> = {
    sword: {
        keys: [
            { t: 0.17, hand: [- 0.36, 1.55, - 0.1], dir: [- 0.3, 0.8, - 0.5] },
            { t: 0.31, hand: [0.18, 0.95, 0.5], dir: [0.55, - 0.25, 0.8] },
            { t: 0.42, hand: [0.3, 0.86, 0.32], dir: [0.8, - 0.4, 0.3] }
        ], duration: 0.62, hit: 0.29, twoHanded: false
    },
    axe: {
        keys: [
            { t: 0.3, hand: [- 0.04, 1.72, - 0.05], dir: [0, 0.6, - 0.8] },
            { t: 0.45, hand: [0.02, 1.05, 0.5], dir: [0, - 0.35, 0.94] },
            { t: 0.6, hand: [0.02, 1.02, 0.48], dir: [0, - 0.38, 0.92] }
        ], duration: 0.85, hit: 0.44, twoHanded: true
    },
    hoe: {
        keys: [
            { t: 0.28, hand: [- 0.04, 1.62, 0.06], dir: [0, 0.92, 0.38] },
            { t: 0.42, hand: [0.0, 0.86, 0.42], dir: [0, - 0.55, 0.83] },
            { t: 0.6, hand: [0.0, 0.84, 0.4], dir: [0, - 0.57, 0.82] }
        ], duration: 0.82, hit: 0.42, twoHanded: true
    },
    sickle: {
        keys: [
            { t: 0.13, hand: [- 0.44, 0.64, 0.32], dir: [- 0.6, 0.2, 0.75] },
            { t: 0.36, hand: [0.38, 0.6, 0.44], dir: [0.7, 0.12, 0.7] }
        ], duration: 0.55, hit: 0.25, twoHanded: false
    }
}

const MAX_ARROWS = 32

type Arrow = { position: THREE.Vector3, velocity: THREE.Vector3, stuck: boolean, age: number, quaternion: THREE.Quaternion }

/**
 * The player's tools. Keys 1-3 take one out (the same key puts it away), E or a click
 * uses it (the bow draws while held and shoots on release). Actions are timed key poses for
 * the hands that the character's arm solver follows (CharacterPose), blended over walking;
 * at the moment of the hit they act on the world: the sword and the sickle cut the grass,
 * the axe shakes the tree it strikes, the hoe turns the soil. Arrows fly with gravity and
 * stick where they land; the torch lights the land around it at night.
 */
export default class Tools {
    view: View
    state: State
    settings: Settings
    group = new THREE.Group()
    materials: ToolMaterials
    equipped: ToolName | null = null
    // hand targets for the pose this frame (character space), blended by weight
    hands = { right: null as THREE.Vector3 | null, left: null as THREE.Vector3 | null, weight: 0 }
    aiming = false

    private models = new Map<ToolName, THREE.Group>()
    private action: { tool: ToolName, time: number, hitDone: boolean } | null = null
    private useHeld = false
    private draw = 0                 // bow draw 0..1
    private recover = 0              // after a shot
    private toolDirection = new THREE.Vector3(0, 1, 0)
    private handWeight = 0
    private hotbar: HTMLElement
    private arrows: Arrow[] = []
    private arrowMesh: THREE.InstancedMesh
    private flame: THREE.Group
    private flameLight: THREE.PointLight
    private flicker = 0

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.settings = Settings.getInstance()
        this.materials = createToolMaterials()
        this.view.scene.add(this.group)

        this.arrowMesh = new THREE.InstancedMesh(createArrowGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), MAX_ARROWS)
        this.arrowMesh.count = 0
        this.arrowMesh.frustumCulled = false
        this.view.scene.add(this.arrowMesh)

        this.flame = this.createFlame()
        this.flameLight = new THREE.PointLight('#ffa248', 0, 14, 2)
        this.flame.add(this.flameLight)

        this.hotbar = document.createElement('div')
        this.hotbar.className = 'hotbar'
        document.querySelector('.ui')!.appendChild(this.hotbar)
        this.renderHotbar()

        const controls = this.state.controls
        for (let i = 0; i < 3; i++)
            controls.events.on(`tool${i + 1}Down`, () => this.select(i))
        controls.events.on('useDown', () => this.useStart())
        controls.events.on('useUp', () => this.useEnd())
        // the mouse: with pointer lock a button press uses the tool; without, a click that
        // isn't a drag (dragging orbits the camera)
        const canvas = this.view.renderer.instance.domElement
        let downAt = 0, moved = 0
        canvas.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return
            downAt = performance.now()
            moved = 0
            if (document.pointerLockElement) this.useStart()
        })
        canvas.addEventListener('pointermove', (event) => { moved += Math.abs(event.movementX) + Math.abs(event.movementY) })
        canvas.addEventListener('pointerup', (event) => {
            if (event.button !== 0) return
            if (document.pointerLockElement) this.useEnd()
            else if (moved < 6 && performance.now() - downAt < 350) {
                this.useStart()
                this.draw = Math.max(this.draw, 0.55)       // a click shoots a quick, half-drawn arrow
                this.useEnd()
            }
        })
        this.settings.events.on('change:character', () => this.select(null))
    }

    get set() {
        return this.settings.get('character').includes('peasant') ? SETS.peasant : SETS.ranger
    }

    private renderHotbar() {
        this.hotbar.innerHTML = this.set.map((tool, i) =>
            `<span class="slot${this.equipped === tool ? ' active' : ''}"><kbd>${i + 1}</kbd>${LABELS[tool]}</span>`).join('') +
            `<span class="hint">${this.equipped ? 'E / click to use' : ''}</span>`
    }

    /** Take out the tool in this slot (the same slot again puts it away). */
    select(slot: number | null) {
        const tool = slot === null ? null : this.set[slot]
        if (this.equipped)
            this.models.get(this.equipped)!.visible = false
        this.equipped = tool === this.equipped ? null : tool
        this.action = null
        this.aiming = false
        this.draw = 0
        if (this.equipped) {
            let model = this.models.get(this.equipped)
            if (!model) {
                model = createTool(this.equipped, this.materials)
                this.models.set(this.equipped, model)
                this.group.add(model)
            }
            model.visible = true
            if (this.equipped === 'torch')
                model.add(this.flame)
        }
        this.renderHotbar()
    }

    private useStart() {
        this.useHeld = true
        const tool = this.equipped
        if (!tool || this.state.player.swimming)
            return
        if (tool === 'bow')
            this.aiming = true
        else if (ACTIONS[tool] && !this.action)
            this.action = { tool, time: 0, hitDone: false }
    }

    private useEnd() {
        this.useHeld = false
        if (this.equipped === 'bow' && this.aiming) {
            if (this.draw > 0.2)
                this.shoot()
            this.aiming = false
        }
    }

    // ── helpers in the character's space ──
    private get facing() {
        // the character's yaw: its group's (the State's rotation) plus the model's own turn
        return this.state.player.rotation + this.view.player.modelYaw
    }

    private toWorld(local: THREE.Vector3) {
        const p = this.state.player.position.current
        return local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.facing).add(new THREE.Vector3(p[0], p[1], p[2]))
    }

    private ahead(distance: number) {
        return this.toWorld(new THREE.Vector3(0, 0, distance))
    }

    /** The key poses of an action at this time: hand position and tool direction. */
    private sample(action: Action, time: number) {
        const keys = action.keys
        let a = keys[0], b = keys[0], t = 0
        if (time >= keys[keys.length - 1].t)
            a = b = keys[keys.length - 1]
        else if (time > keys[0].t)
            for (let i = 0; i < keys.length - 1; i++)
                if (time >= keys[i].t && time <= keys[i + 1].t) {
                    a = keys[i]
                    b = keys[i + 1]
                    t = (time - a.t) / (b.t - a.t)
                    t = t * t * (3 - 2 * t)
                }
        const hand = new THREE.Vector3(...a.hand).lerp(new THREE.Vector3(...b.hand), t)
        const dir = new THREE.Vector3(...a.dir).normalize().lerp(new THREE.Vector3(...b.dir).normalize(), t).normalize()
        // in and out of the action
        const weight = Math.min(1, time / Math.max(0.08, keys[0].t * 0.8), Math.max(0, (action.duration - time) / 0.16))
        return { hand, dir, weight }
    }

    // ── world effects ──
    private hit(tool: ToolName) {
        const p = this.state.player.position.current
        const trail = this.view.grass.trail
        if (tool === 'sword') {
            const at = this.ahead(1.15)
            trail.cut(at.x, at.z, 1.2, 0.8)
        }
        else if (tool === 'sickle') {
            const at = this.ahead(0.85)
            trail.cut(at.x, at.z, 1.0, 0.95)
        }
        else if (tool === 'hoe') {
            const at = this.ahead(1.25)
            this.view.groundWetness.till(at.x, at.z, 0.42, 0.3, this.facing + Math.PI / 2)
            trail.cut(at.x, at.z, 0.6, 1)
        }
        else if (tool === 'axe') {
            // the nearest tree within reach, in front
            const forward = this.ahead(1).sub(new THREE.Vector3(p[0], p[1], p[2]))
            let best: { x: number, z: number } | null = null, bestDistance = 2.4
            for (const cell of this.state.vegetation.cells.values())
                for (const plant of cell.plants) {
                    if (plant.kind !== PLANT.BROADLEAF && plant.kind !== PLANT.CONIFER && plant.kind !== PLANT.BUSH)
                        continue
                    const dx = plant.x - p[0], dz = plant.z - p[2]
                    const distance = Math.hypot(dx, dz)
                    if (distance < bestDistance && (dx * forward.x + dz * forward.z) / Math.max(distance, 1e-3) > 0.4) {
                        bestDistance = distance
                        best = plant
                    }
                }
            if (best)
                this.view.trees.strike(best.x, best.z, best.x - p[0], best.z - p[2], 1)
        }
    }

    private shoot() {
        const camera = this.view.camera.instance
        const direction = new THREE.Vector3()
        camera.getWorldDirection(direction)
        direction.y += 0.03          // a touch of loft
        direction.normalize()
        const start = this.toWorld(new THREE.Vector3(0.05, 1.45, 0.65))
        const speed = 18 + 36 * this.draw
        const player = this.state.player
        const arrow: Arrow = {
            position: start,
            velocity: direction.multiplyScalar(speed).add(new THREE.Vector3(player.velocity[0], 0, player.velocity[2])),
            stuck: false,
            age: 0,
            quaternion: new THREE.Quaternion()
        }
        this.arrows.push(arrow)
        if (this.arrows.length > MAX_ARROWS)
            this.arrows.shift()
        this.draw = 0
        this.recover = 0.3
    }

    private updateArrows(dt: number) {
        const up = new THREE.Vector3(0, 1, 0)
        const matrix = new THREE.Matrix4()
        const scale = new THREE.Vector3(1, 1, 1)
        this.arrows = this.arrows.filter((arrow) => (arrow.age += dt) < 45)
        for (const arrow of this.arrows) {
            if (!arrow.stuck) {
                const steps = 4
                for (let s = 0; s < steps && !arrow.stuck; s++) {
                    const h = dt / steps
                    arrow.velocity.y -= 9.81 * h
                    arrow.velocity.multiplyScalar(Math.exp(- 0.02 * h))
                    arrow.position.addScaledVector(arrow.velocity, h)
                    const p = arrow.position
                    const ground = this.state.chunks.getElevationForPosition(p.x, p.z)
                    const solid = this.state.vegetation.isSolid(p.x, p.y, p.z, 0.05)
                    if ((typeof ground === 'number' && p.y < ground) || solid) {
                        // stuck: driven a little way in
                        p.addScaledVector(arrow.velocity.clone().normalize(), 0.12)
                        arrow.stuck = true
                    }
                    else if (p.y < WATER_LEVEL) {
                        // into the water: floats where it fell
                        p.y = WATER_LEVEL - 0.02
                        arrow.velocity.set(arrow.velocity.x * 0.1, 0, arrow.velocity.z * 0.1)
                        arrow.stuck = true
                    }
                }
                if (arrow.velocity.lengthSq() > 1e-4)
                    arrow.quaternion.setFromUnitVectors(up, arrow.velocity.clone().normalize())
            }
        }
        this.arrows.forEach((arrow, i) => {
            matrix.compose(arrow.position, arrow.quaternion, scale)
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

    /** Advance the tool's action and set the hand targets (before the character is posed). */
    update() {
        const dt = Math.min(this.state.time.delta, 0.05)
        const player = this.state.player
        const tool = this.equipped
        let right: THREE.Vector3 | null = null, left: THREE.Vector3 | null = null, weight = 0

        if (tool && player.swimming)
            this.select(null)

        if (this.action) {
            const action = ACTIONS[this.action.tool]!
            this.action.time += dt
            const pose = this.sample(action, this.action.time)
            right = pose.hand
            this.toolDirection.copy(pose.dir)
            weight = pose.weight
            if (action.twoHanded)
                left = pose.hand.clone().addScaledVector(pose.dir, 0.24)      // the other hand further up the handle
            if (!this.action.hitDone && this.action.time >= action.hit) {
                this.action.hitDone = true
                this.hit(this.action.tool)
            }
            if (this.action.time >= action.duration)
                this.action = this.useHeld && ACTIONS[this.action.tool] ? { tool: this.action.tool, time: 0, hitDone: false } : null
        }
        else if (tool === 'bow' && (this.aiming || this.recover > 0)) {
            if (this.aiming)
                this.draw = Math.min(1, this.draw + dt / 0.6)
            this.recover = Math.max(0, this.recover - dt)
            left = new THREE.Vector3(0.05, 1.42, 0.56)
            right = new THREE.Vector3(0.02, 1.43, 0.46).lerp(new THREE.Vector3(- 0.06, 1.52, 0.07), this.draw)
            this.toolDirection.set(0, 1, 0)
            weight = 1
        }
        else if (tool === 'torch') {
            right = new THREE.Vector3(- 0.22, 1.18, 0.3)
            this.toolDirection.set(0.05, 1, 0.12).normalize()
            weight = 1
        }

        this.handWeight += (weight - this.handWeight) * (1 - Math.exp(- dt * 14))
        this.hands.right = right
        this.hands.left = left
        this.hands.weight = right || left ? Math.min(this.handWeight, weight > 0 ? 1 : this.handWeight) : 0

        // face where the camera looks while aiming or striking
        const acting = this.aiming || this.action !== null
        player.aimYaw = acting ? this.state.player.camera.thirdPerson.theta : null
        this.updateArrows(dt)
    }

    /** Put the tool in the posed hand (after the character is posed). */
    place() {
        const tool = this.equipped
        const torchOn = tool === 'torch'
        const torch = this.view.sky.uniforms.uTorch.value as THREE.Vector4
        if (!tool) {
            torch.w = 0
            this.flameLight.intensity = 0
            return
        }
        const model = this.models.get(tool)!
        const bone = this.view.player.bone(tool === 'bow' ? 'hand_l' : 'hand_r')
        if (!bone)
            return
        bone.updateWorldMatrix(true, false)
        // the grip sits in the palm, a little way from the wrist toward the fingers
        const palm = new THREE.Vector3(0, 0.085, 0.02).applyMatrix4(bone.matrixWorld)
        const up = new THREE.Vector3(0, 1, 0)
        let direction: THREE.Vector3
        if (this.handWeight > 0.05 && (this.action || tool === 'torch' || (tool === 'bow' && (this.aiming || this.recover > 0)))) {
            direction = this.toolDirection.clone().applyAxisAngle(up, this.facing)
        }
        else {
            // carried: along the forearm, tipped forward (the bow hangs upright)
            const forearm = new THREE.Vector3().setFromMatrixColumn(bone.matrixWorld, 1).normalize()
            const forward = this.ahead(1).sub(this.toWorld(new THREE.Vector3()))
            direction = tool === 'bow' ? up.clone() : tool === 'hoe'
                ? forearm.clone().multiplyScalar(0.25).addScaledVector(forward, 0.4).addScaledVector(up, 0.9).normalize()
                : forearm.clone().addScaledVector(forward, 1.3).normalize()
        }
        // orientation: +Y along the direction, edges (+Z) toward the character's facing
        const facingDirection = this.ahead(1).sub(this.toWorld(new THREE.Vector3()))
        const x = new THREE.Vector3().crossVectors(direction, facingDirection)
        if (x.lengthSq() < 1e-6) x.set(1, 0, 0)
        x.normalize()
        const z = new THREE.Vector3().crossVectors(x, direction).normalize()
        model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, direction, z))
        model.position.copy(palm)

        // the bow's string follows the draw
        if (tool === 'bow') {
            const string = model.getObjectByName('string') as THREE.Line
            const positions = string.geometry.getAttribute('position') as THREE.BufferAttribute
            positions.setZ(1, - 0.13 - this.draw * 0.5)
            positions.needsUpdate = true
        }

        // the torch: a flickering flame, lighting the character and the land around
        if (torchOn) {
            this.flicker += (Math.random() - 0.5) * 0.4
            this.flicker *= 0.85
            const strength = 3.2 * (0.88 + 0.12 * Math.sin(this.state.time.elapsed * 23) + this.flicker * 0.3)
            this.flame.updateWorldMatrix(true, false)
            const at = new THREE.Vector3().setFromMatrixPosition(this.flame.matrixWorld)
            torch.set(at.x, at.y, at.z, strength)
            this.flameLight.intensity = strength * 2.2
            this.flame.children.forEach((sprite, i) => sprite.scale.setScalar((0.22 - i * 0.05) * (0.9 + Math.random() * 0.2)))
        }
        else {
            torch.w = 0
            this.flameLight.intensity = 0
        }
    }
}
