import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import Game from '../Game'
import View from './View'
import State from '../State/State'
import PlayerState from '../State/Player'
import Settings, { CharacterName } from '../Settings'
import { WATER_LEVEL } from '../Workers/TerrainShape'
import { SHADOW_UNIFORMS } from './Shadows'
import sunShadowShader from './Materials/shaders/partials/getSunShadow.glsl'
import CharacterPose from './CharacterPose'

// the packs' hair is a neutral grey meant to be tinted: each character's colour
const HAIR_COLORS: Record<CharacterName, string> = {
    male_ranger: '#5a3d2b',          // dark brown
    female_ranger: '#7b4529',        // chestnut
    male_peasant: '#8c6a43',         // sandy
    female_peasant: '#3a2820'        // near black
}

const ZERO = new THREE.Vector3()

const LOCOMOTION = ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'] as const
// performed on top of the gait (Tools): holding and using a tool, from the animation libraries
export const PERFORMANCES = ['Sword_Idle', 'Sword_Attack', 'Idle_Torch_Loop', 'Sword_Regular_A', 'Sword_Regular_A_Rec', 'Sword_Regular_B',
    'Sword_Regular_B_Rec', 'Sword_Regular_C', 'Sword_Regular_Combo', 'Sword_Heavy_Combo', 'Sword_Dash', 'Sword_Block', 'TreeChopping_Loop',
    'Farm_Harvest', 'Farm_PlantSeed', 'Farm_Watering', 'Idle_Lantern_Loop', 'ClimbUp_1m'] as const
