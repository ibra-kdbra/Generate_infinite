import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Settings, { Quality } from '../Settings'

// Shadow map sizes, where each cascade ends (view depth, m) and how often each is redrawn
// (every n frames), by quality. Cascade 0: the character, trees and rocks close by; 1: trees
// and the land around (in a forest, redrawing every tree's leaves is the expensive part);
// 2: only the terrain, far out, for the mountains' shadows.
type Preset = { sizes: [number, number, number], splits: [number, number, number], intervals: [number, number, number] }
const CASCADES: Record<Quality, Preset | null> = {
    low: null,
    medium: { sizes: [1024, 1024, 1024], splits: [22, 100, 2200], intervals: [1, 2, 4] },
    high: { sizes: [2048, 1536, 1536], splits: [30, 150, 2600], intervals: [1, 2, 4] },
    ultra: { sizes: [3072, 2048, 2048], splits: [34, 180, 3000], intervals: [1, 1, 3] }
}

/** Layer the shadow casters are on (as well as the default one). */
export const SHADOW_LAYER = 1

// Uniforms shared by reference with every material that receives shadows
export const SHADOW_UNIFORMS = [
    'uShadowMap0', 'uShadowMap1', 'uShadowMap2', 'uShadowMatrix0', 'uShadowMatrix1', 'uShadowMatrix2',
    'uShadowSplits', 'uShadowTexel', 'uShadowTexelUv', 'uViewPosition'
]

type Cascade = {
    target: THREE.WebGLRenderTarget
    camera: THREE.OrthographicCamera
    matrix: THREE.Matrix4
    size: number
    terrainOnly: boolean
    interval: number             // rendered every n frames
}

/**
 * Sun shadows: three cascaded shadow maps fitted around slices of the view, re-rendered
 * every frame (the far, terrain-only one every few frames). Objects cast shadows when
 * they're on SHADOW_LAYER and carry a `userData.shadowMaterial` (depth only, same vertex
 * animation as their own material); materials sample the maps with getSunShadow.glsl.
 */
export default class Shadows {
    view: View
    state: State
    uniforms: Record<string, THREE.IUniform>
    depthMaterial: THREE.ShaderMaterial          // for plain meshes (terrain chunks)
    enabled = false
    private cascades: Cascade[] = []
    private splits: [number, number, number] = [24, 120, 2200]
    private frame = 0
    private swapped: { mesh: THREE.Mesh, material: THREE.Material | THREE.Material[] }[] = []

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()

        this.uniforms = {
            uShadowMap0: { value: null },
            uShadowMap1: { value: null },
            uShadowMap2: { value: null },
            uShadowMatrix0: { value: new THREE.Matrix4() },
            uShadowMatrix1: { value: new THREE.Matrix4() },
            uShadowMatrix2: { value: new THREE.Matrix4() },
            uShadowSplits: { value: new THREE.Vector4() },
            uShadowTexel: { value: new THREE.Vector3(1, 1, 1) },
            uShadowTexelUv: { value: new THREE.Vector3(1, 1, 1) },
            uViewPosition: { value: new THREE.Vector3() }
        }

        this.depthMaterial = new THREE.ShaderMaterial({
            vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `void main() { gl_FragColor = vec4(1.0); }`,
            colorWrite: false
        })

