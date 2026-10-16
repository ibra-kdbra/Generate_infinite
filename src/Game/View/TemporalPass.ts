import * as THREE from 'three'
import { Pass, CopyMaterial } from 'postprocessing'

// Halton (2, 3): well-spread sub-pixel offsets, eight frames to a cycle
const HALTON = [[0.5, 1 / 3], [0.25, 2 / 3], [0.75, 1 / 9], [0.125, 4 / 9], [0.625, 7 / 9], [0.375, 2 / 9], [0.875, 5 / 9], [0.0625, 8 / 9]]
    .map(([x, y]) => [x - 0.5, y - 0.5])

const fragmentShader = /* glsl */ `
uniform sampler2D inputBuffer;
uniform sampler2D depthBuffer;
uniform sampler2D uHistory;
uniform mat4 uInverseProjection;      // this frame's (jittered) projection, inverted
uniform mat4 uCameraWorld;
uniform mat4 uPreviousViewProjection; // last frame's, without jitter
uniform vec2 uTexel;
uniform float uReset;
uniform vec3 uCharacter;              // the player's feet, and how far they moved since last frame
uniform vec3 uCharacterMotion;

varying vec2 vUv;

// the history sampled with a Catmull-Rom filter (5 taps): resampling with a plain bilinear
// lookup every frame would blur the picture a little more each time
vec3 sampleHistory(vec2 uv)
{
    vec2 size = 1.0 / uTexel;
    vec2 position = uv * size;
    vec2 center = floor(position - 0.5) + 0.5;
    vec2 f = position - center;
    vec2 w0 = f * (- 0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (- 2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (- 0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 tc0 = (center - 1.0) * uTexel;
    vec2 tc12 = (center + w2 / w12) * uTexel;
    vec2 tc3 = (center + 2.0) * uTexel;
    vec3 result = texture2D(uHistory, vec2(tc12.x, tc0.y)).rgb * (w12.x * w0.y)
        + texture2D(uHistory, vec2(tc0.x, tc12.y)).rgb * (w0.x * w12.y)
        + texture2D(uHistory, vec2(tc12.x, tc12.y)).rgb * (w12.x * w12.y)
        + texture2D(uHistory, vec2(tc3.x, tc12.y)).rgb * (w3.x * w12.y)
        + texture2D(uHistory, vec2(tc12.x, tc3.y)).rgb * (w12.x * w3.y);
    float total = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
    return max(result / total, 0.0);
}

vec3 toYCoCg(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, - 0.5)), dot(c, vec3(- 0.25, 0.5, - 0.25))); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }

void main()
{
    vec3 current = texture2D(inputBuffer, vUv).rgb;
    float depth = texture2D(depthBuffer, vUv).r;

    // where this pixel was last frame: the world point under it, seen by last frame's camera
    vec4 view = uInverseProjection * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    view /= view.w;
    vec3 world = (uCameraWorld * vec4(view.xyz, 1.0)).xyz;
    // the character moves with the camera, not with the world
    vec3 relative = world - uCharacter;
    bool onCharacter = length(relative.xz) < 1.15 && relative.y > - 0.3 && relative.y < 2.4;
    if (onCharacter)
        world -= uCharacterMotion;
    vec4 previous = uPreviousViewProjection * vec4(world, 1.0);
    vec2 previousUv = previous.xy / previous.w * 0.5 + 0.5;

    // this frame's neighbourhood bounds the history (so nothing that changed can ghost)
    vec3 low = vec3(1e5), high = vec3(- 1e5), mean = vec3(0.0), square = vec3(0.0);
    for (int y = - 1; y <= 1; y++)
    for (int x = - 1; x <= 1; x++) {
        vec3 s = toYCoCg(texture2D(inputBuffer, vUv + vec2(x, y) * uTexel).rgb);
        low = min(low, s);
        high = max(high, s);
        mean += s;
        square += s * s;
    }
    mean /= 9.0;
    vec3 deviation = sqrt(max(square / 9.0 - mean * mean, 0.0));
    low = max(low, mean - deviation);
    high = min(high, mean + deviation);

    bool outside = any(lessThan(previousUv, vec2(0.0))) || any(greaterThan(previousUv, vec2(1.0)));
    if (uReset > 0.5 || outside || previous.w <= 0.0) {
        gl_FragColor = vec4(current, 1.0);
        return;
    }
    vec3 history = toYCoCg(sampleHistory(previousUv));
    history = clamp(history, low, high);
    // moving pixels lean on this frame more (less blur in motion), still ones accumulate
    float motion = length((previousUv - vUv) / uTexel);
    float weight = mix(0.12, 0.3, clamp(motion / 4.0, 0.0, 1.0)) + (onCharacter ? 0.15 : 0.0);
    vec3 result = fromYCoCg(mix(history, toYCoCg(current), weight));
    gl_FragColor = vec4(result, 1.0);
}
`

