import * as THREE from 'three'

import { GRIP_CENTRE } from './HandGrip'

/** A hand's target in the character's own space (x left, y up, z forward, from the feet). */
export type HandTarget = { position: THREE.Vector3 | null, quaternion: THREE.Quaternion | null, pole?: THREE.Vector3, weight?: number }   // pole: where the elbow points (character space); weight: this hand's share of the tool pose's

/** What a tool asks of the body this frame (Tools.ts). */
export type ToolPose = {
    right: HandTarget | null
    left: HandTarget | null
    weight: number           // 0 the clip's arms .. 1 the tool's
    twist: number            // radians: the chest turns left (+) or right (-)
    lean: number             // radians forward
    lower: number            // metres: bending the knees into a low stroke
    pitch: number            // radians: aiming up (-) or down (+) with the whole upper body
    hips?: number            // radians: the hips turned (an archer side-on to the mark), the legs with them
}

export type PoseInput = {
    crouch: number           // 0 standing .. 1 crouched
    slide: number            // 0 .. 1 sliding
    dive: number             // 0 .. 1 under water
    divePitch: number        // radians: + head down (descending), - head up
    ground: (x: number, z: number) => number
    groundNormal: THREE.Vector3      // world, under the character
    footIK: number           // 0 .. 1: feet on the terrain (standing, walking)
    yaw: number              // the model's turn inside its group (it may face -Z)
    climb: number            // 0 .. 1 on a rock face
    climbNormal: THREE.Vector3       // world, out of the rock
    climbPhase: number       // the limb cycle
    climbMove: { up: number, right: number }
    climbLunge: number       // 1 .. 0 during a lunge up
    climbGear: boolean       // climbing a tall face with a pair of axes
    mantle: number           // 0 .. 1 pulling up over an edge (0 when not)
    dt: number               // seconds since the last pose
    stride?: number          // radians: the hips turned toward a side-step, the chest kept ahead
    steady?: number          // 0 .. 1: the shoulders held square to the way the body faces (aiming), the gait's swing taken out
    leanPitch?: number       // radians: the whole body leaning forward (+) from the ankles
    leanBank?: number        // radians: leaning into a turn (+ toward the right)
    look?: THREE.Vector3 | null      // world: where the eyes go (a tool in hand: where the camera looks); else ahead
    tool?: ToolPose
}

const BONES = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r',
    'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r']

// where a tool's grip sits in the hand (hand bone space: y toward the fingers, z the thumb
// side, the palm facing -x on the right hand, +x on the left): through the closed fist (HandGrip)
export const GRIP_RIGHT = GRIP_CENTRE.r
export const GRIP_LEFT = GRIP_CENTRE.l

const up = new THREE.Vector3(0, 1, 0)

// hand space from a held tool's space: the handle through the fist toward the thumb (hand
// +z), the edge in line with the knuckles (hand +y); the same both ways (Tools.ts too)
export const HAND_IN_TOOL = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(- 1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)))

/**
 * Procedural poses layered over the animation clips, applied after the mixer each frame.
 *
 *  - feet on the terrain: each foot is lifted onto the ground under it and the body lowered
 *    by the lower foot's drop (the hips sink, the uphill knee bends), the soles tilted to
 *    the slope; smoothed so the feet don't snap
 *  - crouching: the body lowers and leans in, the solver keeps the feet where the walk cycle
 *    planted them
 *  - sliding feet first: hips on the ground and pitched back, torso leaning back, the lead
 *    leg reaching ahead, the trailing leg folded under it with the knee out, the trailing
 *    hand planted behind, the other arm forward for balance; the whole body on the slope
 *  - climbing: hips close to the rock, hanging off nearly straight arms, feet under the
 *    hips with the knees turned in; one limb moves at a time in a climber's order while the
 *    hips shift over the holding foot and the head follows the reaching hand; pulling up
 *    over the top
 *  - diving: the swim stroke pitched head-down or head-up
 *  - tool actions: the hands to the tool's grip (position and orientation), the chest
 *    turning and leaning into the stroke
 *
 * Limbs are two-bone chains solved analytically, with an optional pole for the knee or elbow.
 */
export default class CharacterPose {
    private bones: Record<string, THREE.Object3D | undefined> = {}
    private v = Array.from({ length: 8 }, () => new THREE.Vector3())
    private q = Array.from({ length: 4 }, () => new THREE.Quaternion())
    private pelvisDrop = 0
    private footLift = [0, 0]
    private footTilt = [new THREE.Quaternion(), new THREE.Quaternion()]
    // climbing: where each hand and foot holds on (left hand, right hand, left foot, right
    // foot), and the step it's taking: from, to, progress
    onPlant: ((limb: number, at: THREE.Vector3, gear: boolean) => void) | null = null      // a hand or foot taking its hold (0, 1 hands; 2, 3 feet)
    private limbs = Array.from({ length: 4 }, () => ({ anchor: null as THREE.Vector3 | null, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, duration: 0.25 }))
    private climbTurn = 0               // whose turn it is in the climber's order
    private climbBase: THREE.Vector3 | null = null
    private climbSpeed = 0
    private climbSway = 0               // metres: the hips over the holding foot (+ to the climber's right)
    private climbLook = 0               // -1 .. 1: the head turned to the reaching hand

