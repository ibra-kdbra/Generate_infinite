import * as THREE from 'three'

export type PoseInput = {
    crouch: number          // 0 standing .. 1 crouched
    slide: number           // 0 .. 1 sliding
    dive: number            // 0 .. 1 under water
    divePitch: number       // radians: + head down (descending), - head up
    ground: number          // world height of the ground under the character
}

const BONES = ['pelvis', 'spine_01', 'spine_02', 'neck_01', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l']

/**
 * Procedural poses layered over the animation clips, applied after the mixer each frame:
 * crouching (the body lowers, the spine leans in and a two-bone solver keeps each foot
 * where the walk cycle planted it), sliding (low and leaning back, one leg reaching ahead,
 * the other tucked) and diving (the swim stroke pitched head-down or head-up).
 */
export default class CharacterPose {
    private bones: Record<string, THREE.Object3D | undefined> = {}
    private v = Array.from({ length: 8 }, () => new THREE.Vector3())
    private q = Array.from({ length: 4 }, () => new THREE.Quaternion())

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

    /** Two-bone leg solve: bend the knee for the hip-to-target distance, aim the leg, keep the foot's orientation. */
    private solveLeg(thigh: THREE.Object3D, calf: THREE.Object3D, foot: THREE.Object3D, target: THREE.Vector3) {
        const [hip, knee, ankle, a, b, axis] = this.v
        thigh.getWorldPosition(hip)
        calf.getWorldPosition(knee)
        foot.getWorldPosition(ankle)
        const footWorld = foot.getWorldQuaternion(this.q[2]).clone()
        const upper = hip.distanceTo(knee), lower = knee.distanceTo(ankle)
        const reach = THREE.MathUtils.clamp(hip.distanceTo(target), Math.abs(upper - lower) + 1e-3, upper + lower - 1e-3)
        a.subVectors(hip, knee).normalize()
        b.subVectors(ankle, knee).normalize()
        const current = Math.acos(THREE.MathUtils.clamp(a.dot(b), - 1, 1))
        const desired = Math.acos(THREE.MathUtils.clamp((upper * upper + lower * lower - reach * reach) / (2 * upper * lower), - 1, 1))
        axis.crossVectors(a, b)
        if (axis.lengthSq() < 1e-8)
            axis.set(1, 0, 0).applyQuaternion(thigh.getWorldQuaternion(this.q[3]))
        axis.normalize()
        this.rotateWorld(calf, new THREE.Quaternion().setFromAxisAngle(axis, desired - current))
        foot.getWorldPosition(ankle)
        this.rotateWorld(thigh, new THREE.Quaternion().setFromUnitVectors(a.subVectors(ankle, hip).normalize(), b.subVectors(target, hip).normalize()))
        // the foot keeps the orientation the clip gave it
        const calfWorld = calf.getWorldQuaternion(this.q[3])
        foot.quaternion.copy(calfWorld.invert().multiply(footWorld))
        foot.updateMatrixWorld(true)
    }

    apply(model: THREE.Object3D, group: THREE.Object3D, input: PoseInput) {
        const bones = this.bones
        const side = new THREE.Vector3(1, 0, 0).applyQuaternion(group.quaternion)        // the character's left
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion)

        // ── diving: the whole body pitches around the chest ──
        if (input.dive > 0.001) {
            const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), input.divePitch * input.dive)
            const pivot = new THREE.Vector3(0, 0.9, 0)
            model.quaternion.copy(pitch)
            model.position.add(pivot.clone().sub(pivot.clone().applyQuaternion(pitch)))
        }

        const lowering = input.crouch * 0.42 + input.slide * 0.62
        if (lowering < 0.002 || !bones.thigh_l || !bones.thigh_r)
            return
        model.updateMatrixWorld(true)
        // where the clip put the feet, before the body lowers
        const footL = bones.foot_l!.getWorldPosition(new THREE.Vector3())
        const footR = bones.foot_r!.getWorldPosition(new THREE.Vector3())

        model.position.y -= lowering
        model.updateMatrixWorld(true)
        // crouching leans in; sliding leans back with the head up
        if (bones.spine_01)
            this.rotateWorld(bones.spine_01, new THREE.Quaternion().setFromAxisAngle(side, input.crouch * 0.34 - input.slide * 0.62))
        if (bones.neck_01 && input.slide > 0)
            this.rotateWorld(bones.neck_01, new THREE.Quaternion().setFromAxisAngle(side, input.slide * 0.45))
        if (input.slide > 0) {
            // arms out for balance, the left hand trailing toward the ground
            if (bones.upperarm_l)
                this.rotateWorld(bones.upperarm_l, new THREE.Quaternion().setFromAxisAngle(side, - input.slide * 0.8))
            if (bones.upperarm_r)
                this.rotateWorld(bones.upperarm_r, new THREE.Quaternion().setFromAxisAngle(forward, - input.slide * 0.6))
            const origin = group.getWorldPosition(new THREE.Vector3())
            const reachL = origin.clone().addScaledVector(forward, 0.72).addScaledVector(side, 0.1)
            const tuckR = origin.clone().addScaledVector(forward, 0.12).addScaledVector(side, - 0.18)
            reachL.y = input.ground + 0.1
            tuckR.y = input.ground + 0.12
            footL.lerp(reachL, input.slide)
            footR.lerp(tuckR, input.slide)
        }
        this.solveLeg(bones.thigh_l, bones.calf_l!, bones.foot_l!, footL)
        this.solveLeg(bones.thigh_r, bones.calf_r!, bones.foot_r!, footR)
    }
}
