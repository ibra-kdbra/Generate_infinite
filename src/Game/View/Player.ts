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

const LOCOMOTION = ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'] as const
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
            material.onBeforeCompile = (shader) => this.addUnderwaterTint(shader)
            this.view.shadows.addCaster(mesh, this.depthMaterial)
        })
        this.group.add(model)
        this.model = model

        // Clips were made on the mannequin; only rotations and the pelvis translation are
        // kept, the pelvis scaled to this body's hip height
        this.mixer = new THREE.AnimationMixer(model)
        const pelvis = model.getObjectByName('pelvis')
        const ratio = pelvis ? pelvis.position.z / this.mannequinPelvisHeight : 1
        this.actions = {}
        for (const [clipName, source] of Object.entries(this.clips)) {
            const clip = source.clone()
            for (const track of clip.tracks)
                if (track.name === 'pelvis.position')
                    for (let i = 0; i < track.values.length; i++)
                        track.values[i] *= ratio
            const action = this.mixer.clipAction(clip)
            if (ONE_SHOTS.includes(clipName)) {
                action.setLoop(THREE.LoopOnce, 1)
                action.clampWhenFinished = true
            }
            this.actions[clipName] = action
        }

        this.calibrate(model)

        for (const [clipName, action] of Object.entries(this.actions)) {
            this.weights[clipName] = clipName === 'Idle_Loop' ? 1 : 0
            action.setEffectiveWeight(this.weights[clipName])
            if (!ONE_SHOTS.includes(clipName))
                action.play()
        }
        for (const gait of this.gaits)
            this.actions[gait.clip].timeScale = 0       // driven by the shared phase
        this.oneShot = null
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

    /** Idle / walk / jog / sprint weights for this speed; advances the shared cycle phase. */
    private locomotion(speed: number, dt: number) {
        const gaits = this.gaits
        let a = gaits[0], b = gaits[0], t = 0
        if (speed > gaits[0].speed) {
            const i = speed < gaits[1].speed ? 0 : 1
            a = gaits[i]
            b = gaits[i + 1]
            t = Math.min(1, (speed - a.speed) / (b.speed - a.speed))
        }
        const natural = THREE.MathUtils.lerp(a.speed, b.speed, t)
        const duration = THREE.MathUtils.lerp(a.duration, b.duration, t)
        const rate = THREE.MathUtils.clamp(speed / natural, 0.55, 1.6)
        this.phase = (this.phase + rate * dt / duration) % 1

        const moving = THREE.MathUtils.smoothstep(speed, 0.15, 0.7)
        this.targets.Idle_Loop = 1 - moving
        this.targets[a.clip] = (this.targets[a.clip] || 0) + (1 - t) * moving
        this.targets[b.clip] = (this.targets[b.clip] || 0) + t * moving
        for (const gait of gaits)
            this.actions[gait.clip].time = ((this.phase + gait.offset) % 1) * gait.duration
    }

    private updateAnimation(dt: number) {
        const player = this.state.player
        const speed = player.speed
        const state = player.movementState
        const swimming = state === PlayerState.STATE_SWIM

        for (const name in this.actions)
            this.targets[name] = 0

        // ── events ──
        if (!player.grounded && !swimming) {
            this.airTime += dt
            this.fallSpeed = Math.max(this.fallSpeed, - player.velocity[1])
        }
        if (state === PlayerState.STATE_JUMP && this.previousState !== PlayerState.STATE_JUMP)
            this.startOneShot('Jump_Start', 0.22, 1.3)     // skip the wind-up: the physics already left the ground
        if ((player.grounded || swimming) && !this.wasGrounded) {
            if (swimming)
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
        this.wasGrounded = player.grounded || swimming
        this.previousState = state

        // ── one-shot clips until they end or get interrupted ──
        if (this.oneShot) {
            const action = this.actions[this.oneShot]
            const finished = action.time >= action.getClip().duration - 0.02
            const interrupted =
                (this.oneShot === 'Jump_Start' && (player.velocity[1] < 1 || player.grounded)) ||
                (this.oneShot === 'Jump_Land' && speed > 1.5) ||
                swimming
            if (finished || interrupted)
                this.oneShot = null
            else
                this.targets[this.oneShot] = 1
        }

        if (!this.oneShot) {
            if (swimming) {
                const moving = THREE.MathUtils.smoothstep(speed, 0.3, 1.0)
                this.targets.Swim_Idle_Loop = 1 - moving
                this.targets.Swim_Fwd_Loop = moving
                this.actions.Swim_Fwd_Loop.timeScale = THREE.MathUtils.clamp(speed / 1.6, 0.6, 1.7)
            }
            else if (!player.grounded && (state === PlayerState.STATE_JUMP || this.airTime > 0.18)) {
                this.targets.Jump_Loop = 1
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
        this.mixer!.update(dt)

        // ── swimming: hold the head just above the surface ──
        let offset = 0
        if (swimming) {
            const wIdle = this.weights.Swim_Idle_Loop, wFwd = this.weights.Swim_Fwd_Loop
            const head = (wIdle * this.swimHeadHeight.Swim_Idle_Loop + wFwd * this.swimHeadHeight.Swim_Fwd_Loop) / Math.max(1e-3, wIdle + wFwd)
            offset = WATER_LEVEL + 0.12 - player.position.current[1] - head
        }
        this.swimOffset += (offset - this.swimOffset) * (1 - Math.exp(- dt * 4))
        this.model!.position.y = this.swimOffset
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
        this.hemisphere.groundColor.setRGB(...atmosphere.ground, THREE.LinearSRGBColorSpace)

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
