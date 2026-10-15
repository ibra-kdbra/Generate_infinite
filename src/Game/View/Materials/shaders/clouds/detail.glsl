// The clouds' detail noise (a small tiling 3D texture): Worley fbm at three scales, for the
// wisps and curls along the edges.
uniform float uSlice;

varying vec2 vUv;

#include noise.glsl

void main()
{
    vec3 p = vec3(vUv, uSlice);
    gl_FragColor = vec4(worleyFbm(p * 2.0, 2.0), worleyFbm(p * 4.0, 4.0), worleyFbm(p * 8.0, 8.0), 1.0);
}