/**
 * Temporal anti-aliasing: each frame the camera is shifted by a different fraction of a
 * pixel (Halton sequence), and this pass blends the frame with the history of the last
 * ones, reprojected through the depth buffer to where each point was. The history is held
 * to the colour range of this frame's neighbourhood, so moving things don't leave trails;
 * the character, which moves with the camera, is reprojected with its own motion. Edges come
 * out smooth and stable, and detail finer than a pixel (grass, leaves, distant trees)
 * builds up over frames, which is what makes a lower render resolution look sharp again
 * (the sharpening pass follows).
 */
export default class TemporalPass extends Pass {
    private history: THREE.WebGLRenderTarget[]
    private current = 0
    private resolve: THREE.ShaderMaterial
    private copy = new CopyMaterial()
    private frame = 0
    private previousViewProjection = new THREE.Matrix4()
    private reset = true
    private character = new THREE.Vector3()
    private characterPrevious = new THREE.Vector3()
    private unjittered = new THREE.Matrix4()
    jitter = new THREE.Vector2()
    private view: THREE.PerspectiveCamera

    constructor(camera: THREE.PerspectiveCamera) {
        super('TemporalPass')
        this.view = camera
        this.needsDepthTexture = true
        const options = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
        this.history = [new THREE.WebGLRenderTarget(1, 1, options), new THREE.WebGLRenderTarget(1, 1, options)]
        this.resolve = new THREE.ShaderMaterial({
            uniforms: {
                inputBuffer: { value: null },
                depthBuffer: { value: null },
                uHistory: { value: null },
                uInverseProjection: { value: new THREE.Matrix4() },
                uCameraWorld: { value: new THREE.Matrix4() },
                uPreviousViewProjection: { value: new THREE.Matrix4() },
                uTexel: { value: new THREE.Vector2() },
                uReset: { value: 1 },
                uCharacter: { value: new THREE.Vector3() },
                uCharacterMotion: { value: new THREE.Vector3() }
            },
            vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }',
            fragmentShader,
            depthTest: false,
            depthWrite: false
        })
        this.fullscreenMaterial = this.resolve
    }

    override setDepthTexture(depthTexture: THREE.Texture) {
        this.resolve.uniforms.depthBuffer.value = depthTexture
    }

    override setSize(width: number, height: number) {
        for (const target of this.history)
            target.setSize(width, height)
        this.resolve.uniforms.uTexel.value.set(1 / width, 1 / height)
        this.reset = true
    }

    /** Forget the history (after a jump of the camera, a new world, toggling the pass). */
    invalidate() {
        this.reset = true
    }

    /** Before the scene renders: shift the camera's projection by this frame's sub-pixel offset. */
    applyJitter(width: number, height: number, character: THREE.Vector3) {
        const camera = this.view
        this.unjittered.copy(camera.projectionMatrix)
        const [x, y] = HALTON[this.frame++ % HALTON.length]
        this.jitter.set(x, y)
        camera.projectionMatrix.elements[8] += 2 * x / width
        camera.projectionMatrix.elements[9] += 2 * y / height
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
        this.characterPrevious.copy(this.character)
        this.character.copy(character)
    }

    /** After it rendered: the projection back as it was. */
    removeJitter() {
        const camera = this.view
        camera.projectionMatrix.copy(this.unjittered)
        camera.projectionMatrixInverse.copy(this.unjittered).invert()
    }

    override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget | null) {
        const camera = this.view
        const uniforms = this.resolve.uniforms
        const source = this.history[this.current], target = this.history[1 - this.current]
        uniforms.inputBuffer.value = inputBuffer.texture
        uniforms.uHistory.value = source.texture
        uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse)
        uniforms.uCameraWorld.value.copy(camera.matrixWorld)
        uniforms.uPreviousViewProjection.value.copy(this.previousViewProjection)
        const moved = this.character.distanceTo(this.characterPrevious)
        uniforms.uReset.value = this.reset || moved > 5 ? 1 : 0
        uniforms.uCharacter.value.copy(this.character)
        uniforms.uCharacterMotion.value.subVectors(this.character, this.characterPrevious)
        this.fullscreenMaterial = this.resolve
        renderer.setRenderTarget(target)
        renderer.render(this.scene, this.camera)
        // the result out
        this.copy.inputBuffer = target.texture
        this.fullscreenMaterial = this.copy
        renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
        renderer.render(this.scene, this.camera)
        this.fullscreenMaterial = this.resolve

        this.current = 1 - this.current
        this.previousViewProjection.multiplyMatrices(this.unjittered, camera.matrixWorldInverse)
        this.reset = false
    }
}
