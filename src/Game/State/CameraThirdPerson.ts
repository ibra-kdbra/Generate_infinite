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
 * the anchor. Sprinting widens the field of view a little.
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
            this.phi = Math.min(this.phiLimits.max, Math.max(this.phiLimits.min, this.phi))
        }

        // ── anchor: eased toward the player's chest ──
        const targetX = p[0], targetY = p[1] + this.aboveOffset, targetZ = p[2]
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

        // ── desired position on the orbit sphere ──
        const sinPhi = Math.sin(this.phi)
        const dirX = sinPhi * Math.sin(this.theta)
        const dirY = Math.cos(this.phi)
        const dirZ = sinPhi * Math.cos(this.theta)

        // ── keep the player visible: pull in before terrain that rises above the line, and
        // in front of tree trunks and boulders ──
        let distance = this.distance
        const samples = 12
        for (let i = 1; i <= samples; i++) {
            const d = this.distance * i / samples
            const x = this.anchor[0] + dirX * d
            const y = this.anchor[1] + dirY * d
            const z = this.anchor[2] + dirZ * d
            if (this.ground(x, z, - Infinity) + 0.45 > y || (i > 1 && this.state.vegetation?.isSolid(x, y, z, 0.35))) {
                distance = Math.max(this.distanceLimits.min * 0.6, this.distance * (i - 1) / samples)
                break
            }
        }

        this.position[0] = this.anchor[0] + dirX * distance
        this.position[1] = this.anchor[1] + dirY * distance
        this.position[2] = this.anchor[2] + dirZ * distance
        const floor = Math.max(this.ground(this.position[0], this.position[2], this.position[1]), WATER_LEVEL) + 0.6
        if (this.position[1] < floor)
            this.position[1] = floor

        // ── orientation last, so it always looks at the anchor ──
        const lookAt = mat4.create()
        mat4.targetTo(lookAt, this.position, this.anchor, this.gameUp)
        mat4.getRotation(this.quaternion, lookAt)

        // ── sprint: slightly wider field of view ──
        const sprintAmount = Math.max(0, Math.min(1, (this.player.speed - this.player.walkSpeed) / (this.player.runSpeed - this.player.walkSpeed)))
        this.fovOffset += (sprintAmount * 7 - this.fovOffset) * (1 - Math.exp(- dt * 4))
    }
}
