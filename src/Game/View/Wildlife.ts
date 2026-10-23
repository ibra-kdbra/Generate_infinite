import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { vec3 } from 'gl-matrix'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import View from './View'
import State from '../State/State'
import { WATER_LEVEL } from '../Workers/TerrainShape'

type Kind = 'deer' | 'stag'
type Mood = 'graze' | 'idle' | 'walk' | 'alert' | 'flee' | 'hurt' | 'dead'

type Animal = {
    kind: Kind
    herd: Herd
    root: THREE.Group
    model: THREE.Object3D
    mixer: THREE.AnimationMixer
    actions: Record<string, THREE.AnimationAction>
    current: string
    mood: Mood
    timer: number
    position: THREE.Vector3
    heading: number
    speed: number
    target: THREE.Vector3
    health: number
    fade: number
    tilt: THREE.Quaternion
    pending: number                  // seconds of animation not yet played (far deer update less often)
    frame: number                    // its own count, staggering when it updates
}
type Herd = { center: THREE.Vector3, animals: Animal[], fleeing: number }

const SCALE: Record<Kind, number> = { deer: 0.36, stag: 0.42 }
const WALK_SPEED = 1.15
const FLEE_SPEED = 10
const HERDS = 3
const SPAWN = { near: 70, far: 170 }
const DESPAWN = 300

/**
 * Deer (Quaternius' Ultimate Animated Animal Pack, CC0): a few small herds of does, now and
 * then with a stag, living around the player in meadows and along forest edges. They graze
 * head-down, look about, wander after each other; something approaching makes them raise
 * their heads and watch, and closer still (much closer if you crouch and creep, much farther
 * if you sprint) the whole herd bolts, galloping away and leaping, until they feel safe again.
 * An arrow or a blade makes them flinch and flee; a second one brings them down. They walk on
 * the terrain, leaning with the slope, and are drawn only near the player; herds left far
 * behind are replaced by new ones out of sight.
 */
