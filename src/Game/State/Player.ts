import { vec3 } from 'gl-matrix'

import Game from '../Game'
import State from './State'
import Camera from './Camera'
import Time from './Time'
import Controls from './Controls'
import { WATER_LEVEL } from '../Workers/TerrainShape'

/**
 * Character controller on the procedural heightfield.
 *
 * Fixed 120 Hz steps (stable at any frame rate): camera-relative input accelerates the
 * horizontal velocity toward a walk/sprint target with ground friction and limited air
 * control; gravity, jumping with coyote time and a jump buffer; the ground is the terrain
 * height under the player, its slope comes from finite differences. Slopes steeper than
 * `maxWalkSlope` can't be climbed and make the player slide. Water slows wading; where it's
 * deeper than `swimDepth` the player floats chest-deep and swims.
 */
const hasInputWish = (wish: vec3) => wish[0] !== 0 || wish[2] !== 0

export default class Player {
    static STATE_IDLE = 'idle'
    static STATE_WALK = 'walk'
    static STATE_RUN = 'run'
    static STATE_JUMP = 'jump'
    static STATE_FALL = 'fall'
    static STATE_SLIDE = 'slide'
    static STATE_SWIM = 'swim'

    game: Game
    state: State
    time: Time
    controls: Controls

    // tuning (metres, seconds)
    strollSpeed = 1.6            // holding C
    walkSpeed = 5.2              // default pace (an easy jog)
    runSpeed = 9.5               // holding Shift
    groundAcceleration = 45
    groundFriction = 30
    airAcceleration = 9
    gravity = 26
    jumpSpeed = 9
    maxFallSpeed = 55
    maxWalkSlope = 0.72          // ground normal y; below this the slope is too steep
    stickDistance = 0.6          // stay glued to the ground when running over crests
    coyoteTime = 0.12
    jumpBufferTime = 0.12
    turnSpeed = 12               // how fast the character turns toward its movement
    swimDepth = 1.3              // water deeper than this floats the player (feet this far down)
    swimSpeed = 2.6
    swimSprintSpeed = 4.2
    swimAcceleration = 10
    waterDrag = 2.5

    rotation: number
    speed: number                // horizontal speed (m/s)
    velocity: vec3
    grounded: boolean
    swimming = false
    // wet from the water: up to which height on the body (m above the feet) and how wet
    // (1 dripping .. 0 dry); dries over about a minute once out of the water
    wetHeight = 0
    wetness = 0
    dryingTime = 60
    groundNormal: vec3
    movementState: string
    position: {
        current: vec3
        previous: vec3
        delta: vec3
    }
    camera: Camera

    private accumulator = 0
    private swimPhase = 0          // stroke cycle: propulsion comes in pulses, the body bobs
    private timeSinceGrounded = 0
    private timeSinceJumpPressed = Infinity
    private jumpWasDown = false
    private lastGround = 0
    private readonly step = 1 / 120

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()
        this.time = this.state.time
        this.controls = this.state.controls

        this.rotation = 0
        this.speed = 0
        this.velocity = vec3.create()
        this.grounded = false
        this.groundNormal = vec3.fromValues(0, 1, 0)
        this.movementState = Player.STATE_IDLE

        this.position = {
            current: vec3.fromValues(10, 0, 1),
            previous: vec3.create(),
            delta: vec3.create()
        }
        vec3.copy(this.position.previous, this.position.current)

