import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Settings from '../Settings'

const AZIMUTHS = 180
// distances of the rings sampled outward from the camera: close together near, far apart far
const RINGS: number[] = []
for (let d = 8; d < 1200; d = d * 1.17 + 3)
    RINGS.push(d)
const PER_FRAME = 18          // azimuths built per frame (a full map over ten frames)

/**
 * What the hills hide from the camera: for each of 180 directions, walking outward over the
 * terrain, the steepest rise seen so far (as a slope from the camera's height). An object is
 * hidden when the line to its top lies under that horizon at its distance (checked against
 * the neighbouring directions too, to stay on the safe side). Rebuilt a few directions per
 * frame whenever the camera has moved a few metres; the trees skip what's hidden (Trees.ts),
 * which in valleys and behind ridges is most of the far forest.
 */
export default class Horizon {
    view: View
    state: State
    version = 0
    enabled = true

    private slopes: Float32Array = new Float32Array(AZIMUTHS * RINGS.length).fill(- Infinity)
    private origin = new THREE.Vector3(Infinity, 0, 0)
    private building: { slopes: Float32Array, origin: THREE.Vector3, azimuth: number } | null = null
    private age = 0

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        const settings = Settings.getInstance()
        this.enabled = settings.get('hideHidden')
        settings.events.on('change:hideHidden', (on: boolean) => {
            this.enabled = on
            this.version++
        })
    }

    update() {
        if (!this.enabled)
            return
        this.age += this.state.time.delta
        const camera = this.view.camera.instance.position
        if (!this.building && (camera.distanceTo(this.origin) > 4 || this.age > 4))
            this.building = { slopes: new Float32Array(AZIMUTHS * RINGS.length), origin: camera.clone(), azimuth: 0 }
        if (!this.building)
            return
        const build = this.building
        const end = Math.min(AZIMUTHS, build.azimuth + PER_FRAME)
        for (let a = build.azimuth; a < end; a++) {
            const angle = a / AZIMUTHS * Math.PI * 2
            const cos = Math.cos(angle), sin = Math.sin(angle)
            let highest = - Infinity
            for (let r = 0; r < RINGS.length; r++) {
                const d = RINGS[r]
                const height = this.state.chunks.getElevationForPosition(build.origin.x + cos * d, build.origin.z + sin * d)
                // ground not known yet hides nothing
                if (typeof height === 'number' && !Number.isNaN(height))
                    highest = Math.max(highest, (height - build.origin.y) / d)
                build.slopes[a * RINGS.length + r] = highest
            }
        }
        build.azimuth = end
        if (end === AZIMUTHS) {
            this.slopes = build.slopes
            this.origin.copy(build.origin)
            this.building = null
            this.age = 0
            this.version++
        }
    }

    /** Whether a point (an object's top) can be seen over the hills from the camera. */
    visible(x: number, y: number, z: number) {
        if (!this.enabled || this.origin.x === Infinity)
            return true
        const dx = x - this.origin.x, dz = z - this.origin.z
        const distance = Math.hypot(dx, dz)
        // the terrain just in front of the object doesn't hide it: look a little nearer
        const near = distance * 0.9 - 2
        if (near < RINGS[0])
            return true
        let ring = 0
        while (ring + 1 < RINGS.length && RINGS[ring + 1] <= near)
            ring++
        const slope = (y - this.origin.y) / distance
        const azimuth = Math.round((Math.atan2(dz, dx) / (Math.PI * 2) + 1) * AZIMUTHS) % AZIMUTHS
        for (let k = - 1; k <= 1; k++) {
            const a = (azimuth + k + AZIMUTHS) % AZIMUTHS
            if (slope > this.slopes[a * RINGS.length + ring] - 0.004)
                return true
        }
        return false
    }
}
