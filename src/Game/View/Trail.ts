import * as THREE from 'three'

const SAMPLES = 18
const LIFE = 0.13          // seconds a sample stays visible

/**
 * The faint arc a blade leaves at full speed: a ribbon between the blade's base and tip over
 * the last few frames, brightest at the tip and fading with age. Additive, so it reads as a
 * blur of light on the steel rather than a solid shape.
 */
export default class Trail {
    mesh: THREE.Mesh
    private samples: { base: THREE.Vector3, tip: THREE.Vector3, age: number }[] = []
    private position: Float32Array
    private fade: Float32Array

    constructor(scene: THREE.Scene) {
        const geometry = new THREE.BufferGeometry()
        this.position = new Float32Array(SAMPLES * 2 * 3)
        this.fade = new Float32Array(SAMPLES * 2 * 2)
        geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage))
        geometry.setAttribute('aFade', new THREE.BufferAttribute(this.fade, 2).setUsage(THREE.DynamicDrawUsage))
        const index: number[] = []
        for (let i = 0; i < SAMPLES - 1; i++) {
            const a = i * 2, b = a + 1, c = a + 2, d = a + 3
            index.push(a, b, c, b, d, c)
        }
        geometry.setIndex(index)
        geometry.setDrawRange(0, 0)
        const material = new THREE.ShaderMaterial({
            vertexShader: /* glsl */ `
                attribute vec2 aFade;        // age 0..1, base 0 .. tip 1
                varying vec2 vFade;
                void main() {
                    vFade = aFade;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
            fragmentShader: /* glsl */ `
                varying vec2 vFade;
                void main() {
                    float a = (1.0 - vFade.x) * (1.0 - vFade.x) * smoothstep(0.0, 1.0, vFade.y) * 0.32;
                    gl_FragColor = vec4(vec3(1.6, 1.7, 1.9) * a, a);
                }`,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        })
        this.mesh = new THREE.Mesh(geometry, material)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 3
        scene.add(this.mesh)
    }

    push(base: THREE.Vector3, tip: THREE.Vector3) {
        this.samples.unshift({ base: base.clone(), tip: tip.clone(), age: 0 })
        if (this.samples.length > SAMPLES)
            this.samples.pop()
    }

    clear() {
        this.samples.length = 0
    }

    update(dt: number) {
        for (const sample of this.samples)
            sample.age += dt
        while (this.samples.length && this.samples[this.samples.length - 1].age > LIFE)
            this.samples.pop()
        const count = this.samples.length
        this.samples.forEach((sample, i) => {
            this.position.set([sample.base.x, sample.base.y, sample.base.z, sample.tip.x, sample.tip.y, sample.tip.z], i * 6)
            const age = Math.min(1, sample.age / LIFE)
            this.fade.set([age, 0, age, 1], i * 4)
        })
        const geometry = this.mesh.geometry
        geometry.setDrawRange(0, count > 1 ? (count - 1) * 6 : 0)
        geometry.getAttribute('position').needsUpdate = true
        geometry.getAttribute('aFade').needsUpdate = true
    }
}
