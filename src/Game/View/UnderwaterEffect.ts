import { Uniform, Vector3 } from 'three'
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing'

// Under the surface: light is absorbed along the way (red first, then green: the water
// turns blue-green within a few metres), replaced by light scattered in the water, and it
// gets darker the deeper the camera is. Linear HDR, before tone mapping.
const fragmentShader = /* glsl */ `
uniform float underwater;     // 0 above .. 1 below the surface
uniform vec3 waterColor;      // light scattered by the water (linear)
uniform float cameraDepth;    // metres below the surface

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor)
{
    if (underwater < 0.001) {
        outputColor = inputColor;
        return;
    }
    float distance = depth >= 0.9999 ? 400.0 : min(- getViewZ(depth), 400.0);
    vec3 transmittance = exp(- distance * vec3(0.26, 0.065, 0.05));
    vec3 color = inputColor.rgb * transmittance + waterColor * (1.0 - transmittance);
    color *= exp(- cameraDepth * vec3(0.12, 0.04, 0.03));
    outputColor = vec4(mix(inputColor.rgb, color, underwater), inputColor.a);
}
`

export default class UnderwaterEffect extends Effect {
    constructor() {
        super('UnderwaterEffect', fragmentShader, {
            blendFunction: BlendFunction.SRC,
            attributes: EffectAttribute.DEPTH,
            uniforms: new Map<string, Uniform>([
                ['underwater', new Uniform(0)],
                ['waterColor', new Uniform(new Vector3(0.01, 0.04, 0.05))],
                ['cameraDepth', new Uniform(0)]
            ])
        })
    }

    set underwater(value: number) { this.uniforms.get('underwater')!.value = value }
    get waterColor() { return this.uniforms.get('waterColor')!.value as Vector3 }
    set cameraDepth(value: number) { this.uniforms.get('cameraDepth')!.value = value }
}
