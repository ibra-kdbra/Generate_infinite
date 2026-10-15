// Micro relief for the terrain, baked once into a tiling texture (one tile = 12 m):
//   rg: height difference to the neighbours 0.35 m away along x / z (the slope the normal
//       is tilted by), b: the height itself (cavities), all encoded as * 0.5 + 0.5
// (replaces six noise lookups per pixel with one)

varying vec2 vUv;

#include ../partials/perlin3dPeriodic.glsl;

float heightAt(vec2 uv)
{
    return perlin3dPeriodic(vec3(uv * 10.0, 1.7), vec3(10.0)) * 0.5
         + perlin3dPeriodic(vec3(uv * 26.0, 4.3), vec3(26.0)) * 0.25;
}

void main()
{
    float step = 0.35 / 12.0;
    float h = heightAt(vUv);
    float hx = heightAt(vUv + vec2(step, 0.0));
    float hz = heightAt(vUv + vec2(0.0, step));
    gl_FragColor = vec4(vec3(h - hx, h - hz, h) * 0.5 + 0.5, 1.0);
}
