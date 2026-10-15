import { Uniform } from 'three'
import { Effect, BlendFunction } from 'postprocessing'

// AgX (Blender's filmic view transform, as in three.js / Filament) with its "look" step:
// a power curve on the encoded signal for contrast and a saturation boost, as Blender's
// "Punchy" look does. Plain AgX is very soft and desaturated; this sits between the two.
// At night colours fade toward a moonlit blue.
const fragmentShader = /* glsl */ `
uniform float exposure;
uniform float power;
uniform float saturation;
uniform float vignette;
uniform float night;

vec3 agxContrast(vec3 x)
{
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 agx(vec3 color)
{
    const mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
    const mat3 fromRec2020 = mat3(vec3(1.6605, - 0.1246, - 0.0182), vec3(- 0.5876, 1.1329, - 0.1006), vec3(- 0.0728, - 0.0083, 1.1187));
    const mat3 inset = mat3(
        vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
        vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
        vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
    const mat3 outset = mat3(
        vec3(1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826),
        vec3(- 0.11060664309660323, 1.157823702216272, - 0.11060664309660294),
        vec3(- 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405));
    const float minEv = - 12.47393;
    const float maxEv = 4.026069;

    color = inset * (toRec2020 * color);
    color = clamp((log2(max(color, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
    color = agxContrast(color);

    // look
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = pow(max(color, 0.0), vec3(power));
    color = luma + saturation * (color - luma);

    color = outset * color;
    color = pow(max(color, 0.0), vec3(2.2));
    return clamp(fromRec2020 * color, 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor)
{
    vec3 color = inputColor.rgb;
    // in dim light the eye sees less colour, shifted to blue (rod vision)
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(color, luminance * vec3(0.62, 0.78, 1.15), night * 0.65);
    color = agx(color * exposure);
    // a lens's gentle fall-off toward the corners
    vec2 centered = uv - 0.5;
    color *= 1.0 - vignette * smoothstep(0.25, 0.95, dot(centered, centered) * 2.2);
    outputColor = vec4(color, inputColor.a);
}
`

export default class FilmEffect extends Effect {
    constructor({ exposure = 1, power = 1.2, saturation = 1.2, vignette = 0.18, night = 0 } = {}) {
        super('FilmEffect', fragmentShader, {
            blendFunction: BlendFunction.SRC,
            uniforms: new Map<string, Uniform>([
                ['exposure', new Uniform(exposure)],
                ['power', new Uniform(power)],
                ['saturation', new Uniform(saturation)],
                ['vignette', new Uniform(vignette)],
                ['night', new Uniform(night)]
            ])
        })
    }

    get exposure() { return this.uniforms.get('exposure')!.value as number }
    set exposure(value: number) { this.uniforms.get('exposure')!.value = value }
    get power() { return this.uniforms.get('power')!.value as number }
    set power(value: number) { this.uniforms.get('power')!.value = value }
    get saturation() { return this.uniforms.get('saturation')!.value as number }
    set saturation(value: number) { this.uniforms.get('saturation')!.value = value }
    get vignette() { return this.uniforms.get('vignette')!.value as number }
    set vignette(value: number) { this.uniforms.get('vignette')!.value = value }
    get night() { return this.uniforms.get('night')!.value as number }
    set night(value: number) { this.uniforms.get('night')!.value = value }
}