    // the chest's place in the bind pose, and how far the clip has moved it now (the run
    // leans it forward): held tools move with the chest, not with the feet
    private chestRest = new THREE.Vector3(0, 1.27, - 0.05)
    readonly chestShift = new THREE.Vector3()

    private headRestInverse: THREE.Quaternion | null = null     // the head's turn in the bind pose, relative to the body (inverted)
    private chestRestInverse: THREE.Quaternion | null = null

    constructor(model: THREE.Object3D) {
        for (const name of BONES)
            this.bones[name] = model.getObjectByName(name)
        model.updateMatrixWorld(true)
        const rest = (bone: THREE.Object3D | undefined) => bone ? model.getWorldQuaternion(new THREE.Quaternion()).invert()
            .multiply(bone.getWorldQuaternion(new THREE.Quaternion())).invert() : null
        this.headRestInverse = rest(this.bones.Head)
        this.chestRestInverse = rest(this.bones.spine_03)
        if (this.bones.spine_03) {
            model.updateMatrixWorld(true)
            this.chestRest.copy(model.worldToLocal(this.bones.spine_03.getWorldPosition(new THREE.Vector3())))
        }
    }

    /** Rotate a bone by a world-space rotation (keeping its children attached). */
    private rotateWorld(bone: THREE.Object3D, rotation: THREE.Quaternion) {
        const [world, parent] = this.q
        bone.getWorldQuaternion(world)
        bone.parent!.getWorldQuaternion(parent)
        bone.quaternion.copy(parent.invert().multiply(rotation.clone().multiply(world)))
        bone.updateMatrixWorld(true)
    }

    /** Give a bone this world orientation, blended with the one it has by `weight`. */
    private orientWorld(bone: THREE.Object3D, rotation: THREE.Quaternion, weight = 1) {
        const parent = bone.parent!.getWorldQuaternion(this.q[1])
        const current = bone.getWorldQuaternion(this.q[0]).clone()
        const target = weight >= 1 ? rotation : current.slerp(rotation, weight)
        bone.quaternion.copy(parent.invert().multiply(target))
        bone.updateMatrixWorld(true)
    }

    /**
     * Two-bone solve, by aiming: where the middle joint must be for the root-to-target
     * distance (law of cosines), bent toward `pole` (a direction; without one, the way the
     * joint bends now), then each bone turned the shortest way onto its new direction. The
     * bend never depends on the arm or leg being slightly bent already, so a nearly straight
     * limb doesn't flip its elbow or knee between frames. The end keeps its world
     * orientation if asked.
     */
    private solve(root: THREE.Object3D, middle: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, keepEnd = true, pole: THREE.Vector3 | null = null) {
        const hip = root.getWorldPosition(new THREE.Vector3())
        const knee = middle.getWorldPosition(new THREE.Vector3())
        const ankle = end.getWorldPosition(new THREE.Vector3())
        const endWorld = end.getWorldQuaternion(new THREE.Quaternion())
        const upper = hip.distanceTo(knee), lower = knee.distanceTo(ankle)
        const toTarget = target.clone().sub(hip)
        const length = toTarget.length()
        if (length < 1e-5 || upper < 1e-5 || lower < 1e-5)
            return
        const line = toTarget.divideScalar(length)
        const reach = THREE.MathUtils.clamp(length, Math.abs(upper - lower) + 1e-3, upper + lower - 1e-3)
        // the bend: the pole's part across the line (or the joint's own), else any perpendicular
        const bend = (pole ? pole.clone() : knee.clone().sub(hip))
        bend.addScaledVector(line, - bend.dot(line))
        if (bend.lengthSq() < 1e-8) {
            bend.copy(knee).sub(hip).addScaledVector(line, - knee.clone().sub(hip).dot(line))
            if (bend.lengthSq() < 1e-8) bend.set(line.y, - line.x, 0).lengthSq() < 1e-8 ? bend.set(0, line.z, - line.y) : bend
        }
        bend.normalize()
        const cos = THREE.MathUtils.clamp((upper * upper + reach * reach - lower * lower) / (2 * upper * reach), - 1, 1)
        const kneeTarget = hip.clone().addScaledVector(line, upper * cos).addScaledVector(bend, upper * Math.sqrt(1 - cos * cos))
        const endTarget = hip.clone().addScaledVector(line, reach)
        // both bones get their whole orientation: along the bone (+Y in this rig) and the
        // hinge (+X: the elbow and knee bend about it) across the bend plane; nothing is
        // inherited from the clip's pose, so a swinging run cycle can't twist or flip the limb
        const hinge = new THREE.Vector3().crossVectors(bend, line).normalize()
        this.orient(root, kneeTarget.clone().sub(hip).normalize(), hinge)
        this.orient(middle, endTarget.sub(kneeTarget).normalize(), hinge)
        if (keepEnd) {
            const middleWorld = middle.getWorldQuaternion(new THREE.Quaternion())
            end.quaternion.copy(middleWorld.invert().multiply(endWorld))
            end.updateMatrixWorld(true)
        }
    }

