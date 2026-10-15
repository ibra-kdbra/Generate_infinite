// The clouds' shape noise, one slice of a tiling 3D texture per draw: r = Perlin-Worley
// (billowy masses with rounded, connected lobes), g b a = Worley fbm at three scales, which
// erode the masses into cauliflower forms.
uniform float uSlice;      // 0..1 through the volume

varying vec2 vUv;

#include noise.glsl

void main()
{
    vec3 p = vec3(vUv, uSlice);
    float perlin = perlinFbm(p * 4.0, 4.0, 5) * 0.5 + 0.5;
    float worley = worleyFbm(p * 6.0, 6.0);
    float perlinWorley = clamp(remap(perlin, worley - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
    gl_FragColor = vec4(perlinWorley, worley, worleyFbm(p * 12.0, 12.0), worleyFbm(p * 24.0, 24.0));
}
