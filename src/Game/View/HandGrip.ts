import * as THREE from 'three'

/**
 * Hands that close on what they hold. No clip of the animation libraries makes a fist (their
 * hands rest half open), so a tool sat against an open palm. Here each finger is bent, joint
 * by joint, until it wraps a handle about 3.5 cm thick running along the knuckles through the
 * palm (the grip, hand bone space: x out of the back of the hand, y along the fingers, z
 * across the knuckles), the thumb closing over it from the other side.
 *
 * The bend of every joint is measured on the model itself (the axis that brings the finger
 * round the handle, and how far), from its bind pose when it is built; `apply` then blends
 * each joint from what the clip gave it toward the closed hand.
 */

// where a handle runs through the closed hand (hand bone space): across the base of the
// fingers, just inside the knuckles (they lie at y 0.11, x 0, z 0.03 to -0.04), as a hand
// holds a handle; the palm faces -x on the right hand, +x on the left
export const GRIP_CENTRE = {
    r: new THREE.Vector3(- 0.034, 0.11, - 0.005),
    l: new THREE.Vector3(0.034, 0.11, - 0.005)
}
const HANDLE = 0.0175               // the handle's radius (m)
const FINGER = 0.008                // a finger's half thickness
const FINGERS = ['index', 'middle', 'ring', 'pinky']
// how a finger's bend is shared out over its three joints (knuckle, middle, end), and the thumb's
const SHARE = [0.9, 1.3, 0.9]
const THUMB_SHARE = [0.35, 0.75, 0.75]
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(- 1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, - 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, - 1)]

type Joint = { bone: THREE.Object3D, closed: THREE.Quaternion }

export default class HandGrip {
    private joints: Record<'l' | 'r', Joint[]> = { l: [], r: [] }

    /** Measure the closed hands on `model`, which must be in its bind pose. */
    constructor(model: THREE.Object3D) {
        model.updateMatrixWorld(true)
        for (const side of ['l', 'r'] as const)
            this.calibrate(model, side)
    }

    /** Close a hand by `weight` (0 as the clip has it, 1 closed on the handle). */
    apply(side: 'l' | 'r', weight: number) {
        if (weight <= 0.001)
            return
        for (const joint of this.joints[side])
            joint.bone.quaternion.slerp(joint.closed, Math.min(1, weight))
    }

    private calibrate(model: THREE.Object3D, side: 'l' | 'r') {
        const hand = model.getObjectByName(`hand_${side}`)
        if (!hand)
            return
        const centre = GRIP_CENTRE[side]
        const inverse = new THREE.Matrix4()
        const local = new THREE.Vector3()
        // a point's distance from the handle's line (along hand z, through the centre)
        const fromHandle = (object: THREE.Object3D) => {
            object.updateWorldMatrix(true, false)
            local.setFromMatrixPosition(object.matrixWorld).applyMatrix4(inverse)
            return Math.hypot(local.x - centre.x, local.y - centre.y)
        }
        hand.updateWorldMatrix(true, true)
        inverse.copy(hand.matrixWorld).invert()

        for (const finger of [...FINGERS, 'thumb']) {
            const bones = [1, 2, 3].map((i) => model.getObjectByName(`${finger}_0${i}_${side}`))
            const tip = model.getObjectByName(`${finger}_04_leaf_${side}`)
            if (bones.some((bone) => !bone) || !tip)
                continue
            const chain = bones as THREE.Object3D[]
            const rest = chain.map((bone) => bone.quaternion.clone())
            const reset = () => chain.forEach((bone, i) => bone.quaternion.copy(rest[i]))
            // each joint's bend: the axis (of its own) that brings the tip nearest the handle
            const axes = chain.map((bone, i) => {
                let best = AXES[0], nearest = Infinity
                for (const axis of AXES) {
                    reset()
                    bone.quaternion.copy(rest[i]).multiply(new THREE.Quaternion().setFromAxisAngle(axis, 0.3))
                    const d = fromHandle(tip)
                    if (d < nearest) { nearest = d; best = axis }
                }
                return best
            })
            // how far: the bend that lays the finger round the handle
            const share = finger === 'thumb' ? THUMB_SHARE : SHARE
            const lie = HANDLE + FINGER
            let bestBend = 0, bestCost = Infinity
            for (let bend = 0; bend <= 1.6; bend += 0.02) {
                chain.forEach((bone, i) => bone.quaternion.copy(rest[i]).multiply(new THREE.Quaternion().setFromAxisAngle(axes[i], bend * share[i])))
                const points = finger === 'thumb' ? [tip] : [chain[1], chain[2], tip]
                const cost = points.reduce((sum, point) => sum + (fromHandle(point) - lie) ** 2, 0)
                if (cost < bestCost) { bestCost = cost; bestBend = bend }
            }
            chain.forEach((bone, i) => {
                const closed = rest[i].clone().multiply(new THREE.Quaternion().setFromAxisAngle(axes[i], bestBend * share[i]))
                this.joints[side].push({ bone, closed })
            })
            reset()
        }
    }
}
