import { Uniform } from 'three'
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing'

// Contrast-adaptive sharpening (after AMD FidelityFX CAS): each pixel is sharpened against
// its neighbours by an amount that shrinks where the local contrast is already high, so
// edges get crisper without halos and flat areas don't turn to noise. It brings back the
// detail lost when the frame is rendered below the display's resolution and stretched.
// Runs last, on tone-mapped values (0..1).
const fragmentShader = /* glsl */ `
uniform float sharpness;      // 0 subtle .. 1 strong

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor)
{
    vec2 t = texelSize;
    vec3 a = texture2D(inputBuffer, uv + vec2(- t.x, - t.y)).rgb;
    vec3 b = texture2D(inputBuffer, uv + vec2(0.0, - t.y)).rgb;
    vec3 c = texture2D(inputBuffer, uv + vec2(t.x, - t.y)).rgb;
    vec3 d = texture2D(inputBuffer, uv + vec2(- t.x, 0.0)).rgb;
    vec3 e = inputColor.rgb;
    vec3 f = texture2D(inputBuffer, uv + vec2(t.x, 0.0)).rgb;
    vec3 g = texture2D(inputBuffer, uv + vec2(- t.x, t.y)).rgb;
    vec3 h = texture2D(inputBuffer, uv + vec2(0.0, t.y)).rgb;
    vec3 i = texture2D(inputBuffer, uv + vec2(t.x, t.y)).rgb;

    // soft minimum and maximum over the cross and the whole 3 x 3
    vec3 lo = min(min(min(d, e), min(f, b)), h);
    vec3 hi = max(max(max(d, e), max(f, b)), h);
    lo += min(lo, min(min(a, c), min(g, i)));
    hi += max(hi, max(max(a, c), max(g, i)));

    // how much room there is before clipping, relative to the brightest neighbour
    vec3 amount = sqrt(clamp(min(lo, 2.0 - hi) / max(hi, vec3(1e-4)), 0.0, 1.0));
    vec3 w = amount * (- 1.0 / mix(8.0, 5.0, sharpness));
    vec3 color = ((b + d + f + h) * w + e) / (1.0 + 4.0 * w);
    outputColor = vec4(clamp(color, 0.0, 1.0), inputColor.a);
}
`

export default class SharpenEffect extends Effect {
    constructor(sharpness = 0.5) {
        super('SharpenEffect', fragmentShader, {
            blendFunction: BlendFunction.SRC,
            attributes: EffectAttribute.CONVOLUTION,
            uniforms: new Map<string, Uniform>([['sharpness', new Uniform(sharpness)]])
        })
    }

    get sharpness() { return this.uniforms.get('sharpness')!.value as number }
    set sharpness(value: number) { this.uniforms.get('sharpness')!.value = value }
}