export type PerformanceName = typeof PERFORMANCES[number]
/** A clip played on top of the gait: at this time, this strong; `whole` how much of the body (legs too) it takes when standing still. */
export type Performance = { clip: PerformanceName, time: number, weight: number, whole: number }
// the legs and hips: a performance leaves them to the gait while the body moves
const LOWER = new Set(['root', 'pelvis', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'])
const ONE_SHOTS = ['Jump_Start', 'Jump_Land', 'Roll']

type Gait = { clip: string, speed: number, duration: number, offset: number }

/**
 * The player character: Quaternius' Universal Base Characters dressed in the Fantasy
 * outfits, animated with the Universal Animation Library (all CC0; built by
 * tools/characters/build.mjs).
 *
 * Animation follows the physics state:
 *  - walk, jog and sprint are blended by ground speed and kept in step (one shared cycle
 *    phase), each played at the rate that matches its stride to the actual speed; the
 *    natural speed and the foot-down moment of every gait are measured from the clips
 *    when a character loads, so the feet don't slide
 *  - jumps play take-off, airborne loop and landing; a hard landing at speed rolls
 *  - in deep water the character swims (forward stroke / treading water) with its head
 *    held just above the surface
 */
export default class Player {
    game: Game
    view: View
    state: State
    settings: Settings
    scene: THREE.Scene
    group: THREE.Group
    model: THREE.Object3D | null = null
    mixer: THREE.AnimationMixer | null = null
    actions: Record<string, THREE.AnimationAction> = {}
    current = ''                       // dominant clip (debugging / tests)
    shadow!: THREE.Mesh
    hemisphere!: THREE.HemisphereLight
    sun!: THREE.DirectionalLight
    private depthMaterial = new THREE.MeshDepthMaterial()      // the character's shadow

    private loader = new GLTFLoader()
    private clips: Record<string, THREE.AnimationClip> = {}
    private mannequinPelvisHeight = 0.9167
    private gaits: Gait[] = []
    private swimHeadHeight = { Swim_Idle_Loop: 1.5, Swim_Fwd_Loop: 0.5 }
    private weights: Record<string, number> = {}
    private targets: Record<string, number> = {}
    private phase = 0
    private oneShot: string | null = null
    private previousState = PlayerState.STATE_IDLE
    private wasGrounded = true
    private airTime = 0
    private fallSpeed = 0
    private swimOffset = 0
    private pose: CharacterPose | null = null
    private slideAmount = 0
    private strideDirection = 1                 // 1 walking forward, -1 backing away
    private strideYaw = 0                       // radians: the hips turned toward a side-step
    private leanPitch = 0                       // radians forward into the acceleration
    private leanBank = 0                        // radians into a turn
    private lookDirection = new THREE.Vector3()
    performances: Performance[] = []            // set by the tools each frame
    private layers = new Map<string, { whole: THREE.AnimationAction, upper: THREE.AnimationAction, duration: number }>()
    private diveAmount = 0
    private divePitch = 0
    private climbAmount = 0
    private footIK = 0
    private climbNormal = new THREE.Vector3(0, 0, 1)
    private groundNormal = new THREE.Vector3(0, 1, 0)
    private groundSampler = (x: number, z: number) => this.state.player.groundAt(x, z)
    modelYaw = 0                        // the model may be turned to face the way it walks
    private boneCache = new Map<string, THREE.Object3D | undefined>()
    private restFrames = new Map<string, THREE.Quaternion>()
    private loadId = 0
    // wet clothes and skin (State/Player wetness), shared by all the character's materials
    private wetUniforms = { uWetLine: { value: - 1e5 }, uWetness: { value: 0 } }

    constructor() {
        this.game = Game.getInstance()
        this.state = State.getInstance()
        this.view = View.getInstance()
        this.settings = Settings.getInstance()
        this.scene = this.view.scene

        this.group = new THREE.Group()
        this.scene.add(this.group)

        this.setLights()
        this.setShadow()
        this.load()

        this.settings.events.on('change:character', (name: CharacterName) => this.loadCharacter(name))
        // the Ranger's hood: G, or the menu
        this.settings.events.on('change:hood', () => this.applyHood())
        const controls = this.state.controls
        controls.events.on('hoodDown', () => {
            if (!controls.keys.down.hood && this.settings.get('character').includes('ranger'))      // not on key repeat
                this.settings.set('hood', !this.settings.get('hood'))
        })
    }

    setLights() {
        // the world uses custom shaders: these lights only light the character, matched to the
        // world's light model (getTerrainLight.glsl) every frame
        this.hemisphere = new THREE.HemisphereLight('#c4dcff', '#5d6b3a', Math.PI)
        this.scene.add(this.hemisphere)
        this.sun = new THREE.DirectionalLight('#fff3df', 2.6)
        this.scene.add(this.sun)
        this.scene.add(this.sun.target)
    }

    private async load() {
        try {
            const animations = await this.loader.loadAsync('/models/characters/animations.glb')
            for (const clip of animations.animations)
                this.clips[clip.name] = clip
            const pelvis = animations.scene.getObjectByName('pelvis')
            if (pelvis)
                this.mannequinPelvisHeight = pelvis.position.z
            await this.loadCharacter(this.settings.get('character'))
        }
        catch (error) {
            console.error('[player] could not load the character', error)
        }
    }

    async loadCharacter(name: CharacterName) {
        const id = ++this.loadId
        const gltf = await this.loader.loadAsync(`/models/characters/${name}.glb`)
        if (id !== this.loadId)
            return      // another character was picked meanwhile

        this.disposeModel()

        const model = gltf.scene
        model.traverse((child) => {
            const mesh = child as THREE.Mesh
            if (!mesh.isMesh)
                return
            mesh.frustumCulled = false     // skinned bounds don't follow the animation
            const material = mesh.material as THREE.MeshStandardMaterial
            material.metalness = Math.min(material.metalness, 0.4)     // no reflections to show: bare metal reads black and glints
            if (/hair/i.test(material.name))
                material.color.set(HAIR_COLORS[name])
            material.onBeforeCompile = (shader) => this.addUnderwaterTint(shader)
            this.view.shadows.addCaster(mesh, this.depthMaterial)
        })
        this.group.add(model)
        this.model = model
        this.pose = new CharacterPose(model)
        this.pose.onPlant = (limb, at, gear) => this.view.tools?.climbPlant(limb, at, gear)
        this.boneCache.clear()
        // each bone's turn in the bind pose, relative to the body: gear hung on a bone is placed
        // in the body's axes (x left, y up, z forward) as the bone carries them
        model.updateMatrixWorld(true)
        const bodyInverse = model.getWorldQuaternion(new THREE.Quaternion()).invert()
        this.restFrames.clear()
        for (const name of ['pelvis', 'spine_03'])
            this.restFrames.set(name, bodyInverse.clone().multiply(model.getObjectByName(name)!.getWorldQuaternion(new THREE.Quaternion())).invert())

        // Clips were made on the mannequin; only rotations and the pelvis translation are
        // kept, the pelvis scaled to this body's hip height
        this.mixer = new THREE.AnimationMixer(model)
        const pelvis = model.getObjectByName('pelvis')
        const ratio = pelvis ? pelvis.position.z / this.mannequinPelvisHeight : 1
        this.actions = {}
        this.layers.clear()
        for (const [clipName, source] of Object.entries(this.clips)) {
            const clip = source.clone()
            for (const track of clip.tracks)
                if (track.name === 'pelvis.position')
                    for (let i = 0; i < track.values.length; i++)
                        track.values[i] *= ratio
            if ((PERFORMANCES as readonly string[]).includes(clipName)) {
                // performed: the whole clip (standing still) and its upper body alone (moving)
                const upper = new THREE.AnimationClip(`${clipName}:upper`, clip.duration, clip.tracks.filter((track) => !LOWER.has(track.name.split('.')[0])))
                const make = (c: THREE.AnimationClip) => {
                    const action = this.mixer!.clipAction(c)
                    action.setEffectiveWeight(0).play()
                    action.timeScale = 0
                    return action
                }
                this.layers.set(clipName, { whole: make(clip), upper: make(upper), duration: clip.duration })
                continue
            }
            const action = this.mixer.clipAction(clip)
            if (ONE_SHOTS.includes(clipName)) {
                action.setLoop(THREE.LoopOnce, 1)
                action.clampWhenFinished = true
            }
            this.actions[clipName] = action
        }

        this.calibrate(model)
        this.modelYaw = model.rotation.y
        this.applyHood()

        for (const [clipName, action] of Object.entries(this.actions)) {
            this.weights[clipName] = clipName === 'Idle_Loop' ? 1 : 0
            action.setEffectiveWeight(this.weights[clipName])
            if (!ONE_SHOTS.includes(clipName))
                action.play()
        }
        for (const gait of this.gaits)
            this.actions[gait.clip].timeScale = 0       // driven by the shared phase
        for (const layer of this.layers.values())       // (calibrating stopped them)
            for (const action of [layer.upper, layer.whole]) {
                action.setEffectiveWeight(0).play()
                action.timeScale = 0
            }
        this.oneShot = null
    }

    /** The Ranger's hood up (the hair tucked under it) or down. */
    private applyHood() {
        if (!this.model)
            return
        const up = this.settings.get('hood')
        this.model.traverse((child) => {
            if (/_Hood$/.test(child.name))
                child.visible = up
        })
    }

    /**
     * Measure each gait on this body: its natural ground speed (how fast the planted foot
     * moves backward), the moment the left foot is down (so blended gaits stay in step) and
     * which way the character faces; and where the head is in the swimming poses.
     */
    private calibrate(model: THREE.Object3D) {
        const mixer = this.mixer!
        const foot = model.getObjectByName('ball_l') || model.getObjectByName('foot_l')!
        const head = model.getObjectByName('Head')!
        const position = new THREE.Vector3()
        const sample = (action: THREE.AnimationAction, time: number, bone: THREE.Object3D) => {
            action.time = time
            mixer.update(0)
            model.updateMatrixWorld(true)
            return model.worldToLocal(bone.getWorldPosition(position)).clone()
        }
        const solo = (clipName: string) => {
            mixer.stopAllAction()
            const action = this.actions[clipName]
            action.reset().setEffectiveWeight(1).play()
            action.timeScale = 0
            return action
        }

        model.rotation.y = 0
        model.position.set(0, 0, 0)
        let facing = 0
        this.gaits = []
        for (const clipName of LOCOMOTION) {
            const action = solo(clipName)
            const duration = action.getClip().duration
            const steps = 96
            const dt = duration / steps
            const points = Array.from({ length: steps + 1 }, (_, i) => sample(action, i * dt, foot))
            const minY = Math.min(...points.map(p => p.y))
            // while the ball of the foot is on the ground (within 3 cm of its lowest point) it
            // slides backward at the ground speed the clip was animated for
            const velocities: number[] = []
            let lowest = 0
            for (let i = 0; i < steps; i++) {
                if (points[i].y < points[lowest].y)
                    lowest = i
                if (points[i].y < minY + 0.03 && points[i + 1].y < minY + 0.03)
                    velocities.push((points[i + 1].z - points[i].z) / dt)
            }
            velocities.sort((x, y) => x - y)
            const median = velocities[Math.floor(velocities.length / 2)] || - 1
            facing += - Math.sign(median)      // the planted foot slides opposite to the facing
            this.gaits.push({ clip: clipName, speed: Math.abs(median), duration, offset: lowest / steps })
        }
        for (const clipName of ['Swim_Idle_Loop', 'Swim_Fwd_Loop'] as const) {
            const action = solo(clipName)
            const duration = action.getClip().duration
            let sum = 0
            for (let i = 0; i < 12; i++)
                sum += sample(action, duration * i / 12, head).y
            this.swimHeadHeight[clipName] = sum / 12
        }
        mixer.stopAllAction()

        // the player moves toward its local -Z
        model.rotation.y = facing >= 0 ? Math.PI : 0
        if (import.meta.env.DEV)
            console.info('[player] gaits', this.gaits.map(g => `${g.clip} ${g.speed.toFixed(2)} m/s`).join(', '),
                '| faces', facing >= 0 ? '+Z' : '-Z', '| swim head', JSON.stringify(this.swimHeadHeight))
    }

    private disposeModel() {
        if (!this.model)
            return
        this.mixer?.stopAllAction()
        this.group.remove(this.model)
        this.model.traverse((child) => {
            const mesh = child as THREE.Mesh
            if (!mesh.isMesh)
                return
            mesh.geometry.dispose()
            const material = mesh.material as THREE.MeshStandardMaterial
            for (const texture of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap])
                texture?.dispose()
            material.dispose()
        })
        this.model = null
        this.mixer = null
    }

    /**
     * Below the water surface light is absorbed like it is on the lake bed (terrain shader),
     * so the submerged body reads as underwater instead of drawn on top of the lake. Above
     * it, whatever got wet is darker and glossy until it dries.
     */
    private addUnderwaterTint(shader: THREE.WebGLProgramParametersWithUniforms) {
        shader.uniforms.uWaterLevel = { value: WATER_LEVEL }
        for (const name of SHADOW_UNIFORMS)
            shader.uniforms[name] = this.view.shadows.uniforms[name]
        shader.uniforms.uSunDirection = this.view.sky.uniforms.uSunPosition
        shader.uniforms.uWetLine = this.wetUniforms.uWetLine
        shader.uniforms.uWetness = this.wetUniforms.uWetness
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorldPosition;')
            .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWaterWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;')
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uWaterLevel;\nuniform float uWetLine;\nuniform float uWetness;\nuniform vec3 uSunDirection;\nvarying vec3 vWaterWorldPosition;\n' + sunShadowShader)
            // the world's sun shadows (trees, rocks, the terrain) fall on the character too
            .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
                'getDirectionalLightInfo( directionalLight, directLight );',
                'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= getSunShadow( vWaterWorldPosition, inverseTransformDirection( geometryNormal, viewMatrix ), normalize( uSunDirection ) );'))
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                // the kit's skin and cloth are glossier than real skin and fabric: a waxy sheen
                // in strong sun
                roughnessFactor = max(roughnessFactor, 0.82);
                // wet: darker (water fills the weave and pores) and glossy, soft at the wet line
                float wet = uWetness * (1.0 - smoothstep(uWetLine - 0.06, uWetLine + 0.02, vWaterWorldPosition.y));
                diffuseColor.rgb *= mix(1.0, 0.55, wet);
                roughnessFactor = mix(roughnessFactor, 0.16, wet);`)
            .replace('#include <colorspace_fragment>', `#include <colorspace_fragment>
                float waterDepth = uWaterLevel - vWaterWorldPosition.y;
                if (waterDepth > 0.0) {
                    vec3 toEye = normalize(cameraPosition - vWaterWorldPosition);
                    float path = waterDepth * (1.0 + min(3.0, 1.0 / max(0.05, toEye.y)));
                    vec3 transmittance = exp(- path * vec3(0.62, 0.30, 0.24) * 2.2);     // linear light
                    gl_FragColor.rgb = gl_FragColor.rgb * transmittance + vec3(0.0015, 0.006, 0.007) * (1.0 - transmittance);
                }`)
    }

    setShadow() {
        // soft blob shadow on the ground under the feet
        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: { uOpacity: { value: 0.45 } },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `uniform float uOpacity; varying vec2 vUv;
                void main() { float d = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(0.003, 0.005, 0.0015, (1.0 - smoothstep(0.15, 1.0, d)) * uOpacity); }`
        })
        this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), material)
        this.shadow.geometry.rotateX(- Math.PI * 0.5)
        this.shadow.renderOrder = 1
        this.scene.add(this.shadow)
    }


    /** The walk cycle (0..1, shared by the gaits) and how much the character is walking (0..1). */
    get gait() {
        return { phase: this.phase, moving: THREE.MathUtils.smoothstep(this.state.player.speed, 0.3, 1.5) * (this.state.player.grounded ? 1 : 0) }
    }

    /** How long a performance clip is (seconds). */
    duration(clip: PerformanceName) {
        return this.layers.get(clip)?.duration ?? 1
    }

    /**
     * The performances (Tools) on top of the gait: each clip at its time, over the upper body
     * as the body moves, over all of it standing still (a stance for a stroke). The mixer
     * averages what drives each bone by weight, so a performance at strength f gets the
     * weight f / (1 - f): the gait's share of those bones goes to 1 - f.
     */
    private perform(speed: number) {
        for (const layer of this.layers.values()) {
            layer.upper.setEffectiveWeight(0)
            layer.whole.setEffectiveWeight(0)
        }
        const total = Math.min(0.985, this.performances.reduce((sum, p) => sum + Math.max(0, p.weight), 0))
        if (total <= 0.001)
            return
        const heavy = total / (1 - total)
        const moving = THREE.MathUtils.smoothstep(speed, 0.3, 1.2)
        for (const p of this.performances) {
            const layer = this.layers.get(p.clip)
            if (!layer || p.weight <= 0)
                continue
            const share = heavy * p.weight / total
            const whole = THREE.MathUtils.clamp(p.whole, 0, 1) * (1 - moving)
            layer.upper.time = layer.whole.time = THREE.MathUtils.clamp(p.time, 0, layer.duration)
            layer.upper.setEffectiveWeight(share * (1 - whole))
            layer.whole.setEffectiveWeight(share * whole)
        }
    }

    /** Where the follow camera looks (not a free camera's view): the way the eyes go with a tool in hand. */
    private gaze() {
        const camera = this.state.player.camera.thirdPerson
        const pitch = THREE.MathUtils.clamp((camera.phi - Math.PI / 2) * 0.6, - 0.5, 0.4)
        return this.lookDirection.set(- Math.sin(camera.theta) * Math.cos(pitch), Math.sin(pitch), - Math.cos(camera.theta) * Math.cos(pitch))
    }

    /** How far the clip has moved the chest from its rest (held tools move with it). */
    get chestShift() {
        return this.pose ? this.pose.chestShift : ZERO
    }

    /**
     * A bone's frame in the body's axes (x left, y up, z forward): where the bone is, turned
     * as it is now relative to the bind pose. Gear worn on it (Tools) is placed in it.
     */
    boneFrame(name: string) {
        const bone = this.bone(name), rest = this.restFrames.get(name)
        if (!bone || !rest)
            return null
        bone.updateWorldMatrix(true, false)
        return {
            position: new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld),
            quaternion: bone.getWorldQuaternion(new THREE.Quaternion()).multiply(rest)
        }
    }

    /** A bone of the current model (tools hold on to the hands). */
    bone(name: string) {
        if (!this.model)
            return undefined
        if (!this.boneCache.has(name))
            this.boneCache.set(name, this.model.getObjectByName(name))
        return this.boneCache.get(name)
    }

    private startOneShot(name: string, from = 0, timeScale = 1) {
        const action = this.actions[name]
        if (!action)
            return
        action.reset()
        action.time = action.getClip().duration * from
        action.timeScale = timeScale
        action.play()
        this.oneShot = name
    }

    /**
     * Idle / walk / jog / run weights for this speed, each gait in its own band (a short
     * cross-fade between them, not a long blend of two strides), played at the rate that
     * matches its stride to the speed; advances the shared cycle phase.
     */
    private locomotion(speed: number, dt: number) {
        const [walk, jog, run] = this.gaits
        const toJog = THREE.MathUtils.smoothstep(speed, 1.7, 2.9)
        const toRun = THREE.MathUtils.smoothstep(speed, 6.0, 7.3)
        const weights = [(1 - toJog), toJog * (1 - toRun), toJog * toRun]
        // the shared cycle: each gait's rate (its stride matched to the speed), weighted
        let advance = 0
        ;[walk, jog, run].forEach((gait, i) => {
            const rate = THREE.MathUtils.clamp(speed / gait.speed, 0.6, 1.45)
            advance += weights[i] * rate / gait.duration
        })
        this.phase = (this.phase + this.strideDirection * advance * dt + 1) % 1

        const moving = THREE.MathUtils.smoothstep(speed, 0.15, 0.7)
        this.targets.Idle_Loop = 1 - moving
        ;[walk, jog, run].forEach((gait, i) => {
            this.targets[gait.clip] = (this.targets[gait.clip] || 0) + weights[i] * moving
        })
        for (const gait of this.gaits)
            this.actions[gait.clip].time = ((this.phase + gait.offset) % 1) * gait.duration
    }

    /**
     * How the body leans: into the acceleration (forward getting going, back braking) and
     * into a turn (toward its centre, the faster the more), as a runner does from the ankles.
     */
    private updateLean(dt: number) {
        const player = this.state.player
        const g = 9.8
        const footing = player.grounded && !player.swimming && !player.sliding && !player.climbing ? 1 : 0
        const pitch = THREE.MathUtils.clamp(Math.atan2(player.acceleration.forward, g) * 0.9, - 0.22, 0.2) * footing
        const bank = THREE.MathUtils.clamp(Math.atan2(player.acceleration.right, g) * 0.85, - 0.3, 0.3) * footing
        const k = 1 - Math.exp(- dt * 10)
        this.leanPitch += (pitch - this.leanPitch) * k
        this.leanBank += (bank - this.leanBank) * k
    }

    /**
     * Which way the body moves relative to where it faces: forward or backward (the walk
     * cycle runs in reverse) and how far the hips turn toward a sideways step, the chest
     * staying ahead (CharacterPose). Only in the stance with a tool, when facing and moving
     * can differ; otherwise the body turns to the way it goes.
     */
    private updateStride(dt: number) {
        const player = this.state.player
        const v = player.velocity
        const speed = Math.hypot(v[0], v[2])
        let direction = 1, yaw = 0
        if (player.stance && speed > 0.4) {
            const forward = - (v[0] * Math.sin(player.rotation) + v[2] * Math.cos(player.rotation)) / speed
            const right = (v[0] * Math.cos(player.rotation) - v[2] * Math.sin(player.rotation)) / speed
            const angle = Math.atan2(right, forward)           // 0 ahead, + to the right
            if (Math.abs(angle) > Math.PI * 0.58) {
                direction = - 1
                yaw = Math.atan2(Math.sin(angle - Math.PI), Math.cos(angle - Math.PI))
            }
            else
                yaw = angle
            yaw = THREE.MathUtils.clamp(yaw, - 1.15, 1.15)
        }
        if (direction !== this.strideDirection && speed > 0.4)
            this.strideDirection = direction
        this.strideYaw += (yaw - this.strideYaw) * (1 - Math.exp(- dt * 9))
    }

    private updateAnimation(dt: number) {
        const player = this.state.player
        const speed = player.speed
        this.updateStride(dt)
        this.updateLean(dt)
        const state = player.movementState
        const swimming = state === PlayerState.STATE_SWIM || state === PlayerState.STATE_DIVE
        const climbing = player.climbing || player.mantle !== null

        for (const name in this.actions)
            this.targets[name] = 0

        // ── events ──
        if (!player.grounded && !swimming && !climbing) {
            this.airTime += dt
            this.fallSpeed = Math.max(this.fallSpeed, - player.velocity[1])
        }
        if (state === PlayerState.STATE_JUMP && this.previousState !== PlayerState.STATE_JUMP)
            this.startOneShot('Jump_Start', 0.22, 1.3)     // skip the wind-up: the physics already left the ground
        if ((player.grounded || swimming || climbing) && !this.wasGrounded) {
            if (swimming || climbing)
                this.oneShot = null
            else if (this.fallSpeed > 13 && speed > 3)
                this.startOneShot('Roll', 0.05, 1.25)
            else if (this.airTime > 0.45 && speed < 1.5)
                this.startOneShot('Jump_Land', 0.1, 1.2)
            else
                this.oneShot = null
            this.airTime = 0
            this.fallSpeed = 0
        }
        this.wasGrounded = player.grounded || swimming || climbing
        this.previousState = state

        // ── one-shot clips until they end or get interrupted ──
        if (this.oneShot) {
            const action = this.actions[this.oneShot]
            const finished = action.time >= action.getClip().duration - 0.02
            const interrupted =
                (this.oneShot === 'Jump_Start' && (player.velocity[1] < 1 || player.grounded)) ||
                (this.oneShot === 'Jump_Land' && speed > 1.5) ||
                swimming || climbing
            if (finished || interrupted)
                this.oneShot = null
            else
                this.targets[this.oneShot] = 1
        }

        if (!this.oneShot) {
            if (climbing) {
                this.targets.Idle_Loop = 1         // the climbing pose is procedural (CharacterPose)
            }
            else if (swimming) {
                const moving = THREE.MathUtils.smoothstep(speed, 0.3, 1.0)
                this.targets.Swim_Idle_Loop = 1 - moving
                this.targets.Swim_Fwd_Loop = moving
                this.actions.Swim_Fwd_Loop.timeScale = THREE.MathUtils.clamp(speed / 1.6, 0.6, 1.7)
            }
            else if (!player.grounded && (state === PlayerState.STATE_JUMP || this.airTime > 0.18)) {
                this.targets.Jump_Loop = 1
            }
            else if (player.sliding) {
                this.targets.Idle_Loop = 1         // the slide pose is procedural (CharacterPose)
            }
            else {
                this.locomotion(speed, dt)
            }
        }

        // ── blend toward the targets ──
        const k = 1 - Math.exp(- dt * 11)
        let strongest = 0
        for (const name in this.actions) {
            const target = this.targets[name] || 0
            this.weights[name] += (target - this.weights[name]) * (target > this.weights[name] && ONE_SHOTS.includes(name) ? Math.min(1, k * 1.8) : k)
            this.actions[name].setEffectiveWeight(this.weights[name])
            if (this.weights[name] > strongest) {
                strongest = this.weights[name]
                this.current = name
            }
        }
        this.perform(player.speed)
        this.mixer!.update(dt)

        // ── swimming: hold the head just above the surface (diving: the body around the chest) ──
        let offset = 0
        if (swimming) {
            const wIdle = this.weights.Swim_Idle_Loop, wFwd = this.weights.Swim_Fwd_Loop
            const head = (wIdle * this.swimHeadHeight.Swim_Idle_Loop + wFwd * this.swimHeadHeight.Swim_Fwd_Loop) / Math.max(1e-3, wIdle + wFwd)
            offset = player.diving ? 0.8 - head : WATER_LEVEL + 0.12 - player.position.current[1] - head
        }
        this.swimOffset += (offset - this.swimOffset) * (1 - Math.exp(- dt * 4))
        this.model!.position.set(0, this.swimOffset, 0)
        this.model!.rotation.set(0, this.modelYaw, 0)

        // ── procedural poses over the clips: crouch, slide, dive ──
        const k2 = 1 - Math.exp(- dt * 9)
        this.slideAmount += ((player.sliding ? 1 : 0) - this.slideAmount) * k2
        this.diveAmount += ((player.diving ? 1 : 0) - this.diveAmount) * (1 - Math.exp(- dt * 4))
        const vertical = player.velocity[1], forwardSpeed = player.speed
        // descending tips the head down, rising up; swimming along levels out
        const pitchTarget = THREE.MathUtils.clamp(- Math.atan2(vertical, Math.max(0.6, forwardSpeed)) * 0.9, - 0.9, 1.1)
        this.divePitch += (pitchTarget - this.divePitch) * (1 - Math.exp(- dt * 3))
        this.climbAmount += ((player.climbing ? 1 : 0) - this.climbAmount) * (1 - Math.exp(- dt * 10))
        const n = player.climbNormal
        this.climbNormal.set(n[0], n[1], n[2])
        const g = player.groundNormal
        this.groundNormal.lerp(new THREE.Vector3(g[0], g[1], g[2]), 1 - Math.exp(- dt * 8)).normalize()
        // feet on the terrain while standing and walking (not in the air, the water or a slide)
        const footing = player.grounded && !swimming && !player.sliding && !climbing ? 1 : 0
        this.footIK += (footing - this.footIK) * (1 - Math.exp(- dt * 12))
        const mantle = player.mantle ? Math.min(1, player.mantle.time / player.mantle.duration) : 0
        this.pose?.apply(this.model!, this.group, {
            crouch: player.crouch * (1 - this.slideAmount),
            slide: this.slideAmount,
            dive: this.diveAmount,
            divePitch: this.divePitch,
            ground: this.groundSampler,
            groundNormal: this.groundNormal,
            footIK: this.footIK,
            yaw: this.modelYaw,
            climb: this.climbAmount * (1 - mantle),
            climbNormal: this.climbNormal,
            climbPhase: player.climbPhase,
            climbMove: player.climbMove,
            climbLunge: player.climbLunge,
            climbGear: player.climbGear,
            mantle,
            dt,
            stride: - this.strideYaw * this.footIK,
            leanPitch: this.leanPitch,
            leanBank: this.leanBank,
            // a tool in hand: the eyes on where the camera looks; otherwise ahead, kept level
            look: player.stance || this.view.tools?.aiming ? this.gaze() : null,
            tool: this.view.tools?.pose
        })
    }

    update() {
        const playerState = this.state.player
        const sunState = this.state.sun
        const dt = Math.min(this.state.time.delta, 0.05)
        const p = playerState.position.current

        this.group.position.set(p[0], p[1], p[2])
        this.group.rotation.y = playerState.rotation

        // ── lights follow the day cycle ──
        const sunDirection = new THREE.Vector3(sunState.position.x, sunState.position.y, sunState.position.z).normalize()
        // the atmosphere's sun (or moon, opposite it), sky and ground light, as the world's
        // shaders get them (three's diffuse divides by π, theirs doesn't)
        const atmosphere = this.view.sky.light
        const luminance = (c: number[]) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722
        const moonlit = luminance(atmosphere.moon) > luminance(atmosphere.sun)
        const source = moonlit ? atmosphere.moon : atmosphere.sun
        const light = moonlit ? sunDirection.clone().negate() : sunDirection
        this.sun.position.set(p[0] + light.x * 20, p[1] + light.y * 20, p[2] + light.z * 20)
        this.sun.target.position.set(p[0], p[1], p[2])
        const strength = Math.max(1e-6, Math.max(...source))
        this.sun.color.setRGB(source[0] / strength, source[1] / strength, source[2] / strength, THREE.LinearSRGBColorSpace)
        this.sun.intensity = Math.PI * strength
        this.hemisphere.color.setRGB(...atmosphere.sky, THREE.LinearSRGBColorSpace)
        // light bounced from the ground: mostly blocked by the grass and the body itself
        this.hemisphere.groundColor.setRGB(atmosphere.ground[0] * 0.45, atmosphere.ground[1] * 0.45, atmosphere.ground[2] * 0.45, THREE.LinearSRGBColorSpace)

        if (this.mixer && this.model && this.gaits.length)
            this.updateAnimation(dt)

        // wet line in world space (the model may be lifted while swimming)
        this.wetUniforms.uWetness.value = playerState.wetness
        this.wetUniforms.uWetLine.value = p[1] + (this.model?.position.y ?? 0) + playerState.wetHeight

        // ── shadow on the ground, following the slope, fading with height ──
        const ground = this.state.chunks.getElevationForPosition(p[0], p[2])
        const groundY = typeof ground === 'number' ? ground : p[1]
        const height = Math.max(0, p[1] - groundY)
        const n = playerState.groundNormal
        this.shadow.position.set(p[0], groundY + 0.04, p[2])
        this.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n[0], n[1], n[2]))
        const shrink = Math.max(0.35, 1 - height / 6)
        const underwater = 1 - THREE.MathUtils.smoothstep(WATER_LEVEL - groundY, 0.1, 0.6)
        this.shadow.scale.setScalar(shrink)
        // a soft contact shadow under the feet (fainter when the sun casts real shadows)
        ;(this.shadow.material as THREE.ShaderMaterial).uniforms.uOpacity.value = (this.view.shadows.enabled ? 0.22 : 0.45) * shrink * underwater
    }
}
