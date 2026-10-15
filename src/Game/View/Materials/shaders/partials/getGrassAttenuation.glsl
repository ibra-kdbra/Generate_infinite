float getGrassAttenuation(vec2 position)
{
    float distanceAttenuation = distance(uPlayerPosition.xz, position) / uGrassDistance * 2.0;
    return 1.0 - smoothstep(0.5, 1.0, distanceAttenuation);   // long fade: no visible field edge
}