    /** Give a bone the world orientation with +Y along `along` and +X as close to `hinge` as it can be. */
    private orient(bone: THREE.Object3D, along: THREE.Vector3, hinge: THREE.Vector3) {
        const z = new THREE.Vector3().crossVectors(hinge, along).normalize()
        const x = new THREE.Vector3().crossVectors(along, z)
        const world = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, along, z))
        const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()
        bone.quaternion.copy(parent.multiply(world))
        bone.updateMatrixWorld(true)
    }

    /** Solve a limb fully, then keep only `weight` of the change (a smooth hand-over from the clip). */
    private solveBlended(root: THREE.Object3D, middle: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, weight: number, keepEnd: boolean, pole: THREE.Vector3 | null) {
        if (weight <= 0.001)
            return
        const before = [root.quaternion.clone(), middle.quaternion.clone(), end.quaternion.clone()]
        this.solve(root, middle, end, target, keepEnd, pole)
        if (weight < 0.999) {
            [root, middle, end].forEach((bone, i) => bone.quaternion.copy(before[i].slerp(bone.quaternion, weight)))
            root.updateMatrixWorld(true)
        }
    }

    /** The world point `amount` above (along `normal`) the terrain near `point`. */
    private onGround(point: THREE.Vector3, ground: PoseInput['ground'], amount: number, normal: THREE.Vector3 = up) {
        const height = ground(point.x, point.z)
        // the vertical gap measured along the normal (exact on a plane)
        point.addScaledVector(normal, (height - point.y) * normal.y + amount)
        return point
    }

    /** The terrain's normal at (x, z). */
    private groundNormal(ground: PoseInput['ground'], x: number, z: number, out: THREE.Vector3) {
        const e = 0.18
        return out.set(ground(x - e, z) - ground(x + e, z), 2 * e, ground(x, z - e) - ground(x, z + e)).normalize()
    }

    /**
     * Hands and feet on the rock, moved the way a climber moves them: one limb at a time
     * (three always holding), in a climber's order (going up: a hand, the opposite foot,
     * the other hand, the other foot), each placed where the body will be by its next turn.
     * Hands reach in an arc off the rock, a foot lifts its knee and steps up close under the
     * hips. Holding still, they stay put.
     */
    private climbLimbs(base: THREE.Vector3, surfaceUp: THREE.Vector3, right: THREE.Vector3, normal: THREE.Vector3, move: THREE.Vector3, input: PoseInput) {
        // hands about shoulder width, one reaching higher than the other as they take turns
        // (with axes: a little lower and off the rock, the picks reaching above); feet under
        // the hips, about hip width, toes on the rock
        const gear = input.climbGear
        const reach = (gear ? 1.5 : 1.58) + input.climbLunge * 0.3
        const handClear = gear ? 0.17 : 0.06
        const layout: [number, number, number][] = [[reach, - 0.24, handClear], [reach, 0.24, handClear], [0.3, - 0.16, 0.11], [0.3, 0.16, 0.11]]
        const ideal = layout.map(([height, sideways, clearance]) =>
            this.onGround(base.clone().addScaledVector(surfaceUp, height).addScaledVector(right, sideways), input.ground, clearance, normal))

        // how fast the body moves along the face (where the next holds must be)
        const dt = Math.max(input.dt, 1e-3)
        const speed = this.climbBase ? Math.min(4, this.climbBase.distanceTo(base) / dt) : 0
        this.climbBase = (this.climbBase ?? new THREE.Vector3()).copy(base)
        this.climbSpeed += (speed - this.climbSpeed) * Math.min(1, dt * 8)

        const limbs = this.limbs
        limbs.forEach((limb, i) => {
            // first frame on the rock, or flung far off (a lunge): straight to a hold, the
            // right hand and left foot a little higher so the first moves are staggered
            if (!limb.anchor || limb.anchor.distanceTo(ideal[i]) > 0.9) {
                limb.anchor = ideal[i].clone().addScaledVector(surfaceUp, i === 1 || i === 2 ? 0.1 : - 0.04)
                limb.t = 1
            }
        })

        // the climber's order for the way of travel: up a hand then the opposite foot; down
        // the feet lead; sideways the leading side first
        const upward = move.dot(surfaceUp), across = move.dot(right)
        const order = Math.abs(across) > Math.abs(upward) * 1.2
            ? (across > 0 ? [1, 3, 0, 2] : [0, 2, 1, 3])
            : (upward >= 0 ? [1, 2, 0, 3] : [3, 0, 2, 1])
        const lunge = input.climbLunge > 0.05
        const busy = limbs.filter((limb) => limb.t < 1)
        // the next limb may start as the last one is settling (never more than two off the rock)
        if (busy.length === 0 || (busy.length === 1 && busy[0].t > 0.65)) {
            const ahead = THREE.MathUtils.clamp(this.climbSpeed * 0.4, 0.05, lunge ? 0.6 : 0.42)
            for (let k = 0; k < 4; k++) {
                const i = order[(this.climbTurn + k) % 4]
                const limb = limbs[i]
                if (limb.t < 1)
                    continue
                if (limb.anchor!.distanceTo(ideal[i]) < (lunge ? 0.05 : 0.1))
                    continue        // not behind: its turn passes to the next
                limb.from.copy(limb.anchor!)
                limb.to.copy(this.onGround(ideal[i].clone().addScaledVector(move, ahead), input.ground, layout[i][2], normal))
                limb.t = 0
                limb.duration = (lunge ? 0.13 : i < 2 ? 0.27 : 0.24) * (gear ? 1 : 0.8)
                this.climbTurn = (order.indexOf(i) + 1) % 4
                break
            }
        }

        // the body: the hips shift over the holding foot while a hand reaches or a foot steps
        let sway = 0, turn = 0
        const points = limbs.map((limb, i) => {
            if (limb.t < 1) {
                limb.t = Math.min(1, limb.t + dt / limb.duration)
                const u = limb.t * limb.t * (3 - 2 * limb.t)
                const arc = Math.sin(limb.t * Math.PI)
                const side = i % 2 === 0 ? - 1 : 1
                sway += - side * arc * (i < 2 ? 0.05 : 0.04)
                if (i < 2) turn += side * arc
                // a hand comes off the rock and reaches; a foot lifts its knee and steps in
                const point = limb.from.clone().lerp(limb.to, u).addScaledVector(normal, arc * (i < 2 ? 0.12 : 0.16))
                if (i >= 2) point.addScaledVector(surfaceUp, arc * 0.06)
                if (limb.t >= 1) {
                    limb.anchor!.copy(limb.to)
                    this.onPlant?.(i, limb.to, gear)
                }
                return point
            }
            return limb.anchor!.clone()
        })
        this.climbSway += (sway - this.climbSway) * Math.min(1, dt * 12)
        this.climbLook += (turn - this.climbLook) * Math.min(1, dt * 8)
        return points
    }

    apply(model: THREE.Object3D, group: THREE.Object3D, input: PoseInput) {
        const bones = this.bones
        if (!bones.thigh_l || !bones.thigh_r || !bones.pelvis)
            return
        const yaw = new THREE.Quaternion().setFromAxisAngle(up, input.yaw)
        const tool = input.tool && input.tool.weight > 0.001 ? input.tool : null
        if (bones.spine_03) {
            model.updateMatrixWorld(true)
            const chest = model.worldToLocal(bones.spine_03.getWorldPosition(new THREE.Vector3())).sub(this.chestRest)
            chest.x = 0
            this.chestShift.lerp(chest, 0.35)
        }

        // ── the whole body: pitched for a dive, on the slope for a slide, to the rock for a climb ──
        const groupInverse = group.getWorldQuaternion(new THREE.Quaternion()).invert()
        let root = new THREE.Quaternion()
        if (input.dive > 0.001) {
            const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(yaw)
            root.setFromAxisAngle(axis, input.divePitch * input.dive)
            const pivot = new THREE.Vector3(0, 0.9, 0)
            model.position.add(pivot.clone().sub(pivot.clone().applyQuaternion(root)))
        }
        if (input.slide > 0.001) {
            const normal = input.groundNormal.clone().applyQuaternion(groupInverse)
            root.slerp(new THREE.Quaternion().setFromUnitVectors(up, normal), input.slide)
        }
        if (input.climb > 0.001) {
            // lean into the face (flat against it on a vertical wall: no lean); on a slope that
            // can be scrambled up the body stays more upright than the ground, leaning in with
            // the hands ahead on the rock, instead of lying along it
            const normal = input.climbNormal.clone().applyQuaternion(groupInverse)
            const steepness = Math.acos(THREE.MathUtils.clamp(normal.y, - 1, 1))         // the face's angle from level
            const lean = (Math.PI / 2 - steepness) * THREE.MathUtils.lerp(0.6, 1, THREE.MathUtils.smoothstep(steepness, 1.0, 1.35)) * input.climb
            const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(yaw)
            root = new THREE.Quaternion().setFromAxisAngle(axis, lean).multiply(root)
            // hips close to the rock, shifted over the holding foot
            const surfaceRight = new THREE.Vector3(- normal.x * normal.y, 1 - normal.y * normal.y, - normal.z * normal.y).normalize().cross(normal).normalize()
            model.position.addScaledVector(normal, 0.24 * input.climb).addScaledVector(surfaceRight, this.climbSway * input.climb)
        }
        // a runner's lean, from the feet: forward into the acceleration, sideways into a turn
        if ((input.leanPitch && Math.abs(input.leanPitch) > 1e-4) || (input.leanBank && Math.abs(input.leanBank) > 1e-4)) {
            const across = new THREE.Vector3(1, 0, 0).applyQuaternion(yaw)
            const along = new THREE.Vector3(0, 0, 1).applyQuaternion(yaw)
            root = new THREE.Quaternion().setFromAxisAngle(across, input.leanPitch ?? 0)
                .multiply(new THREE.Quaternion().setFromAxisAngle(along, input.leanBank ?? 0)).multiply(root)
        }
        model.quaternion.copy(root).multiply(yaw)
        model.updateMatrixWorld(true)

        // the body's frame in the world (after the root turn): left, up, forward
        const frame = new THREE.Quaternion()
        model.getWorldQuaternion(frame)
        const left = new THREE.Vector3(1, 0, 0).applyQuaternion(frame)
        const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(frame)
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(frame)
        const origin = new THREE.Vector3().setFromMatrixPosition(model.matrixWorld)
        const feetY = group.getWorldPosition(new THREE.Vector3()).y

        // a side-step (with a tool in hand): the hips and legs turn toward the step, the spine
        // turns back so the chest still faces ahead
        const hips = (input.stride ?? 0) + (tool && tool.hips ? tool.hips * tool.weight : 0)
        if (Math.abs(hips) > 1e-3) {
            this.rotateWorld(bones.pelvis, new THREE.Quaternion().setFromAxisAngle(bodyUp, hips))
            const stride = input.stride ?? 0
            if (bones.spine_01) this.rotateWorld(bones.spine_01, new THREE.Quaternion().setFromAxisAngle(bodyUp, - stride * 0.6))
            if (bones.spine_02) this.rotateWorld(bones.spine_02, new THREE.Quaternion().setFromAxisAngle(bodyUp, - stride * 0.4))
        }

        // aiming: the walk swings the shoulders about the spine with each step; take that out
        // (the archer's turn side-on comes after, from the tool) so the aim doesn't sway
        const steady = input.steady ?? 0
        if (steady > 1e-3 && bones.upperarm_l && bones.upperarm_r && bones.spine_02 && bones.spine_03) {
            const across = bones.upperarm_l.getWorldPosition(this.v[0]).sub(bones.upperarm_r.getWorldPosition(this.v[1]))
            across.addScaledVector(bodyUp, - across.dot(bodyUp))
            const swing = Math.atan2(across.dot(forward), across.dot(left))      // + the left shoulder ahead
            if (Math.abs(swing) > 1e-3) {
                const turn = swing * steady          // about the up axis, + takes the left shoulder back
                this.rotateWorld(bones.spine_02, new THREE.Quaternion().setFromAxisAngle(bodyUp, turn * 0.5))
                this.rotateWorld(bones.spine_03, new THREE.Quaternion().setFromAxisAngle(bodyUp, turn * 0.5))
            }
        }

        // where the clip put the feet, before the body lowers
        const footL = bones.foot_l!.getWorldPosition(new THREE.Vector3())
        const footR = bones.foot_r!.getWorldPosition(new THREE.Vector3())

        // ── feet on the terrain: lift each onto the ground under it, sink the hips for the lower one ──
        const ik = input.footIK * (1 - input.slide) * (1 - input.climb)
        let drop = 0
        const feet = [footL, footR]
        if (ik > 0.001) {
            const lifts = feet.map((foot) => THREE.MathUtils.clamp(input.ground(foot.x, foot.z) - feetY, - 0.55, 0.55))
            drop = Math.min(0, lifts[0], lifts[1])
            lifts.forEach((lift, i) => { this.footLift[i] += (lift - this.footLift[i]) * 0.35 })
        }
        else
            this.footLift.forEach((_, i) => { this.footLift[i] *= 0.7 })
        this.pelvisDrop += (drop * ik - this.pelvisDrop) * 0.3
        feet.forEach((foot, i) => { foot.y += this.footLift[i] * Math.max(ik, 0.0) })

        const toolLower = tool ? tool.lower * tool.weight : 0
        const lowering = input.crouch * 0.42 + input.slide * 0.68 + toolLower + Math.sin(Math.min(1, input.mantle) * Math.PI) * 0.3 - this.pelvisDrop
        model.position.addScaledVector(bodyUp.clone().applyQuaternion(groupInverse), - lowering)
        model.updateMatrixWorld(true)

        // ── the spine ──
        const spineLean = input.crouch * 0.34 - input.slide * 0.22 + (tool ? tool.lean * tool.weight : 0) + Math.sin(Math.min(1, input.mantle) * Math.PI) * 0.55
        if (input.slide > 0.001)
            this.rotateWorld(bones.pelvis, new THREE.Quaternion().setFromAxisAngle(left, - input.slide * 0.72))
        if (bones.spine_01 && Math.abs(spineLean) > 1e-4)
            this.rotateWorld(bones.spine_01, new THREE.Quaternion().setFromAxisAngle(left, spineLean))
        if (tool && Math.abs(tool.twist) > 1e-4) {
            // the chest turns into the stroke, spread over the spine
            for (const name of ['spine_01', 'spine_02', 'spine_03'])
                if (bones[name])
                    this.rotateWorld(bones[name]!, new THREE.Quaternion().setFromAxisAngle(bodyUp, tool.twist * tool.weight / 3))
            // the head keeps looking where the stroke (or the arrow) goes
            if (bones.neck_01)
                this.rotateWorld(bones.neck_01, new THREE.Quaternion().setFromAxisAngle(bodyUp, - (tool.twist * 0.75 + (tool.hips ?? 0) * 0.9) * tool.weight))
        }
        if (tool && Math.abs(tool.pitch) > 1e-4 && bones.spine_02) {
            const chestLeft = new THREE.Vector3(1, 0, 0).applyQuaternion(bones.spine_02.getWorldQuaternion(this.q[0]))
            this.rotateWorld(bones.spine_02, new THREE.Quaternion().setFromAxisAngle(chestLeft, tool.pitch * tool.weight))
        }
        if (bones.neck_01) {
            const look = input.slide * 0.5 - input.climb * (0.45 + Math.abs(this.climbLook) * 0.25) - (tool ? tool.lean * tool.weight * 0.4 : 0)
            if (Math.abs(look) > 1e-4)
                this.rotateWorld(bones.neck_01, new THREE.Quaternion().setFromAxisAngle(left, look))
            // on the rock the head turns to the hand that's reaching
            if (input.climb > 0.001 && Math.abs(this.climbLook) > 1e-3)
                this.rotateWorld(bones.neck_01, new THREE.Quaternion().setFromAxisAngle(bodyUp, - this.climbLook * 0.45 * input.climb))
        }

        // ── legs and arms by pose ──
        let poleL: THREE.Vector3 | null = forward.clone().addScaledVector(left, 0.15)
        let poleR: THREE.Vector3 | null = forward.clone().addScaledVector(left, - 0.15)
        const arms: { side: 'l' | 'r', target: THREE.Vector3, pole: THREE.Vector3 | null, weight: number }[] = []

        if (input.slide > 0.001) {
            const s = input.slide
            // lead (left) leg reaching ahead, trailing (right) leg folded under it, knee out
            const lead = origin.clone().addScaledVector(forward, 0.84).addScaledVector(left, 0.12)
            const tuck = origin.clone().addScaledVector(forward, 0.24).addScaledVector(left, 0.02)
            this.onGround(lead, input.ground, 0.1)
            this.onGround(tuck, input.ground, 0.08)
            footL.lerp(lead, s)
            footR.lerp(tuck, s)
            poleL = bodyUp.clone().multiplyScalar(0.6).add(forward)
            poleR = left.clone().negate().addScaledVector(forward, 0.4).addScaledVector(bodyUp, - 0.35)
            // trailing hand planted behind the hip, the other arm forward for balance
            const plant = origin.clone().addScaledVector(forward, - 0.12).addScaledVector(left, - 0.4)
            this.onGround(plant, input.ground, 0.05)
            arms.push({ side: 'r', target: plant, pole: forward.clone().negate().addScaledVector(left, - 0.6), weight: s })
            arms.push({ side: 'l', target: origin.clone().addScaledVector(forward, 0.32).addScaledVector(left, 0.34).addScaledVector(bodyUp, 0.78), pole: bodyUp.clone().negate().addScaledVector(left, 0.5), weight: s })
        }

        if (input.climb > 0.001) {
            const c = input.climb
            const n = input.climbNormal
            const surfaceUp = new THREE.Vector3(- n.x * n.y, 1 - n.y * n.y, - n.z * n.y).normalize()
            const right = new THREE.Vector3().crossVectors(surfaceUp, n).normalize()
            const base = group.getWorldPosition(new THREE.Vector3())
            const move = new THREE.Vector3().addScaledVector(surfaceUp, input.climbMove.up).addScaledVector(right, input.climbMove.right)
            if (move.lengthSq() < 1e-6) move.copy(surfaceUp)
            move.normalize()
            const positions = this.climbLimbs(base, surfaceUp, right, n, move, input)
            footL.lerp(positions[2], c)
            footR.lerp(positions[3], c)
            // knees turned out only as far as the rock makes them, pointing up the face (not out
            // from it like a spider's); elbows down and a little out
            poleL = right.clone().multiplyScalar(- 0.55).addScaledVector(surfaceUp, 0.6).addScaledVector(n, - 0.25)
            poleR = right.clone().multiplyScalar(0.55).addScaledVector(surfaceUp, 0.6).addScaledVector(n, - 0.25)
            arms.push({ side: 'l', target: positions[0], pole: surfaceUp.clone().negate().addScaledVector(right, - 0.35).addScaledVector(n, 0.25), weight: c })
            arms.push({ side: 'r', target: positions[1], pole: surfaceUp.clone().negate().addScaledVector(right, 0.35).addScaledVector(n, 0.25), weight: c })
        }
        else {
            this.limbs.forEach((limb) => { limb.anchor = null; limb.t = 1 })
            this.climbBase = null
            this.climbSway = this.climbLook = 0
        }

        if (input.mantle > 0.001) {
            // hands pressing down on the top, ahead of the body
            const m = Math.sin(Math.min(1, input.mantle) * Math.PI)
            for (const side of ['l', 'r'] as const) {
                const point = origin.clone().addScaledVector(forward, 0.42).addScaledVector(left, side === 'l' ? 0.24 : - 0.24)
                this.onGround(point, input.ground, 0.06)
                arms.push({ side, target: point, pole: forward.clone().negate().addScaledVector(left, side === 'l' ? 0.5 : - 0.5), weight: m })
            }
        }

        // ── solve the legs ──
        const legsMoved = lowering > 0.002 || ik > 0.001 || input.slide > 0.001 || input.climb > 0.001
        if (legsMoved) {
            this.solve(bones.thigh_l, bones.calf_l!, bones.foot_l!, footL, true, poleL)
            this.solve(bones.thigh_r, bones.calf_r!, bones.foot_r!, footR, true, poleR)
        }
        // soles on the slope (a planted foot only)
        if (ik > 0.001) {
            const footBones = [bones.foot_l!, bones.foot_r!]
            footBones.forEach((foot, i) => {
                const position = foot.getWorldPosition(this.v[6])
                const planted = 1 - THREE.MathUtils.smoothstep(position.y - input.ground(position.x, position.z), 0.12, 0.3)
                const normal = this.groundNormal(input.ground, position.x, position.z, this.v[7])
                if (normal.y < 0.6) normal.lerp(up, 0.5).normalize()
                const tilt = new THREE.Quaternion().setFromUnitVectors(up, normal)
                this.footTilt[i].slerp(tilt, 0.3)
                this.rotateWorld(foot, new THREE.Quaternion().slerp(this.footTilt[i], planted * ik))
            })
        }

        // ── arms: the pose's own targets, then a tool's grip ──
        for (const arm of arms) {
            const upper = bones[`upperarm_${arm.side}`], lower = bones[`lowerarm_${arm.side}`], hand = bones[`hand_${arm.side}`]
            if (!upper || !lower || !hand || (tool && (arm.side === 'r' ? tool.right : tool.left)))
                continue
            this.solveBlended(upper, lower, hand, arm.target, arm.weight, true, arm.pole)
        }
        if (tool)
            this.hands(model, tool)
        if (input.climb > 0.05)
            this.climbGrip(input)
        this.steadyHead(input)
    }

    /**
     * The head kept level, the way people carry it whatever the body does: no tilt to the
     * side (a runner banking into a turn, a lean, a stroke), looking up or down only so far
     * and no further round than the chest allows, turned toward where the eyes go when given.
     */
    private steadyHead(input: PoseInput) {
        const head = this.bones.Head, chest = this.bones.spine_03
        if (!head || !chest || !this.headRestInverse || !this.chestRestInverse)
            return
        const frame = head.getWorldQuaternion(new THREE.Quaternion()).multiply(this.headRestInverse)
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(frame)
        const target = input.look ? input.look.clone().normalize() : forward
        // how far up or down
        const climbing = input.climb > 0.3
        const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(target.y, - 1, 1)), climbing ? - 0.3 : - 0.5, climbing ? 0.85 : 0.45)
        // and round: no more than 85° from where the chest faces (an archer looks along the arrow)
        const level = target.clone().setY(0)
        if (level.lengthSq() < 1e-6) level.copy(forward).setY(0)
        level.normalize()
        const chestForward = new THREE.Vector3(0, 0, 1).applyQuaternion(chest.getWorldQuaternion(new THREE.Quaternion()).multiply(this.chestRestInverse)).setY(0)
        if (chestForward.lengthSq() > 1e-6) {
            chestForward.normalize()
            const yaw = Math.atan2(new THREE.Vector3().crossVectors(chestForward, level).y, chestForward.dot(level))
            const limited = THREE.MathUtils.clamp(yaw, - 1.48, 1.48)
            if (limited !== yaw) level.copy(chestForward).applyAxisAngle(up, limited)
        }
        const look = level.multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch)).normalize()
        const left = new THREE.Vector3().crossVectors(up, look).normalize()
        const headUp = new THREE.Vector3().crossVectors(look, left)
        const steady = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, headUp, look))
        this.orientWorld(head, steady.multiply(this.headRestInverse.clone().invert()), 0.85)
    }

    /**
     * On the rock: the hands either flat on it, fingers up the face (scrambling), or holding
     * the axes upright with the picks into the rock (a tall face); the toes pointed into it.
     */
    private climbGrip(input: PoseInput) {
        const n = input.climbNormal
        const surfaceUp = new THREE.Vector3(- n.x * n.y, 1 - n.y * n.y, - n.z * n.y).normalize()
        for (const side of ['l', 'r'] as const) {
            const hand = this.bones[`hand_${side}`]
            if (!hand) continue
            let x: THREE.Vector3, y: THREE.Vector3
            if (input.climbGear) {
                // the axe: handle up the face and a little out, the pick (its edge) into the rock
                const handle = surfaceUp.clone().addScaledVector(n, 0.3).normalize()
                const pick = n.clone().negate()
                pick.addScaledVector(handle, - pick.dot(handle)).normalize()
                const tool = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(handle, pick), handle, pick))
                this.orientWorld(hand, tool.multiply(HAND_IN_TOOL), input.climb)
                continue
            }
            // flat: fingers up the face, the palm on the rock (the right palm faces -x, the left +x)
            y = surfaceUp.clone()
            x = side === 'r' ? n.clone() : n.clone().negate()
            const z = new THREE.Vector3().crossVectors(x, y).normalize()
            x = new THREE.Vector3().crossVectors(y, z)
            this.orientWorld(hand, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)), input.climb)
        }
        for (const side of ['l', 'r'] as const) {
            const foot = this.bones[`foot_${side}`]
            if (!foot) continue
            const toes = new THREE.Vector3(0, 1, 0).applyQuaternion(foot.getWorldQuaternion(new THREE.Quaternion()))
            const into = n.clone().negate().addScaledVector(surfaceUp, - 0.3).normalize()
            this.rotateWorld(foot, new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(toes, into), input.climb))
        }
    }

    /** Hands to a tool's grips: the wrist where the grip lands in the palm, the hand turned to hold it. */
    private hands(model: THREE.Object3D, tool: ToolPose) {
        model.updateMatrixWorld(true)
        const modelQuaternion = model.getWorldQuaternion(new THREE.Quaternion())
        for (const side of ['r', 'l'] as const) {
            const target = side === 'r' ? tool.right : tool.left
            const upper = this.bones[`upperarm_${side}`], lower = this.bones[`lowerarm_${side}`], hand = this.bones[`hand_${side}`]
            if (!target || !upper || !lower || !hand)
                continue
            const weight = tool.weight * (target.weight ?? 1)
            const orientation = target.quaternion ? modelQuaternion.clone().multiply(target.quaternion) : null
            if (target.position) {
                const grip = target.position.clone().add(this.chestShift).applyMatrix4(model.matrixWorld)
                // the wrist sits back from the grip by the palm's offset, turned as the hand will be
                const handQuaternion = orientation ?? hand.getWorldQuaternion(new THREE.Quaternion())
                const wrist = grip.sub((side === 'r' ? GRIP_RIGHT : GRIP_LEFT).clone().applyQuaternion(handQuaternion))
                const pole = (target.pole ? target.pole.clone() : new THREE.Vector3(side === 'r' ? - 0.6 : 0.6, - 1, - 0.3)).applyQuaternion(modelQuaternion)
                this.solveBlended(upper, lower, hand, wrist, weight, false, pole)
            }
            if (orientation)
                this.orientWorld(hand, orientation, weight)
        }
    }
}
