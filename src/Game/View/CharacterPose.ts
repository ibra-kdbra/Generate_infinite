import * as THREE from 'three'

/** A hand's target in the character's own space (x left, y up, z forward, from the feet). */
export type HandTarget = { position: THREE.Vector3 | null, quaternion: THREE.Quaternion | null }

/** What a tool asks of the body this frame (Tools.ts). */
export type ToolPose = {
    right: HandTarget | null
    left: HandTarget | null
    weight: number           // 0 the clip's arms .. 1 the tool's
    twist: number            // radians: the chest turns left (+) or right (-)
    lean: number             // radians forward
    lower: number            // metres: bending the knees into a low stroke
    pitch: number            // radians: aiming up (-) or down (+) with the whole upper body
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
    mantle: number           // 0 .. 1 pulling up over an edge (0 when not)
    tool?: ToolPose
}

const BONES = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r',
    'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r']

// where a tool's grip sits in the hand (hand bone space: y toward the fingers, z the thumb
// side, the palm facing -x on the right hand, +x on the left)
export const GRIP_RIGHT = new THREE.Vector3(- 0.012, 0.082, 0.018)
export const GRIP_LEFT = new THREE.Vector3(0.012, 0.082, 0.018)

const up = new THREE.Vector3(0, 1, 0)

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
 *  - climbing: the body flat to the rock at arm's length, hands and feet on the surface,
 *    moving in diagonal pairs (left hand with right foot) as the climber moves; pulling up
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

    constructor(model: THREE.Object3D) {
        for (const name of BONES)
            this.bones[name] = model.getObjectByName(name)
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
     * Two-bone solve: bend the middle joint for the root-to-target distance, aim the chain at
     * the target, turn the middle joint toward `pole` (a direction) if given; the end keeps
     * its world orientation if asked.
     */
    private solve(root: THREE.Object3D, middle: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, keepEnd = true, pole: THREE.Vector3 | null = null) {
        const [hip, knee, ankle, a, b, axis] = this.v
        root.getWorldPosition(hip)
        middle.getWorldPosition(knee)
        end.getWorldPosition(ankle)
        const endWorld = end.getWorldQuaternion(this.q[2]).clone()
        const upper = hip.distanceTo(knee), lower = knee.distanceTo(ankle)
        const reach = THREE.MathUtils.clamp(hip.distanceTo(target), Math.abs(upper - lower) + 1e-3, upper + lower - 1e-3)
        a.subVectors(hip, knee).normalize()
        b.subVectors(ankle, knee).normalize()
        const current = Math.acos(THREE.MathUtils.clamp(a.dot(b), - 1, 1))
        const desired = Math.acos(THREE.MathUtils.clamp((upper * upper + lower * lower - reach * reach) / (2 * upper * lower), - 1, 1))
        axis.crossVectors(a, b)
        if (axis.lengthSq() < 1e-8)
            axis.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(this.q[3]))
        axis.normalize()
        this.rotateWorld(middle, new THREE.Quaternion().setFromAxisAngle(axis, desired - current))
        end.getWorldPosition(ankle)
        this.rotateWorld(root, new THREE.Quaternion().setFromUnitVectors(a.subVectors(ankle, hip).normalize(), b.subVectors(target, hip).normalize()))
        if (pole) {
            // swing the chain about the root-to-target line until the middle joint faces the pole
            const line = b.subVectors(target, hip).normalize()
            middle.getWorldPosition(knee)
            const toKnee = a.subVectors(knee, hip)
            toKnee.addScaledVector(line, - toKnee.dot(line))
            const toPole = axis.copy(pole).addScaledVector(line, - pole.dot(line))
            if (toKnee.lengthSq() > 1e-8 && toPole.lengthSq() > 1e-8) {
                toKnee.normalize()
                toPole.normalize()
                const angle = Math.atan2(line.dot(new THREE.Vector3().crossVectors(toKnee, toPole)), toKnee.dot(toPole))
                this.rotateWorld(root, new THREE.Quaternion().setFromAxisAngle(line, angle))
            }
        }
        if (keepEnd) {
            const middleWorld = middle.getWorldQuaternion(this.q[3])
            end.quaternion.copy(middleWorld.invert().multiply(endWorld))
            end.updateMatrixWorld(true)
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

    apply(model: THREE.Object3D, group: THREE.Object3D, input: PoseInput) {
        const bones = this.bones
        if (!bones.thigh_l || !bones.thigh_r || !bones.pelvis)
            return
        const yaw = new THREE.Quaternion().setFromAxisAngle(up, input.yaw)
        const tool = input.tool && input.tool.weight > 0.001 ? input.tool : null

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
            // lean into the face (flat against it on a vertical wall: no lean), held off it
            const normal = input.climbNormal.clone().applyQuaternion(groupInverse)
            const steepness = Math.acos(THREE.MathUtils.clamp(normal.y, - 1, 1))         // the face's angle from level
            const lean = (Math.PI / 2 - steepness) * input.climb
            const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(yaw)
            root = new THREE.Quaternion().setFromAxisAngle(axis, lean).multiply(root)
            model.position.addScaledVector(normal, 0.3 * input.climb)
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
        const lowering = input.crouch * 0.42 + input.slide * 0.68 + toolLower + input.mantle * 0.25 - this.pelvisDrop
        model.position.addScaledVector(bodyUp.clone().applyQuaternion(groupInverse), - lowering)
        model.updateMatrixWorld(true)

        // ── the spine ──
        const spineLean = input.crouch * 0.34 - input.slide * 0.22 + (tool ? tool.lean * tool.weight : 0) + input.mantle * 0.5
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
                this.rotateWorld(bones.neck_01, new THREE.Quaternion().setFromAxisAngle(bodyUp, - tool.twist * tool.weight * 0.75))
        }
        if (tool && Math.abs(tool.pitch) > 1e-4 && bones.spine_02) {
            const chestLeft = new THREE.Vector3(1, 0, 0).applyQuaternion(bones.spine_02.getWorldQuaternion(this.q[0]))
            this.rotateWorld(bones.spine_02, new THREE.Quaternion().setFromAxisAngle(chestLeft, tool.pitch * tool.weight))
        }
        if (bones.neck_01) {
            const look = input.slide * 0.5 - input.climb * 0.35 - (tool ? tool.lean * tool.weight * 0.4 : 0)
            if (Math.abs(look) > 1e-4)
                this.rotateWorld(bones.neck_01, new THREE.Quaternion().setFromAxisAngle(left, look))
        }

        // ── legs and arms by pose ──
        let poleL: THREE.Vector3 | null = null, poleR: THREE.Vector3 | null = null
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
            // a limb's offset along the way of travel over the cycle: planted (sliding back
            // relative to the body) for 60 %, then reaching ahead off the rock
            const limb = (offset: number, amplitude: number) => {
                const phase = ((input.climbPhase + offset) % 1 + 1) % 1
                if (phase < 0.6)
                    return { along: amplitude * (1 - 2 * phase / 0.6), lift: 0 }
                const t = (phase - 0.6) / 0.4
                return { along: amplitude * (- 1 + 2 * t), lift: Math.sin(t * Math.PI) * 0.1 }
            }
            const place = (height: number, sideways: number, offset: number, amplitude: number, clearance: number) => {
                const step = limb(offset, amplitude)
                const point = base.clone().addScaledVector(surfaceUp, height).addScaledVector(right, sideways).addScaledVector(move, step.along)
                return this.onGround(point, input.ground, clearance + step.lift, n)
            }
            const reach = 1.62 + input.climbLunge * 0.3
            const handL = place(reach, - 0.27, 0, 0.18, 0.06)
            const handR = place(reach, 0.27, 0.5, 0.18, 0.06)
            footL.lerp(place(0.2, - 0.17, 0.5, 0.18, 0.08), c)
            footR.lerp(place(0.2, 0.17, 0, 0.18, 0.08), c)
            poleL = right.clone().negate().addScaledVector(n, 0.6).addScaledVector(surfaceUp, - 0.2)
            poleR = right.clone().addScaledVector(n, 0.6).addScaledVector(surfaceUp, - 0.2)
            arms.push({ side: 'l', target: handL, pole: surfaceUp.clone().negate().addScaledVector(right, - 0.6).addScaledVector(n, 0.4), weight: c })
            arms.push({ side: 'r', target: handR, pole: surfaceUp.clone().negate().addScaledVector(right, 0.6).addScaledVector(n, 0.4), weight: c })
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
            const current = hand.getWorldPosition(new THREE.Vector3())
            this.solve(upper, lower, hand, current.lerp(arm.target, arm.weight), true, arm.pole)
        }
        if (tool)
            this.hands(model, tool)
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
            const orientation = target.quaternion ? modelQuaternion.clone().multiply(target.quaternion) : null
            if (target.position) {
                const grip = target.position.clone().applyMatrix4(model.matrixWorld)
                // the wrist sits back from the grip by the palm's offset, turned as the hand will be
                const handQuaternion = orientation ?? hand.getWorldQuaternion(new THREE.Quaternion())
                const wrist = grip.sub((side === 'r' ? GRIP_RIGHT : GRIP_LEFT).clone().applyQuaternion(handQuaternion))
                const current = hand.getWorldPosition(new THREE.Vector3())
                const pole = new THREE.Vector3(side === 'r' ? - 0.6 : 0.6, - 1, - 0.3).applyQuaternion(modelQuaternion)
                this.solve(upper, lower, hand, current.lerp(wrist, tool.weight), false, pole)
            }
            if (orientation)
                this.orientWorld(hand, orientation, tool.weight)
        }
    }
}
