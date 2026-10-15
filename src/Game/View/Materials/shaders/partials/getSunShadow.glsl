// Sun shadows from three cascaded shadow maps (View/Shadows.ts): a sharp one around the
// camera (the character, trees, rocks), a wider one for the trees and the land around, and
// a coarse one over the whole terrain, so mountains shade the valleys at sunset. Hardware
// depth comparison with filtering, several taps: soft edges. Neighbouring cascades blend
// over the last part of each range; the terrain cascade always applies (big shadows from
// far away). Returns 1 in sunlight .. 0 in shadow.

uniform sampler2DShadow uShadowMap0;
uniform sampler2DShadow uShadowMap1;
uniform sampler2DShadow uShadowMap2;
uniform mat4 uShadowMatrix0;
uniform mat4 uShadowMatrix1;
uniform mat4 uShadowMatrix2;
uniform vec4 uShadowSplits;      // xyz: where each cascade ends (view depth, m); w: 1 when shadows are on
uniform vec3 uShadowTexel;       // world size of a texel in each cascade (m)
uniform vec3 uShadowTexelUv;     // uv size of a texel in each cascade

float shadowTaps(sampler2DShadow map, vec3 coord, float texel, float bias, int quality)
{
    if (any(lessThan(coord, vec3(0.0))) || any(greaterThan(coord, vec3(1.0))))
        return 1.0;
    coord.z -= bias;
    if (quality == 0)
        return texture(map, coord);
    float sum = 0.0;
    if (quality == 1) {
        sum += texture(map, coord + vec3(- 0.5, - 0.5, 0.0) * texel);
        sum += texture(map, coord + vec3(0.5, - 0.5, 0.0) * texel);
        sum += texture(map, coord + vec3(- 0.5, 0.5, 0.0) * texel);
        sum += texture(map, coord + vec3(0.5, 0.5, 0.0) * texel);
        return sum * 0.25;
    }
    for (int y = - 1; y <= 1; y++)
        for (int x = - 1; x <= 1; x++)
            sum += texture(map, coord + vec3(float(x), float(y), 0.0) * texel);
    return sum / 9.0;
}

float cascadeShadow(int cascade, vec3 worldPosition, vec3 normal, vec3 sunDirection)
{
    // nudge the point off the surface (by a couple of texels) so it doesn't shadow itself
    float texel = cascade == 0 ? uShadowTexel.x : cascade == 1 ? uShadowTexel.y : uShadowTexel.z;
    float facing = clamp(dot(normal, sunDirection), 0.0, 1.0);
    vec3 offset = normal * texel * mix(2.2, 0.8, facing) + sunDirection * texel * 0.5;
    vec4 p = vec4(worldPosition + offset, 1.0);
    if (cascade == 0)
        return shadowTaps(uShadowMap0, (uShadowMatrix0 * p).xyz, uShadowTexelUv.x, 0.0002, 2);
    if (cascade == 1)
        return shadowTaps(uShadowMap1, (uShadowMatrix1 * p).xyz, uShadowTexelUv.y, 0.0003, 1);
    return shadowTaps(uShadowMap2, (uShadowMatrix2 * p).xyz, uShadowTexelUv.z, 0.0006, 1);
}

float getSunShadow(vec3 worldPosition, vec3 normal, vec3 sunDirection)
{
    if (uShadowSplits.w < 0.5 || sunDirection.y < - 0.05)
        return 1.0;
    float depth = - (viewMatrix * vec4(worldPosition, 1.0)).z;
    float shadow = 1.0;
    if (depth < uShadowSplits.x) {
        shadow = cascadeShadow(0, worldPosition, normal, sunDirection);
        float blend = smoothstep(uShadowSplits.x * 0.8, uShadowSplits.x, depth);
        if (blend > 0.0)
            shadow = mix(shadow, cascadeShadow(1, worldPosition, normal, sunDirection), blend);
    }
    else if (depth < uShadowSplits.y) {
        shadow = cascadeShadow(1, worldPosition, normal, sunDirection);
        shadow = mix(shadow, 1.0, smoothstep(uShadowSplits.y * 0.85, uShadowSplits.y, depth));
    }
    // the land's own big shadows, everywhere
    if (depth < uShadowSplits.z)
        shadow = min(shadow, mix(cascadeShadow(2, worldPosition, normal, sunDirection), 1.0, smoothstep(uShadowSplits.z * 0.85, uShadowSplits.z, depth)));
    return shadow;
}

// Cheaper: one tap per cascade (for per-vertex use, e.g. grass blades)
float getSunShadowFast(vec3 worldPosition, vec3 normal, vec3 sunDirection)
{
    if (uShadowSplits.w < 0.5 || sunDirection.y < - 0.05)
        return 1.0;
    float depth = - (viewMatrix * vec4(worldPosition, 1.0)).z;
    vec4 p = vec4(worldPosition + normal * 0.06 + sunDirection * 0.05, 1.0);
    float shadow = 1.0;
    if (depth < uShadowSplits.x)
        shadow = shadowTaps(uShadowMap0, (uShadowMatrix0 * p).xyz, uShadowTexelUv.x, 0.0003, 0);
    else if (depth < uShadowSplits.y)
        shadow = mix(shadowTaps(uShadowMap1, (uShadowMatrix1 * p).xyz, uShadowTexelUv.y, 0.0004, 0), 1.0, smoothstep(uShadowSplits.y * 0.85, uShadowSplits.y, depth));
    if (depth < uShadowSplits.z)
        shadow = min(shadow, shadowTaps(uShadowMap2, (uShadowMatrix2 * p).xyz, uShadowTexelUv.z, 0.0008, 0));
    return shadow;
}