        const settings = Settings.getInstance()
        settings.events.on('change:quality', (quality: Quality) => this.applyQuality(quality))
        this.applyQuality(settings.get('quality'))
    }

    private applyQuality(quality: Quality) {
        for (const cascade of this.cascades)
            cascade.target.dispose()
        this.cascades = []
        const preset = CASCADES[quality]
        this.enabled = preset !== null
        this.uniforms.uShadowSplits.value.w = this.enabled ? 1 : 0
        if (!preset) {
            // the samplers still need a depth texture, set up for comparison: one that's never
            // been rendered to isn't, and WebGL refuses to draw anything sampling it
            const dummy = this.createTarget(1)
            const renderer = this.view.renderer.instance
            renderer.setRenderTarget(dummy)
            renderer.clear(false, true, false)
            renderer.setRenderTarget(null)
            for (let i = 0; i < 3; i++)
                this.uniforms[`uShadowMap${i}`].value = dummy.depthTexture
            this.cascades.push({ target: dummy, camera: new THREE.OrthographicCamera(), matrix: new THREE.Matrix4(), size: 1, terrainOnly: false, interval: 1 })     // disposed with the rest
            return
        }
        this.splits = preset.splits
        for (let i = 0; i < 3; i++) {
            const size = preset.sizes[i]
            const target = this.createTarget(size)
            this.cascades.push({
                target,
                camera: new THREE.OrthographicCamera(),
                matrix: this.uniforms[`uShadowMatrix${i}`].value,
                size,
                terrainOnly: i === 2,
                interval: preset.intervals[i]
            })
            this.uniforms[`uShadowMap${i}`].value = target.depthTexture
        }
        this.uniforms.uShadowSplits.value.set(...preset.splits, 1)
        this.frame = 0
    }

    private createTarget(size: number) {
        const depthTexture = new THREE.DepthTexture(size, size, THREE.FloatType)
        depthTexture.format = THREE.DepthFormat
        depthTexture.compareFunction = THREE.LessEqualCompare
        depthTexture.minFilter = THREE.LinearFilter
        depthTexture.magFilter = THREE.LinearFilter
        return new THREE.WebGLRenderTarget(size, size, {
            depthTexture,
            depthBuffer: true,
            type: THREE.UnsignedByteType,
            generateMipmaps: false
        })
    }

    /** Makes a mesh cast shadows with this depth-only material. */
    addCaster(mesh: THREE.Object3D, material: THREE.Material, terrain = false) {
        mesh.layers.enable(SHADOW_LAYER)
        mesh.userData.shadowMaterial = material
        mesh.userData.terrainCaster = terrain
    }

    /** A copy of a ShaderMaterial for the shadow pass (adds SHADOW; writes depth only). */
    static shadowVariant(material: THREE.ShaderMaterial, defines: Record<string, string> = {}) {
        // built, not cloned: the uniforms are shared by reference (clone() would copy them
        // and can't copy render-target textures)
        return new THREE.ShaderMaterial({
            vertexShader: material.vertexShader,
            fragmentShader: material.fragmentShader,
            uniforms: material.uniforms,
            defines: { ...material.defines, SHADOW: '', ...defines },
            side: material.side === THREE.FrontSide ? THREE.FrontSide : THREE.DoubleSide,
            colorWrite: false
        })
    }

    /** Fits a cascade's light camera around a slice of the view, snapped to its texels. */
    private fit(cascade: Cascade, near: number, far: number, sun: THREE.Vector3, extra: number) {
        const camera = this.view.camera.instance
        // the smallest sphere around the view frustum between these depths (its size doesn't
        // change as the view turns, so the shadows don't shimmer)
        const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)
        const q2 = tanY * tanY * (1 + camera.aspect * camera.aspect)      // (corner offset / depth)²
        const centerDepth = Math.min(far, (far + near) * (1 + q2) * 0.5)
        const radius = Math.sqrt((far - centerDepth) ** 2 + far * far * q2)
        const forward = new THREE.Vector3()
        camera.getWorldDirection(forward)
        const center = camera.position.clone().addScaledVector(forward, centerDepth)

        // light space: looking down the sunlight; the centre snapped to the texel grid
        const up = Math.abs(sun.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
        const rotation = new THREE.Matrix4().lookAt(new THREE.Vector3(), sun.clone().negate(), up)
        const inverse = rotation.clone().invert()
        const texel = radius * 2 / cascade.size
        const local = center.clone().applyMatrix4(inverse)
        local.x = Math.round(local.x / texel) * texel
        local.y = Math.round(local.y / texel) * texel
        center.copy(local.applyMatrix4(rotation))

        const lightCamera = cascade.camera
        lightCamera.left = - radius
        lightCamera.right = radius
        lightCamera.top = radius
        lightCamera.bottom = - radius
        lightCamera.near = 0
        lightCamera.far = radius * 2 + extra
        lightCamera.position.copy(center).addScaledVector(sun, radius + extra)
        lightCamera.quaternion.setFromRotationMatrix(rotation)
        lightCamera.updateMatrixWorld()
        lightCamera.updateProjectionMatrix()

        // world -> [0, 1]³ of the map
        cascade.matrix.set(
            0.5, 0, 0, 0.5,
            0, 0.5, 0, 0.5,
            0, 0, 0.5, 0.5,
            0, 0, 0, 1
        ).multiply(lightCamera.projectionMatrix).multiply(lightCamera.matrixWorldInverse)
        return texel
    }

    private swapMaterials(terrainOnly: boolean) {
        this.swapped.length = 0
        this.view.scene.traverseVisible((object) => {
            const mesh = object as THREE.Mesh
            const material = mesh.userData?.shadowMaterial
            if (!material || !mesh.layers.isEnabled(SHADOW_LAYER))
                return
            if (terrainOnly && !mesh.userData.terrainCaster) {
                this.swapped.push({ mesh, material: mesh.material })
                mesh.visible = false
                return
            }
            this.swapped.push({ mesh, material: mesh.material })
            mesh.material = material
        })
    }

    private restoreMaterials() {
        for (const { mesh, material } of this.swapped) {
            mesh.material = material
            mesh.visible = true
        }
        this.swapped.length = 0
    }

    update() {
        this.uniforms.uViewPosition.value.copy(this.view.camera.instance.position)
        if (!this.enabled || !this.cascades.length)
            return
        const sunState = this.state.sun.position
        const sun = new THREE.Vector3(sunState.x, sunState.y, sunState.z).normalize()
        if (sun.y < - 0.05)
            return

        const renderer = this.view.renderer.instance
        const texels = this.uniforms.uShadowTexel.value as THREE.Vector3
        const texelsUv = this.uniforms.uShadowTexelUv.value as THREE.Vector3
        const ranges: [number, number][] = [[0.1, this.splits[0]], [this.splits[0] * 0.8, this.splits[1]], [this.splits[1] * 0.5, this.splits[2]]]
        const extras = [250, 500, 1500]
        const background = this.view.scene.background
        this.view.scene.background = null
        this.frame++
        this.cascades.forEach((cascade, i) => {
            // staggered so the cascades that skip frames don't all render on the same one
            if ((this.frame + i) % cascade.interval !== 0 && this.frame > 3)
                return
            const texel = this.fit(cascade, ranges[i][0], ranges[i][1], sun, extras[i])
            texels.setComponent(i, texel)
            texelsUv.setComponent(i, 1 / cascade.size)
            cascade.camera.layers.set(SHADOW_LAYER)
            this.swapMaterials(cascade.terrainOnly)
            renderer.setRenderTarget(cascade.target)
            renderer.clear(false, true, false)
            renderer.render(this.view.scene, cascade.camera)
            this.restoreMaterials()
        })
        renderer.setRenderTarget(null)
        this.view.scene.background = background
    }
}
