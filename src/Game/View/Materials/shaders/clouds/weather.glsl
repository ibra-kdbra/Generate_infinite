// The weather map (tiling 2D): r = where clouds form (large masses, with gaps between), g =
// how tall they grow (flat fair-weather clouds .. towering cumulus), b = variation.
varying vec2 vUv;

#include noise.glsl

void main()
{
    vec3 p = vec3(vUv, 0.37);
    // masses a few km across, with smaller clouds between them
    float masses = perlinFbm(p * vec3(6.0, 6.0, 1.0), 6.0, 5) * 0.5 + 0.5;
    float cells = worleyFbm(p * vec3(14.0, 14.0, 1.0), 14.0);
    float coverage = clamp(remap(masses, cells * 0.45 - 0.35, 1.0, 0.0, 1.0), 0.0, 1.0);
    float height = perlinFbm(p * vec3(4.0, 4.0, 1.0) + 11.3, 4.0, 3) * 0.5 + 0.5;
    float variation = perlinFbm(p * vec3(24.0, 24.0, 1.0) + 5.1, 24.0, 2) * 0.5 + 0.5;
    gl_FragColor = vec4(coverage, smoothstep(0.2, 0.65, height), variation, 1.0);
}