        this.camera = new Camera(this)
    }

    private groundAt(x: number, z: number): number {
        const elevation = this.state.chunks.getElevationForPosition(x, z)
        if (typeof elevation === 'number' && !Number.isNaN(elevation)) {
            this.lastGround = elevation
            return elevation
        }
        return this.lastGround      // chunk not generated yet: keep the last known height
    }

    private sampleGroundNormal(x: number, z: number, out: vec3) {
        const e = 0.6
        const hL = this.groundAt(x - e, z)
        const hR = this.groundAt(x + e, z)
        const hD = this.groundAt(x, z - e)
        const hU = this.groundAt(x, z + e)
        vec3.set(out, hL - hR, 2 * e, hD - hU)
        vec3.normalize(out, out)
    }

    private readInput(out: vec3) {
        vec3.set(out, 0, 0, 0)
        if (this.camera.mode === Camera.MODE_FLY)
            return
        const keys = this.controls.keys.down
        let forward = 0
        let right = 0
        if (keys.forward) forward += 1
        if (keys.backward) forward -= 1
        if (keys.strafeRight) right += 1
        if (keys.strafeLeft) right -= 1
        if (forward === 0 && right === 0)
            return
        // camera theta: the camera sits at +sin/+cos(theta), so "forward" points the other way
        const theta = this.camera.thirdPerson.theta
        const fx = - Math.sin(theta), fz = - Math.cos(theta)
        const rx = - fz, rz = fx
        vec3.set(out, fx * forward + rx * right, 0, fz * forward + rz * right)
        vec3.normalize(out, out)
    }

    private fixedStep(dt: number, wish: vec3, jumpPressed: boolean) {
        const p = this.position.current
        const v = this.velocity
        const running = this.controls.keys.down.boost

        this.sampleGroundNormal(p[0], p[2], this.groundNormal)
        const steep = this.groundNormal[1] < this.maxWalkSlope

        // ── water: float where it's deep, slow down while wading ──
        const floatHeight = WATER_LEVEL - this.swimDepth
        this.swimming = this.groundAt(p[0], p[2]) < floatHeight && p[1] < floatHeight + 0.15
        if (this.swimming)
            this.grounded = false
        const wading = this.grounded ? Math.min(1, Math.max(0, (WATER_LEVEL - p[1]) / this.swimDepth)) : 0
        if (this.swimming)
            this.swimPhase += dt / (hasInputWish(wish) ? (running ? 0.62 : 0.8) : 1.7)
        // each arm stroke pushes: speed surges then glides (the mean stays the nominal speed)
        const stroke = Math.max(0, Math.sin(this.swimPhase * Math.PI * 2))
        const targetSpeed = this.swimming
            ? (running ? this.swimSprintSpeed : this.swimSpeed) * (0.85 + stroke * stroke * 0.6)
            : (running ? this.runSpeed : this.controls.keys.down.walk ? this.strollSpeed : this.walkSpeed) * (1 - 0.5 * wading)

        // ── horizontal movement ──
        const hasInput = wish[0] !== 0 || wish[2] !== 0
        let ax = 0, az = 0
        if (hasInput) {
            let wx = wish[0] * targetSpeed, wz = wish[2] * targetSpeed
            if (this.grounded && steep) {
                // no climbing a too-steep slope: drop the uphill part of the wish
                const nx = this.groundNormal[0], nz = this.groundNormal[2]
                const nLength = Math.hypot(nx, nz) || 1
                const downX = nx / nLength, downZ = nz / nLength
                const along = wx * downX + wz * downZ
                if (along < 0) { wx -= along * downX; wz -= along * downZ }
            }
            const accel = this.swimming ? this.swimAcceleration : this.grounded ? this.groundAcceleration : this.airAcceleration
            const dx = wx - v[0], dz = wz - v[2]
            const dLength = Math.hypot(dx, dz)
            const maxDelta = accel * dt
            const k = dLength > maxDelta ? maxDelta / dLength : 1
            ax = dx * k
            az = dz * k
        }
        else if (this.swimming) {
            // drift to a stop
            const k = 1 - Math.exp(- this.waterDrag * dt)
            ax = - v[0] * k
            az = - v[2] * k
        }
        else if (this.grounded) {
            // friction toward a stop
            const s = Math.hypot(v[0], v[2])
            const drop = Math.min(s, this.groundFriction * dt)
            if (s > 0) { ax = - v[0] / s * drop; az = - v[2] / s * drop }
        }
        v[0] += ax
        v[2] += az

        // ── sliding down steep ground ──
        if (this.grounded && steep) {
            const n = this.groundNormal
            // gravity projected on the slope plane, horizontal part
            const slideAccel = this.gravity * (1 - n[1])
            const nLength = Math.hypot(n[0], n[2]) || 1
            v[0] += n[0] / nLength * slideAccel * dt
            v[2] += n[2] / nLength * slideAccel * dt
        }

        // ── jump (coyote time + buffer) ──
        if (jumpPressed)
            this.timeSinceJumpPressed = 0
        const canJump = (this.grounded || this.timeSinceGrounded < this.coyoteTime) && !steep && !this.swimming
        if (canJump && this.timeSinceJumpPressed < this.jumpBufferTime) {
            v[1] = this.jumpSpeed
            this.grounded = false
            this.timeSinceGrounded = this.coyoteTime   // consume
            this.timeSinceJumpPressed = Infinity
        }

        // ── gravity (or buoyancy) + integrate ──
        if (this.swimming) {
            // buoyancy spring toward the surface, damped, with a gentle bob in the stroke rhythm
            const bob = Math.sin(this.swimPhase * Math.PI * 2 + 1.2) * 0.04
            v[1] += ((floatHeight + bob - p[1]) * 40 - v[1] * 9) * dt
        }
        else if (!this.grounded)
            v[1] = Math.max(v[1] - this.gravity * dt, - this.maxFallSpeed)

        p[0] += v[0] * dt
        p[1] += v[1] * dt
        p[2] += v[2] * dt

        // trunks and boulders
        this.state.vegetation?.resolveCollision(p, 0.32)

        // ── ground contact ──
        const newGround = this.groundAt(p[0], p[2])
        if (p[1] <= newGround) {
            p[1] = newGround
            if (v[1] < 0) v[1] = 0
            this.grounded = true
        }
        else if (this.grounded && v[1] <= 0 && p[1] - newGround < this.stickDistance) {
            // running over a crest: stay on the ground instead of launching
            p[1] = newGround
            v[1] = 0
        }
        else {
            this.grounded = false
        }

        this.timeSinceGrounded = this.grounded ? 0 : this.timeSinceGrounded + dt
        this.timeSinceJumpPressed += dt
    }

    update() {
        const wish = vec3.create()
        this.readInput(wish)

        // jump is edge-triggered so holding Space doesn't bunny-hop forever
        const jumpDown = this.camera.mode !== Camera.MODE_FLY && !!this.controls.keys.down.jump
        let jumpPressed = jumpDown && !this.jumpWasDown
        this.jumpWasDown = jumpDown

        this.accumulator = Math.min(this.accumulator + this.time.delta, 0.25)
        while (this.accumulator >= this.step) {
            this.fixedStep(this.step, wish, jumpPressed)
            jumpPressed = false
            this.accumulator -= this.step
        }

        // face the movement direction, smoothly
        const horizontalSpeed = Math.hypot(this.velocity[0], this.velocity[2])
        if (horizontalSpeed > 0.4) {
            const target = Math.atan2(- this.velocity[0], - this.velocity[2])
            let delta = target - this.rotation
            delta = Math.atan2(Math.sin(delta), Math.cos(delta))
            this.rotation += delta * Math.min(1, this.turnSpeed * this.time.delta)
        }

        const steep = this.groundNormal[1] < this.maxWalkSlope
        this.movementState = this.swimming ? Player.STATE_SWIM
            : !this.grounded ? (this.velocity[1] > 0 ? Player.STATE_JUMP : Player.STATE_FALL)
            : steep && horizontalSpeed > 1 ? Player.STATE_SLIDE
            : horizontalSpeed > this.walkSpeed + 1 ? Player.STATE_RUN
            : horizontalSpeed > 0.3 ? Player.STATE_WALK
            : Player.STATE_IDLE

        // wetness: the deepest the water reached on the body; dries out of the water
        const p = this.position.current
        const submerged = this.swimming ? 1.9 : Math.max(0, WATER_LEVEL - p[1])
        if (submerged > 0.02) {
            this.wetHeight = Math.max(this.wetness > 0.05 ? this.wetHeight : 0, Math.min(1.9, submerged + 0.08))
            this.wetness = 1
        }
        else if (this.wetness > 0) {
            this.wetness = Math.max(0, this.wetness - this.time.delta / this.dryingTime)
            if (this.wetness === 0)
                this.wetHeight = 0
        }

        vec3.sub(this.position.delta, this.position.current, this.position.previous)
        vec3.copy(this.position.previous, this.position.current)
        this.speed = horizontalSpeed

        this.camera.update()
    }
}
