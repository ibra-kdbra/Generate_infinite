import { vec3, quat, mat4, mat3 } from 'gl-matrix'

import Game from '../Game'
import State from './State'
import Player from './Player'
import Viewport from './Viewport'
import Time from './Time'
import Controls from './Controls'
import { WATER_LEVEL } from '../Workers/TerrainShape'

/**
 * Free camera (V). Flies with momentum: WASD moves along the view, Space rises, C sinks,
 * Shift is fast and the mouse wheel sets the cruising speed. It stays a little above the
 * ground and the water (sliding up slopes and cliffs instead of passing through them) and is
 * pushed out of tree trunks and boulders.
 */
export default class CameraFly {
    game: Game
    state: State
    viewport: Viewport
    time: Time
    controls: Controls
    player: Player
    active: boolean
    gameUp: vec3
    defaultForward: vec3
    forward: vec3
    rightward: vec3
    upward: vec3
    backward: vec3
    leftward: vec3
    downward: vec3
    position: vec3
    quaternion: quat
    rotateX: number
    rotateY: number
    rotateXLimits: { min: number; max: number }
    velocity = vec3.create()
    speed = 14                         // m/s cruising, wheel adjusts
    clearance = 1.2                    // metres kept above the ground
    radius = 0.6

    constructor(player: Player) {
        this.game = Game.getInstance()
        this.state = State.getInstance()
        this.viewport = this.state.viewport
        this.time = this.state.time
        this.controls = this.state.controls

        this.player = player

        this.active = false

        this.gameUp = vec3.fromValues(0, 1, 0)

        this.defaultForward = vec3.fromValues(0, 0, 1)

        this.forward = vec3.clone(this.defaultForward)
        this.rightward = vec3.create()
        this.upward = vec3.create()
        this.backward = vec3.create()
        this.leftward = vec3.create()
        this.downward = vec3.create()

        vec3.cross(this.rightward, this.gameUp, this.forward)
        vec3.cross(this.upward, this.forward, this.rightward)
        vec3.negate(this.backward, this.forward)
        vec3.negate(this.leftward, this.rightward)
        vec3.negate(this.downward, this.upward)

        this.position = vec3.fromValues(40, 10, 40)
        this.quaternion = quat.create()
        this.rotateX = - Math.PI * 0.15
        this.rotateY = Math.PI * 0.25
        this.rotateXLimits = { min: - Math.PI * 0.49, max: Math.PI * 0.49 }

        window.addEventListener('wheel', (event) => {
            if (!this.active)
                return
            this.speed = Math.min(220, Math.max(2, this.speed * Math.pow(1.0012, - event.deltaY)))
        }, { passive: true })
    }

    activate(position: vec3 | null = null, quaternion: quat | null = null) {
        this.active = true
        vec3.set(this.velocity, 0, 0, 0)

        if (position !== null && quaternion !== null) {
            // Position
            vec3.copy(this.position, position)

            // Rotations
            const rotatedForward = vec3.clone(this.defaultForward)
            vec3.transformQuat(rotatedForward, rotatedForward, quaternion)

            // Rotation Y
            const rotatedYForward = vec3.clone(rotatedForward)
            rotatedYForward[1] = 0
            this.rotateY = vec3.angle(this.defaultForward, rotatedYForward)

            if (vec3.dot(rotatedForward, vec3.fromValues(1, 0, 0)) < 0)
                this.rotateY *= - 1

            // Rotation X
            this.rotateX = vec3.angle(rotatedForward, rotatedYForward)

            if (vec3.dot(rotatedForward, vec3.fromValues(0, 1, 0)) > 0)
                this.rotateX *= - 1
        }
    }

    deactivate() {
        this.active = false
    }

    private ground(x: number, z: number) {
        const elevation = this.state.chunks.getElevationForPosition(x, z)
        return typeof elevation === 'number' && !Number.isNaN(elevation) ? elevation : - Infinity
    }

    /** The lowest the camera may be here: above the terrain around it and the water. */
    private floor(x: number, z: number) {
        const r = this.radius
        const terrain = Math.max(
            this.ground(x, z),
            this.ground(x + r, z), this.ground(x - r, z),
            this.ground(x, z + r), this.ground(x, z - r)
        )
        return Math.max(terrain, WATER_LEVEL + 0.25) + this.clearance
    }

    update() {
        if (!this.active)
            return

        const dt = Math.min(this.time.delta, 0.05)

        // Rotation X and Y
        if (this.controls.pointer.down || this.viewport.pointerLock.active) {
            const normalisedPointer = this.viewport.normalise(this.controls.pointer.delta)
            this.rotateX -= normalisedPointer.y * 2
            this.rotateY -= normalisedPointer.x * 2
            this.rotateX = Math.min(this.rotateXLimits.max, Math.max(this.rotateXLimits.min, this.rotateX))
        }

        // Rotation Matrix
        const rotationMatrix = mat4.create()
        mat4.rotateY(rotationMatrix, rotationMatrix, this.rotateY)
        mat4.rotateX(rotationMatrix, rotationMatrix, this.rotateX)

        const mat3Rotation = mat3.fromMat4(mat3.create(), rotationMatrix)
        quat.fromMat3(this.quaternion, mat3Rotation)

        // Update directions
        vec3.copy(this.forward, this.defaultForward)
        vec3.transformMat4(this.forward, this.forward, rotationMatrix)
        vec3.cross(this.rightward, this.gameUp, this.forward)
        vec3.normalize(this.rightward, this.rightward)
        vec3.cross(this.upward, this.forward, this.rightward)
        vec3.negate(this.backward, this.forward)
        vec3.negate(this.leftward, this.rightward)
        vec3.negate(this.downward, this.upward)

        // Wished direction: along the view, rise and sink straight up and down
        const keys = this.controls.keys.down
        const wish = vec3.create()
        if (keys.forward) vec3.add(wish, wish, this.backward)
        if (keys.backward) vec3.add(wish, wish, this.forward)
        if (keys.strafeRight) vec3.add(wish, wish, this.rightward)
        if (keys.strafeLeft) vec3.add(wish, wish, this.leftward)
        if (keys.jump) vec3.add(wish, wish, this.gameUp)
        if (keys.crouch) vec3.sub(wish, wish, this.gameUp)    // C
        if (vec3.length(wish) > 0)
            vec3.normalize(wish, wish)
        vec3.scale(wish, wish, this.speed * (keys.boost ? 3.5 : 1))

        // Momentum: ease toward the wished velocity (quick to start, glides to a stop)
        const response = 1 - Math.exp(- dt * (vec3.length(wish) > 0 ? 6 : 3.5))
        vec3.lerp(this.velocity, this.velocity, wish, response)
        vec3.scaleAndAdd(this.position, this.position, this.velocity, dt)

        // Solid world: trunks and boulders, then the ground and the water
        this.state.vegetation?.resolveCollision(this.position, this.radius)
        const floor = this.floor(this.position[0], this.position[2])
        if (this.position[1] < floor) {
            this.position[1] = floor
            if (this.velocity[1] < 0)
                this.velocity[1] = 0
        }
    }
}