export default class Wildlife {
    view: View
    state: State
    animals: Animal[] = []
    private herds: Herd[] = []
    private sources: Partial<Record<Kind, { scene: THREE.Object3D, clips: THREE.AnimationClip[] }>> = {}
    private spawnTimer = 1
    private depthMaterial = new THREE.MeshDepthMaterial()
    // deer let go, kept to be used again: making one (its model, skeleton and every clip's
    // action) took up to 50 ms, a hitch each time a herd appeared
    private pool: Record<Kind, Animal[]> = { deer: [], stag: [] }

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.load()
    }

    private async load() {
        const loader = new GLTFLoader()
        try {
            for (const kind of ['deer', 'stag'] as Kind[]) {
                const gltf = await loader.loadAsync(`/models/animals/${kind}.glb`)
                // the file has every clip twice (with and without the armature's prefix)
                const clips = gltf.animations.filter((clip) => !clip.name.includes('|'))
                this.mergeMeshes(gltf.scene)
                this.sources[kind] = { scene: gltf.scene, clips }
            }
        }
        catch (error) {
            console.warn('[wildlife] animals unavailable', error)
        }
    }

    /**
     * The pack splits each animal into one mesh per flat colour (7 or 8 draws, in every
     * pass, shadows included). Bake each colour into the vertices, toned to a real deer's
     * coat, and merge them: one skinned mesh, one draw.
     */
    private mergeMeshes(scene: THREE.Object3D) {
        const coat: Record<string, string> = {
            Main: '#5e4430', Main_Dark: '#3d2c1e', Main_Light: '#a8957c', Hooves: '#2e2722',
            Material: '#5a4230', 'Material.010': '#3a2b1d', 'Material.003': '#a8957c', 'Material.001': '#5b4a36'
        }
        const meshes: THREE.SkinnedMesh[] = []
        scene.traverse((child) => { if ((child as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(child as THREE.SkinnedMesh) })
        if (meshes.length < 2)
            return
        const geometries = meshes.map((mesh) => {
            const material = mesh.material as THREE.MeshStandardMaterial
            const color = new THREE.Color(coat[material.name] ?? material.color)
            if (coat[material.name]) color.convertSRGBToLinear()
            const geometry = mesh.geometry.clone()
            const count = geometry.getAttribute('position').count
            const colors = new Float32Array(count * 3)
            for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3)
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
            for (const name of Object.keys(geometry.attributes))
                if (!['position', 'normal', 'color', 'skinIndex', 'skinWeight'].includes(name)) geometry.deleteAttribute(name)
            geometry.morphAttributes = {}
            return geometry
        })
        const merged = mergeGeometries(geometries)
        if (!merged)
            return
        const first = meshes[0]
        const mesh = new THREE.SkinnedMesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }))
        mesh.name = 'Body_merged'
        first.parent!.add(mesh)
        mesh.bind(first.skeleton, first.bindMatrix)
        for (const old of meshes)
            old.parent!.remove(old)
    }

    /** A spot for a herd: walkable, dry ground, out of the trees, preferring forest edges, out of view. */
    private findSpot() {
        const p = this.state.player.position.current
        const camera = this.view.camera.instance
        const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
        const normal = vec3.create()
        for (let attempt = 0; attempt < 24; attempt++) {
            const angle = Math.random() * Math.PI * 2
            const distance = SPAWN.near + Math.random() * (SPAWN.far - SPAWN.near)
            const x = p[0] + Math.cos(angle) * distance, z = p[2] + Math.sin(angle) * distance
            const ground = this.state.chunks.getElevationForPosition(x, z)
            if (typeof ground !== 'number' || ground < WATER_LEVEL + 1 || ground > 200)
                continue
            this.state.player.sampleGroundNormal(x, z, normal, 1.5)
            if (normal[1] < 0.88 || this.state.vegetation.isSolid(x, ground + 1, z, 2))
                continue
            const forest = this.state.vegetation.forestAt(x, z)
            if (forest > 0.85 && Math.random() < 0.7)
                continue
            const point = new THREE.Vector3(x, ground + 1, z)
            if (frustum.containsPoint(point) && Math.random() < 0.85)
                continue
            return point.setY(ground)
        }
        return null
    }

    private spawnHerd() {
        const spot = this.findSpot()
        if (!spot || !this.sources.deer)
            return
        const herd: Herd = { center: spot.clone(), animals: [], fleeing: 0 }
        const count = 2 + Math.floor(Math.random() * 4)
        for (let i = 0; i < count; i++) {
            const kind: Kind = i === 0 && this.sources.stag && Math.random() < 0.45 ? 'stag' : 'deer'
            const offset = new THREE.Vector3((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12)
            this.animals.push(this.create(kind, herd, spot.clone().add(offset)))
        }
        this.herds.push(herd)
    }

    private create(kind: Kind, herd: Herd, position: THREE.Vector3): Animal {
        const reused = this.pool[kind].pop()
        if (reused) {
            position.y = this.ground(position.x, position.z)
            Object.assign(reused, {
                herd, current: '', mood: 'graze', timer: Math.random() * 6, position, heading: Math.random() * Math.PI * 2,
                speed: 0, target: position.clone(), health: 2, fade: 0, pending: 0
            })
            reused.tilt.identity()
            reused.model.scale.setScalar(SCALE[kind] * (0.9 + Math.random() * 0.2))
            reused.root.position.copy(position)
            this.view.scene.add(reused.root)
            herd.animals.push(reused)
            this.play(reused, 'Eating', 0)
            reused.mixer.setTime(Math.random() * 3)
            return reused
        }
        const source = this.sources[kind]!
        const model = SkeletonUtils.clone(source.scene)
        model.scale.setScalar(SCALE[kind] * (0.9 + Math.random() * 0.2))
        model.traverse((child) => {
            const mesh = child as THREE.Mesh
            if (!mesh.isMesh) return
            mesh.frustumCulled = false
            this.view.shadows.addCaster(mesh, this.depthMaterial)
            mesh.userData.shadowNearOnly = true          // only the sharp cascade around the camera
        })
        const root = new THREE.Group()
        root.add(model)
        this.view.scene.add(root)
        const mixer = new THREE.AnimationMixer(model)
        const actions: Record<string, THREE.AnimationAction> = {}
        for (const clip of source.clips) {
            const action = mixer.clipAction(clip)
            if (['Death', 'Idle_HitReact_Left', 'Idle_HitReact_Right', 'Gallop_Jump'].includes(clip.name)) {
                action.setLoop(THREE.LoopOnce, 1)
                action.clampWhenFinished = true
            }
            actions[clip.name] = action
        }
        position.y = this.ground(position.x, position.z)
        const animal: Animal = {
            kind, herd, root, model, mixer, actions, current: '', mood: 'graze', timer: Math.random() * 6,
            position, heading: Math.random() * Math.PI * 2, speed: 0, target: position.clone(), health: 2, fade: 0,
            tilt: new THREE.Quaternion(), pending: 0, frame: Math.floor(Math.random() * 4)
        }
        herd.animals.push(animal)
        this.play(animal, 'Eating', 0)
        mixer.setTime(Math.random() * 3)
        return animal
    }

    private remove(animal: Animal) {
        this.view.scene.remove(animal.root)
        animal.mixer.stopAllAction()
        this.pool[animal.kind].push(animal)
        this.animals.splice(this.animals.indexOf(animal), 1)
        animal.herd.animals.splice(animal.herd.animals.indexOf(animal), 1)
        if (animal.herd.animals.length === 0)
            this.herds.splice(this.herds.indexOf(animal.herd), 1)
    }

    private ground(x: number, z: number) {
        return this.state.player.groundAt(x, z)
    }

    private play(animal: Animal, name: string, fade = 0.35, timeScale = 1) {
        const action = animal.actions[name]
        if (!action)
            return
        action.timeScale = timeScale
        if (animal.current === name)
            return
        const previous = animal.actions[animal.current]
        action.reset().setEffectiveWeight(1).play()
        if (previous && fade > 0)
            previous.crossFadeTo(action, fade, false)
        else if (previous)
            previous.stop()
        animal.current = name
    }

    /** How close something has to come before a deer runs (crouching gets you much closer). */
    private fleeDistance() {
        const player = this.state.player
        if (player.crouch > 0.5) return 9
        if (player.speed > player.walkSpeed + 1) return 38
        return 24
    }

    /** A weapon point (arrow head, blade) against the deer: the one struck, if any. */
    hit(point: THREE.Vector3, from: THREE.Vector3) {
        for (const animal of this.animals) {
            if (animal.mood === 'dead')
                continue
            const scale = animal.model.scale.x
            // body and neck as two spheres along its heading
            const forward = new THREE.Vector3(Math.sin(animal.heading), 0, Math.cos(animal.heading))
            const body = animal.position.clone().add(new THREE.Vector3(0, 2.4 * scale, 0))
            const neck = body.clone().addScaledVector(forward, 1.6 * scale).add(new THREE.Vector3(0, 0.9 * scale, 0))
            if (point.distanceTo(body) < 1.25 * scale || point.distanceTo(neck) < 0.8 * scale) {
                this.wound(animal, from)
                return animal
            }
        }
        return null
    }

    private wound(animal: Animal, from: THREE.Vector3) {
        animal.health--
        this.view.audio.play('hitWood', animal.position, 0.5)
        if (animal.health <= 0) {
            animal.mood = 'dead'
            animal.timer = 40
            animal.speed = 0
            this.play(animal, 'Death', 0.15)
        }
        else {
            const side = (from.x - animal.position.x) * Math.cos(animal.heading) - (from.z - animal.position.z) * Math.sin(animal.heading)
            animal.mood = 'hurt'
            animal.timer = 0.45
            this.play(animal, side > 0 ? 'Idle_HitReact_Left' : 'Idle_HitReact_Right', 0.1)
        }
        this.startle(animal.herd, from)
    }

    private startle(herd: Herd, from: THREE.Vector3) {
        if (herd.fleeing <= 0)
            this.view.audio.play('snort', herd.center)
        herd.fleeing = 9 + Math.random() * 4
        for (const animal of herd.animals) {
            if (animal.mood === 'dead' || animal.mood === 'hurt')
                continue
            animal.mood = 'flee'
            animal.timer = herd.fleeing
            const away = animal.position.clone().sub(from).setY(0).normalize()
            if (away.lengthSq() < 0.5) away.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize()
            // away, spread a little, toward open ground
            away.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.8)
            animal.target.copy(animal.position).addScaledVector(away, 90)
        }
    }

    update() {
        const dt = Math.min(this.state.time.delta, 0.05)
        if (!this.sources.deer)
            return
        const player = this.state.player
        const p = new THREE.Vector3(player.position.current[0], player.position.current[1], player.position.current[2])

        // keep a few herds around; let go of those far behind
        this.spawnTimer -= dt
        if (this.spawnTimer <= 0) {
            this.spawnTimer = 3
            for (const animal of [...this.animals])
                if (animal.position.distanceTo(p) > DESPAWN)
                    this.remove(animal)
            if (this.herds.length < HERDS)
                this.spawnHerd()
        }

        const flee = this.fleeDistance()
        for (const herd of this.herds) {
            herd.fleeing -= dt
            const alive = herd.animals.filter((animal) => animal.mood !== 'dead')
            if (alive.length)
                herd.center.copy(alive.reduce((sum, animal) => sum.add(animal.position), new THREE.Vector3()).divideScalar(alive.length))
            const distance = herd.center.distanceTo(p)
            if (herd.fleeing <= 0 && distance < flee)
                this.startle(herd, p)
            else if (herd.fleeing <= 0 && distance < flee * 1.8)
                for (const animal of alive)
                    if (animal.mood === 'graze' || animal.mood === 'idle' || animal.mood === 'walk') {
                        animal.mood = 'alert'
                        animal.timer = 2 + Math.random() * 2
                    }
        }

        for (const animal of [...this.animals])
            this.updateAnimal(animal, dt, p)
        this.collide()
    }

    /**
     * The player can't walk through a deer: each body is a capsule along its spine (rump to
     * chest, about a metre and a half), and the player is pushed out of it.
     */
    private collide() {
        const player = this.state.player
        const p = player.position.current
        for (const animal of this.animals) {
            const scale = animal.model.scale.x / SCALE[animal.kind]
            const forward = new THREE.Vector3(Math.sin(animal.heading), 0, Math.cos(animal.heading))
            const rump = animal.position.clone().addScaledVector(forward, - 0.55 * scale)
            const chest = animal.position.clone().addScaledVector(forward, 0.55 * scale)
            // standing on it, or far above (a jump over a lying deer) doesn't collide
            if (p[1] > animal.position.y + (animal.mood === 'dead' ? 0.45 : 1.25) * scale)
                continue
            // nearest point on the spine
            const segment = chest.clone().sub(rump)
            const t = THREE.MathUtils.clamp(((p[0] - rump.x) * segment.x + (p[2] - rump.z) * segment.z) / segment.lengthSq(), 0, 1)
            const nx = rump.x + segment.x * t, nz = rump.z + segment.z * t
            const dx = p[0] - nx, dz = p[2] - nz
            const distance = Math.hypot(dx, dz)
            const minimum = (animal.mood === 'dead' ? 0.3 : 0.38) * scale + 0.32
            if (distance < minimum && distance > 1e-4) {
                p[0] = nx + dx / distance * minimum
                p[2] = nz + dz / distance * minimum
                // what was carrying the player into it stops
                const along = (player.velocity[0] * dx + player.velocity[2] * dz) / distance
                if (along < 0) {
                    player.velocity[0] -= along * dx / distance
                    player.velocity[2] -= along * dz / distance
                }
            }
        }
    }

    private updateAnimal(animal: Animal, dt: number, player: THREE.Vector3) {
        const distance = animal.position.distanceTo(player)
        animal.timer -= dt
        let wantSpeed = 0

        switch (animal.mood) {
            case 'graze':
                this.play(animal, Math.sin(animal.timer * 0.7) > - 0.4 ? 'Eating' : 'Idle_Headlow')
                if (animal.timer <= 0) this.nextCalm(animal)
                break
            case 'idle':
                this.play(animal, animal.timer % 8 > 4 ? 'Idle' : 'Idle_2')
                if (animal.timer <= 0) this.nextCalm(animal)
                break
            case 'walk': {
                this.play(animal, 'Walk', 0.4, 1)
                wantSpeed = WALK_SPEED
                if (animal.position.distanceTo(animal.target) < 1 || animal.timer <= 0) this.nextCalm(animal)
                break
            }
            case 'alert': {
                // head up, turned toward the disturbance
                this.play(animal, 'Idle', 0.25)
                const toward = Math.atan2(player.x - animal.position.x, player.z - animal.position.z)
                animal.heading += Math.atan2(Math.sin(toward - animal.heading), Math.cos(toward - animal.heading)) * Math.min(1, dt * 2)
                if (animal.timer <= 0) this.nextCalm(animal)
                break
            }
            case 'flee': {
                const leaping = animal.current === 'Gallop_Jump' && animal.actions.Gallop_Jump.time < animal.actions.Gallop_Jump.getClip().duration - 0.05
                if (!leaping)
                    this.play(animal, Math.random() < dt * 0.25 ? 'Gallop_Jump' : 'Gallop', 0.2, 1.15)
                wantSpeed = FLEE_SPEED
                if (animal.timer <= 0 && distance > 50) {
                    animal.mood = 'alert'
                    animal.timer = 3
                }
                break
            }
            case 'hurt':
                if (animal.timer <= 0) {
                    animal.mood = 'flee'
                    animal.timer = animal.herd.fleeing
                }
                break
            case 'dead':
                // lies where it fell, then sinks out of sight
                if (animal.timer < 3) {
                    animal.fade += dt / 3
                    animal.root.position.y -= dt * 0.4
                }
                if (animal.timer <= 0) {
                    this.remove(animal)
                    return
                }
                break
        }

        // steer toward the target, keep apart from the others, avoid trunks and water
        if (wantSpeed > 0) {
            const to = animal.target.clone().sub(animal.position).setY(0)
            for (const other of animal.herd.animals) {
                if (other === animal) continue
                const apart = animal.position.clone().sub(other.position).setY(0)
                const d = apart.length()
                if (d < 2.5 && d > 1e-3) to.addScaledVector(apart.normalize(), (2.5 - d) * 6)
            }
            const ahead = animal.position.clone().add(new THREE.Vector3(Math.sin(animal.heading), 0, Math.cos(animal.heading)).multiplyScalar(3))
            const groundAhead = this.ground(ahead.x, ahead.z)
            if (groundAhead < WATER_LEVEL + 0.3 || this.state.vegetation.isSolid(ahead.x, groundAhead + 1, ahead.z, 0.6))
                to.applyAxisAngle(new THREE.Vector3(0, 1, 0), 1.2)
            const wanted = Math.atan2(to.x, to.z)
            const turn = Math.atan2(Math.sin(wanted - animal.heading), Math.cos(wanted - animal.heading))
            animal.heading += THREE.MathUtils.clamp(turn, - dt * 3, dt * 3)
        }
        animal.speed += (wantSpeed - animal.speed) * (1 - Math.exp(- dt * (wantSpeed > animal.speed ? 3 : 4)))
        animal.position.x += Math.sin(animal.heading) * animal.speed * dt
        animal.position.z += Math.cos(animal.heading) * animal.speed * dt
        animal.position.y = this.ground(animal.position.x, animal.position.z)
        // the trunks
        const pushed = vec3.fromValues(animal.position.x, animal.position.y, animal.position.z)
        this.state.vegetation.resolveCollision(pushed, 0.5)
        animal.position.set(pushed[0], pushed[1], pushed[2])

        // the body leans with the slope
        const normal = vec3.create()
        this.state.player.sampleGroundNormal(animal.position.x, animal.position.z, normal, 0.9)
        const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(normal[0], normal[1], normal[2]))
        animal.tilt.slerp(tilt, 1 - Math.exp(- dt * 5))
        if (animal.mood !== 'dead' || animal.timer > 3)
            animal.root.position.copy(animal.position)
        animal.root.quaternion.copy(animal.tilt).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), animal.heading))

        // animate only near the player (far ones hold still: a dot at that distance), and the
        // farther ones less often (every 2nd frame past 40 m, every 4th past 90), each catching
        // up on the time it skipped
        animal.root.visible = distance < 260
        if (distance < 160) {
            animal.pending += dt
            animal.frame++
            const every = distance < 40 ? 1 : distance < 90 ? 2 : 4
            if (animal.frame % every === 0) {
                animal.mixer.update(animal.pending)
                animal.pending = 0
            }
        }
    }

    /** What a calm deer does next: graze, look about, or walk a little after the herd. */
    private nextCalm(animal: Animal) {
        const roll = Math.random()
        if (roll < 0.5) {
            animal.mood = 'graze'
            animal.timer = 4 + Math.random() * 8
        }
        else if (roll < 0.7) {
            animal.mood = 'idle'
            animal.timer = 2 + Math.random() * 4
        }
        else {
            animal.mood = 'walk'
            animal.timer = 8
            const center = animal.herd.center
            animal.target.set(center.x + (Math.random() - 0.5) * 16, 0, center.z + (Math.random() - 0.5) * 16)
        }
    }
}
