import { vec3, quat, mat4 } from 'gl-matrix'

import State from './State'
import Player from './Player'
import Viewport from './Viewport'
import Controls from './Controls'
import { WATER_LEVEL } from '../Workers/TerrainShape'

/**
 * Orbit camera behind the player.
 *
 * Drag (or pointer lock) orbits, the mouse wheel zooms. The anchor eases toward the
 * player's chest (vertical easing is softer so bumps don't shake the view). The terrain is
 * sampled along the line from the anchor to the camera and the camera moves in front of any
 * hill that would hide the player; the orientation is computed last so it always looks at
 * the anchor. Sprinting widens the field of view a little. Aiming the bow moves the camera
 * in over the right shoulder with a narrower view; hits and falling trees shake it (a
 * smooth, decaying wobble, never more than one at a time).
 */
export default class CameraThirdPerson {
    state: State
    viewport: Viewport
    controls: Controls
    player: Player
    active: boolean
    gameUp: vec3
    position: vec3
    quaternion: quat
    distance: number
    targetDistance: number
    distanceLimits = { min: 2.5, max: 18 }
    phi: number
    theta: number
    aboveOffset: number
    phiLimits: { min: number, max: number }
    fovOffset = 0                 // degrees, read by the view camera
    aim = 0                       // 0 .. 1 over the shoulder (the bow sets it while drawing)

    private aimAmount = 0
    private trauma = 0

    private anchor = vec3.create()
    private anchorReady = false

    constructor(player: Player) {
        this.state = State.getInstance()
        this.viewport = this.state.viewport
        this.controls = this.state.controls
        this.player = player

        this.active = false
        this.gameUp = vec3.fromValues(0, 1, 0)
        this.position = vec3.create()
        this.quaternion = quat.create()
        this.distance = 7
        this.targetDistance = 7
        this.phi = Math.PI * 0.40
        this.theta = - Math.PI * 0.25
        this.aboveOffset = 1.35
        this.phiLimits = { min: 0.15, max: Math.PI * 0.62 }   // can look up a little, not from underground

        window.addEventListener('wheel', (event) => {
            if (!this.active)
                return
            this.targetDistance *= Math.pow(1.0015, event.deltaY)
            this.targetDistance = Math.min(this.distanceLimits.max, Math.max(this.distanceLimits.min, this.targetDistance))
        }, { passive: true })
    }

    activate() {
        this.active = true
        this.anchorReady = false
    }

    deactivate() {
        this.active = false
    }

    /** A jolt (0..1): adds up to a cap, dies away within half a second or so. */
    shake(amount: number) {
        this.trauma = Math.min(1, this.trauma + amount)
    }

    private ground(x: number, z: number, fallback: number) {
        const elevation = this.state.chunks.getElevationForPosition(x, z)
        return typeof elevation === 'number' && !Number.isNaN(elevation) ? elevation : fallback
    }

    update() {
        if (!this.active)
            return

        const dt = Math.min(this.state.time.delta, 0.05)
        const p = this.player.position.current

        // ── orbit input ──
        if (this.controls.pointer.down || this.viewport.pointerLock.active) {
            const normalisedPointer = this.viewport.normalise(this.controls.pointer.delta)
            this.phi -= normalisedPointer.y * 2
            this.theta -= normalisedPointer.x * 2
            this.phi = Math.min(this.phiLimits.max + this.aimAmount * Math.PI * 0.12, Math.max(this.phiLimits.min, this.phi))
        }
        this.aimAmount += (this.aim - this.aimAmount) * (1 - Math.exp(- dt * 9))
        const aim = this.aimAmount * this.aimAmount * (3 - 2 * this.aimAmount)

        // ── anchor: eased toward the player's chest ──
        // lower with the body when crouching or sliding
        const targetX = p[0], targetY = p[1] + this.aboveOffset - this.player.crouch * 0.45, targetZ = p[2]
        if (!this.anchorReady) {
            vec3.set(this.anchor, targetX, targetY, targetZ)
            this.anchorReady = true
        }
        const kh = 1 - Math.exp(- dt * 14)
        const kv = 1 - Math.exp(- dt * 7)
        this.anchor[0] += (targetX - this.anchor[0]) * kh
        this.anchor[2] += (targetZ - this.anchor[2]) * kh
        this.anchor[1] += (targetY - this.anchor[1]) * kv

        this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(- dt * 10))
        const orbitDistance = this.distance + (3.1 - this.distance) * aim

        // over the shoulder: the whole orbit slides right (and up a little) of the anchor
        const rightX = Math.cos(this.theta), rightZ = - Math.sin(this.theta)
        const center = vec3.fromValues(
            this.anchor[0] + rightX * 0.58 * aim,
            this.anchor[1] + 0.12 * aim,
            this.anchor[2] + rightZ * 0.58 * aim)

        // ── desired position on the orbit sphere ──
        const sinPhi = Math.sin(this.phi)
        const dirX = sinPhi * Math.sin(this.theta)
        const dirY = Math.cos(this.phi)
        const dirZ = sinPhi * Math.cos(this.theta)

        // ── keep the player visible: pull in before terrain that rises above the line, and
        // in front of tree trunks and boulders ──
        let distance = orbitDistance
        const samples = 12
        for (let i = 1; i <= samples; i++) {
            const d = orbitDistance * i / samples
            const x = center[0] + dirX * d
            const y = center[1] + dirY * d
            const z = center[2] + dirZ * d
            if (this.ground(x, z, - Infinity) + 0.45 > y || (i > 1 && this.state.vegetation?.isSolid(x, y, z, 0.35))) {
                distance = Math.max(Math.min(this.distanceLimits.min * 0.6, orbitDistance), orbitDistance * (i - 1) / samples)
                break
            }
        }

        this.position[0] = center[0] + dirX * distance
        this.position[1] = center[1] + dirY * distance
        this.position[2] = center[2] + dirZ * distance
        const ground = this.ground(this.position[0], this.position[2], this.position[1])
        if (this.player.diving) {
            // follow the diver: under the surface (never straddling it), above the lake bed
            this.position[1] = Math.min(this.position[1], WATER_LEVEL - 0.35)
            this.position[1] = Math.max(this.position[1], ground + 0.4)
        }
        else {
            const floor = Math.max(ground, WATER_LEVEL) + 0.6
            if (this.position[1] < floor)
                this.position[1] = floor
        }

        // ── orientation last, so it always looks at the anchor (the shoulder point when aiming) ──
        const lookAt = mat4.create()
        mat4.targetTo(lookAt, this.position, center, this.gameUp)
        mat4.getRotation(this.quaternion, lookAt)

        // ── shake: a smooth wobble, strongest right after the hit ──
        if (this.trauma > 0.001) {
            const t = this.state.time.elapsed
            const amount = this.trauma * this.trauma
            const wobble = (a: number, b: number) => Math.sin(t * a) * 0.6 + Math.sin(t * b + 1.3) * 0.4
            this.position[0] += wobble(41, 23) * amount * 0.09
            this.position[1] += wobble(37, 29) * amount * 0.07
            this.position[2] += wobble(43, 19) * amount * 0.09
            this.trauma = Math.max(0, this.trauma - dt * 2.2)
        }

        // ── sprint: slightly wider field of view; aiming: narrower ──
        const sprintAmount = Math.max(0, Math.min(1, (this.player.speed - this.player.walkSpeed) / (this.player.runSpeed - this.player.walkSpeed)))
        this.fovOffset += (sprintAmount * 7 * (1 - aim) - 13 * aim - this.fovOffset) * (1 - Math.exp(- dt * 6))
    }
}
