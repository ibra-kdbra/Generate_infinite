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
 * `maxWalkSlope` can't be walked up and make the player slide; pushing into one climbs it
 * (hands and feet on the rock, W/S up and down, A/D along it, Space a lunge up, C lets go)
 * while stamina lasts, and at the top the player pulls up over the edge. Water slows wading;
 * where it's deeper than `swimDepth` the player floats chest-deep and swims.
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
    static STATE_DIVE = 'dive'
    static STATE_CROUCH = 'crouch'
    static STATE_CLIMB = 'climb'
    static STATE_MANTLE = 'mantle'

    game: Game
    state: State
    time: Time
    controls: Controls

    // tuning (metres, seconds)
    crouchSpeed = 1.9            // holding C
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
    slideBoost = 1.12            // a slide starts a little faster than the run
    slideFriction = 3.4          // m/s² on level ground (much less than walking)
    slideEndSpeed = 2.6
    diveSpeed = 2.4              // swimming down (C) or up (Space) under water
    breathTime = 30              // seconds under water before having to come up
    climbSpeed = 1.5             // along the rock face
    climbDrain = 1 / 22          // stamina per second while climbing (a third of that holding still)
    lungeCost = 0.14             // stamina for a lunge up the face
    staminaRegen = 1 / 3.5       // per second on the ground

    // poses for the view: 0 standing .. 1 crouched (smoothed)
    crouch = 0
    sliding = false
    diving = false               // under the surface
    breath = 1                   // 1 full .. 0 out of air
    aimYaw: number | null = null // set while aiming or striking with a tool: face this way

    // climbing: the rock face's normal (out of the rock), the limb cycle and the way the
    // climber moves along the face (up, right) for the view; pulling up over the top
    climbing = false
    climbNormal = vec3.fromValues(0, 0, 1)
    climbPhase = 0
    climbMove = { up: 0, right: 0 }
    climbLunge = 0               // 1 at the start of a lunge .. 0
    mantle: { time: number, duration: number, from: vec3, to: vec3 } | null = null
    stamina = 1                  // 1 full .. 0 spent
    exhausted = false            // ran out: no climbing until it's refilled a bit

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
    private crouchWasDown = false
    private crouchPressed = false
    private slideTime = 0
    private lastGround = 0
    private pushTime = 0           // how long the player has pushed into a too-steep face
    private lungeTime = 0
    private lunge = { x: 0, z: 0, speed: 0, time: 0 }      // a step with a tool strike
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

    groundAt(x: number, z: number): number {
        const elevation = this.state.chunks.getElevationForPosition(x, z)
        if (typeof elevation === 'number' && !Number.isNaN(elevation)) {
            this.lastGround = elevation
            return elevation
        }
        return this.lastGround      // chunk not generated yet: keep the last known height
    }

    sampleGroundNormal(x: number, z: number, out: vec3, e = 0.6) {
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

        if (this.mantle) {
            this.mantleStep(dt)
            return
        }
        if (this.climbing) {
            this.climbStep(dt, jumpPressed)
            return
        }
        this.tryClimb(dt, wish)
        if (this.climbing)
            return

        // ── water: float where it's deep, slow down while wading ──
        const floatHeight = WATER_LEVEL - this.swimDepth
        this.swimming = this.groundAt(p[0], p[2]) < floatHeight && p[1] < floatHeight + 0.15
        if (this.swimming)
            this.grounded = false
        const wading = this.grounded ? Math.min(1, Math.max(0, (WATER_LEVEL - p[1]) / this.swimDepth)) : 0
        if (this.swimming)
            this.swimPhase += dt / (hasInputWish(wish) ? (running ? 0.62 : 0.8) : 1.7)
        const crouchHeld = !!this.controls.keys.down.crouch && this.camera.mode !== Camera.MODE_FLY
        // ── slide: C while running drops into a slide that carries the run's momentum, slows
        // slowly on level ground and speeds up down a slope (held C keeps it going downhill)
        const horizontal = Math.hypot(v[0], v[2])
        if (this.crouchPressed && this.grounded && !this.swimming && !this.sliding && horizontal > this.walkSpeed + 0.6) {
            this.sliding = true
            this.slideTime = 0
            v[0] *= this.slideBoost
            v[2] *= this.slideBoost
        }
        this.crouchPressed = false
        if (this.sliding) {
            this.slideTime += dt
            const downhill = (1 - this.groundNormal[1]) > 0.08
            const over = horizontal < this.slideEndSpeed
                || (!crouchHeld && this.slideTime > 0.4)
                || (!downhill && this.slideTime > 2.2)
                || this.swimming
                || (!this.grounded && this.timeSinceGrounded > 0.35)
            if (over)
                this.sliding = false
        }
        const crouching = crouchHeld && this.grounded && !this.swimming && !this.sliding

        // each arm stroke pushes: speed surges then glides (the mean stays the nominal speed)
        const stroke = Math.max(0, Math.sin(this.swimPhase * Math.PI * 2))
        const targetSpeed = this.swimming
            ? (running ? this.swimSprintSpeed : this.swimSpeed) * (0.85 + stroke * stroke * 0.6)
            : (running && !crouching ? this.runSpeed : crouching ? this.crouchSpeed : this.walkSpeed) * (1 - 0.5 * wading)

        // ── horizontal movement ──
        const hasInput = wish[0] !== 0 || wish[2] !== 0
        let ax = 0, az = 0
        if (this.sliding) {
            const n = this.groundNormal
            // friction against the slide, gravity pulling down the slope
            const s = Math.hypot(v[0], v[2]) || 1
            const drop = Math.min(s, this.slideFriction * dt)
            ax = - v[0] / s * drop + n[0] * n[1] * this.gravity * dt
            az = - v[2] / s * drop + n[2] * n[1] * this.gravity * dt
            // a little steering
            if (hasInput) {
                ax += wish[0] * 3 * dt
                az += wish[2] * 3 * dt
            }
        }
        else if (hasInput) {
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
        if (this.sliding) {
            const s = Math.hypot(v[0], v[2])
            if (s > 18) { v[0] *= 18 / s; v[2] *= 18 / s }
        }

        // ── a step into a tool strike ──
        if (this.lunge.time > 0 && this.grounded) {
            this.lunge.time -= dt
            const along = v[0] * this.lunge.x + v[2] * this.lunge.z
            if (along < this.lunge.speed) {
                v[0] += (this.lunge.speed - along) * this.lunge.x
                v[2] += (this.lunge.speed - along) * this.lunge.z
            }
        }

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
            this.sliding = false
            this.grounded = false
            this.timeSinceGrounded = this.coyoteTime   // consume
            this.timeSinceJumpPressed = Infinity
        }

        // ── gravity (or buoyancy) + integrate ──
        if (this.swimming) {
            // under water: C swims down, Space up, otherwise the body drifts back up; at the
            // surface a buoyancy spring holds it chest-deep, bobbing with the strokes
            const jumpHeld = !!this.controls.keys.down.jump && this.camera.mode !== Camera.MODE_FLY
            const outOfAir = this.breath <= 0
            const down = crouchHeld && !outOfAir, up = jumpHeld || outOfAir
            if (down || up || p[1] < floatHeight - 0.35) {
                const target = down ? - this.diveSpeed : up ? this.diveSpeed * (outOfAir ? 1.3 : 1) : 0.7
                v[1] += (target - v[1]) * Math.min(1, 6 * dt)
                // reaching the surface from below hands over to the spring
                if (!down && p[1] > floatHeight - 0.2)
                    v[1] += ((floatHeight - p[1]) * 40 - v[1] * 9) * dt
            }
            else {
                const bob = Math.sin(this.swimPhase * Math.PI * 2 + 1.2) * 0.04
                v[1] += ((floatHeight + bob - p[1]) * 40 - v[1] * 9) * dt
            }
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
        if (this.swimming && p[1] < newGround + 0.25) {
            // the lake bed: swim along it
            p[1] = newGround + 0.25
            if (v[1] < 0) v[1] = 0
        }
        else if (p[1] <= newGround) {
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

    /** Step forward with a strike (the tools): at least this speed that way for a moment. */
    stepForward(directionX: number, directionZ: number, speed: number, duration: number) {
        const length = Math.hypot(directionX, directionZ) || 1
        this.lunge = { x: directionX / length, z: directionZ / length, speed, time: duration }
    }

    /** Pushing into a face too steep to walk up (or jumping at one) grabs hold of it. */
    private tryClimb(dt: number, wish: vec3) {
        const p = this.position.current
        const crouchHeld = !!this.controls.keys.down.crouch
        if (!hasInputWish(wish) || crouchHeld || this.sliding || this.exhausted || this.stamina < 0.05
            || this.camera.mode === Camera.MODE_FLY || (this.swimming && this.diving)) {
            this.pushTime = 0
            return
        }
        const ax = p[0] + wish[0] * 0.55, az = p[2] + wish[2] * 0.55
        const rise = this.groundAt(ax, az) - p[1]
        const n = vec3.create()
        this.sampleGroundNormal(ax, az, n, 0.45)
        const horizontal = Math.hypot(n[0], n[2]) || 1
        const into = - (n[0] * wish[0] + n[2] * wish[2]) / horizontal       // 1 straight at the face
        if (n[1] < this.maxWalkSlope - 0.02 && rise > 0.3 && into > 0.55)
            this.pushTime += dt
        else
            this.pushTime = 0
        const airborne = !this.grounded && !this.swimming
        if (this.pushTime > 0.14 || (airborne && this.pushTime > 0 && rise > 0.5))
            this.startClimb()
    }

    private startClimb() {
        this.climbing = true
        this.sliding = false
        this.swimming = false
        this.grounded = false
        this.pushTime = 0
        vec3.set(this.velocity, 0, 0, 0)
        const p = this.position.current
        p[1] = this.groundAt(p[0], p[2])
        this.sampleGroundNormal(p[0], p[2], this.climbNormal, 0.45)
    }

    private stopClimb(push: number) {
        this.climbing = false
        this.climbLunge = 0
        const n = this.climbNormal
        const horizontal = Math.hypot(n[0], n[2]) || 1
        this.velocity[0] = n[0] / horizontal * push
        this.velocity[2] = n[2] / horizontal * push
        this.velocity[1] = 0
        this.timeSinceGrounded = this.coyoteTime     // no jumping off thin air
    }

    /**
     * On the face: moving along the rock's surface (up the slope's steepest line or across
     * it), stuck to the terrain under the hands; stamina drains; walkable ground under the
     * feet ends the climb, walkable ground just above pulls the climber up over the edge.
     */
    private climbStep(dt: number, jumpPressed: boolean) {
        const p = this.position.current
        const keys = this.controls.keys.down
        const n = this.climbNormal
        const sampled = vec3.create()
        this.sampleGroundNormal(p[0], p[2], sampled, 0.45)
        vec3.lerp(n, n, sampled, Math.min(1, dt * 12))
        vec3.normalize(n, n)

        // the face's own frame: up along the steepest line, right across it
        const up = vec3.fromValues(- n[0] * n[1], 1 - n[1] * n[1], - n[2] * n[1])
        vec3.normalize(up, up)
        const right = vec3.cross(vec3.create(), up, n)
        vec3.normalize(right, right)

        let forward = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0)
        let side = (keys.strafeRight ? 1 : 0) - (keys.strafeLeft ? 1 : 0)
        const length = Math.hypot(forward, side)
        if (length > 0) { forward /= length; side /= length }

        // Space: a lunge up the face (or, pulling back, a jump away from it); C lets go
        if (jumpPressed && !this.exhausted) {
            if (forward < - 0.5) {
                this.stopClimb(4.5)
                this.velocity[1] = this.jumpSpeed * 0.7
                this.stamina = Math.max(0, this.stamina - this.lungeCost * 0.5)
                return
            }
            if (this.stamina > this.lungeCost * 0.5 && this.lungeTime <= 0) {
                this.lungeTime = 0.32
                this.climbLunge = 1
                this.stamina = Math.max(0, this.stamina - this.lungeCost)
            }
        }
        if (keys.crouch) {
            this.stopClimb(1.2)
            return
        }

        let speed = this.climbSpeed * (this.stamina < 0.2 ? 0.6 : 1)
        if (this.lungeTime > 0) {
            this.lungeTime -= dt
            this.climbLunge = Math.max(0, this.lungeTime / 0.32)
            forward = 1
            side *= 0.3
            speed = 3.8 * Math.sin(Math.max(0, this.lungeTime) / 0.32 * Math.PI) + 0.4
        }
        const moving = forward !== 0 || side !== 0
        this.stamina = Math.max(0, this.stamina - dt * this.climbDrain * (moving ? 1 : 0.33))
        if (this.stamina <= 0) {
            this.exhausted = true
            this.stopClimb(1.5)
            return
        }

        // move along the surface: horizontally, then back onto the terrain
        const vx = (up[0] * forward + right[0] * side) * speed
        const vz = (up[2] * forward + right[2] * side) * speed
        const vy = (up[1] * forward + right[1] * side) * speed
        p[0] += vx * dt
        p[2] += vz * dt
        p[1] = this.groundAt(p[0], p[2])
        this.state.vegetation?.resolveCollision(p, 0.3)
        const travelled = Math.hypot(vx, vy, vz) * dt
        this.climbPhase += travelled / (0.75 * 0.6)       // one limb cycle per 0.75 m... in stance 60 %
        if (moving) {
            this.climbMove.up = forward
            this.climbMove.right = side
        }

        // facing the rock
        const horizontal = Math.hypot(n[0], n[2]) || 1
        const target = Math.atan2(n[0] / horizontal, n[2] / horizontal)
        let delta = target - this.rotation
        delta = Math.atan2(Math.sin(delta), Math.cos(delta))
        this.rotation += delta * Math.min(1, dt * 10)

        // the top: walkable ground just above pulls the climber up over the edge
        const here = vec3.create()
        this.sampleGroundNormal(p[0], p[2], here, 0.45)
        const ux = - n[0] / horizontal, uz = - n[2] / horizontal
        const top = vec3.create()
        this.sampleGroundNormal(p[0] + ux * 0.7, p[2] + uz * 0.7, top, 0.45)
        if (forward > 0 && (top[1] > this.maxWalkSlope + 0.06 || here[1] > this.maxWalkSlope + 0.06)) {
            const tx = p[0] + ux * 0.85, tz = p[2] + uz * 0.85
            this.climbing = false
            this.climbLunge = 0
            this.mantle = { time: 0, duration: 0.75, from: vec3.clone(p), to: vec3.fromValues(tx, this.groundAt(tx, tz), tz) }
            return
        }
        // the bottom: walkable ground under the feet stands the climber up
        if (forward < 0 && here[1] > this.maxWalkSlope + 0.04) {
            this.climbing = false
            this.grounded = true
            return
        }
        // into deep water
        if (p[1] < WATER_LEVEL - this.swimDepth) {
            this.climbing = false
            return
        }
        vec3.set(this.velocity, 0, 0, 0)
    }

    /** Pulling up over the edge: up first, then forward onto the top. */
    private mantleStep(dt: number) {
        const m = this.mantle!
        m.time += dt
        const t = Math.min(1, m.time / m.duration)
        const p = this.position.current
        const rise = Math.min(1, t / 0.6)
        const along = Math.max(0, (t - 0.35) / 0.65)
        const easeRise = 1 - Math.pow(1 - rise, 2)
        const easeAlong = along * along * (3 - 2 * along)
        p[0] = m.from[0] + (m.to[0] - m.from[0]) * easeAlong
        p[2] = m.from[2] + (m.to[2] - m.from[2]) * easeAlong
        const lift = Math.max(m.to[1], m.from[1]) + 0.12
        p[1] = Math.max(this.groundAt(p[0], p[2]), m.from[1] + (lift - m.from[1]) * easeRise - (t > 0.8 ? (t - 0.8) / 0.2 * 0.12 : 0))
        vec3.set(this.velocity, 0, 0, 0)
        if (t >= 1) {
            p[1] = this.groundAt(p[0], p[2])
            this.mantle = null
            this.grounded = true
            this.timeSinceGrounded = 0
        }
    }

    update() {
        const wish = vec3.create()
        this.readInput(wish)

        // jump is edge-triggered so holding Space doesn't bunny-hop forever
        const jumpDown = this.camera.mode !== Camera.MODE_FLY && !!this.controls.keys.down.jump
        let jumpPressed = jumpDown && !this.jumpWasDown
        this.jumpWasDown = jumpDown
        const crouchDown = this.camera.mode !== Camera.MODE_FLY && !!this.controls.keys.down.crouch
        if (crouchDown && !this.crouchWasDown)
            this.crouchPressed = true
        this.crouchWasDown = crouchDown

        this.accumulator = Math.min(this.accumulator + this.time.delta, 0.25)
        while (this.accumulator >= this.step) {
            this.fixedStep(this.step, wish, jumpPressed)
            jumpPressed = false
            this.accumulator -= this.step
        }

        // stamina comes back on the ground (or swimming at the surface)
        if (!this.climbing && !this.mantle && (this.grounded || this.swimming)) {
            this.stamina = Math.min(1, this.stamina + this.time.delta * this.staminaRegen)
            if (this.stamina > 0.35)
                this.exhausted = false
        }

        // face the movement direction, smoothly
        const horizontalSpeed = Math.hypot(this.velocity[0], this.velocity[2])
        if (this.climbing || this.mantle) {
            // the climb turns the player to the rock (climbStep)
        }
        else if (this.aimYaw !== null) {
            let delta = this.aimYaw - this.rotation
            delta = Math.atan2(Math.sin(delta), Math.cos(delta))
            this.rotation += delta * Math.min(1, 18 * this.time.delta)
        }
        else if (horizontalSpeed > 0.4) {
            const target = Math.atan2(- this.velocity[0], - this.velocity[2])
            let delta = target - this.rotation
            delta = Math.atan2(Math.sin(delta), Math.cos(delta))
            this.rotation += delta * Math.min(1, this.turnSpeed * this.time.delta)
        }

        const steep = this.groundNormal[1] < this.maxWalkSlope
        const p0 = this.position.current
        this.diving = this.swimming && p0[1] < WATER_LEVEL - this.swimDepth - 0.35
        // holding breath while the head is under (about 1.6 m above the feet)
        if (this.swimming && p0[1] + 1.6 < WATER_LEVEL)
            this.breath = Math.max(0, this.breath - this.time.delta / this.breathTime)
        else
            this.breath = Math.min(1, this.breath + this.time.delta / 3)
        const crouchHeld = !!this.controls.keys.down.crouch && this.camera.mode !== Camera.MODE_FLY
        const crouchTarget = this.sliding ? 1 : crouchHeld && this.grounded && !this.swimming && !this.climbing ? 1 : 0
        this.crouch += (crouchTarget - this.crouch) * (1 - Math.exp(- this.time.delta * 10))
        this.movementState = this.mantle ? Player.STATE_MANTLE
            : this.climbing ? Player.STATE_CLIMB
            : this.swimming ? (this.diving ? Player.STATE_DIVE : Player.STATE_SWIM)
            : !this.grounded ? (this.velocity[1] > 0 ? Player.STATE_JUMP : Player.STATE_FALL)
            : this.sliding || (steep && horizontalSpeed > 1) ? Player.STATE_SLIDE
            : this.crouch > 0.5 ? Player.STATE_CROUCH
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
