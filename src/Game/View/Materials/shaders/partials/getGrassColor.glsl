// Grass albedo, shared by the terrain (the ground beyond the blades) and the grass blades,
// sampled from the same noise texture with the same scales, so the field and the ground
// around it are the same colour. Needs uNoiseTexture (tiling Perlin, 8 periods per repeat)
// and uGrassDryness (the grass style: 0 lush meadow .. 1 dry steppe).

uniform float uGrassDryness;

// 0 lush .. 1 dry: broad (~110 m) drifts plus smaller (~25 m) variation
float getGrassDryness(vec2 position)
{
    float broad = texture2D(uNoiseTexture, position * 0.0011).r - 0.5;
    float local = texture2D(uNoiseTexture, position * 0.0047).g - 0.5;
    return smoothstep(- 0.05, 0.45, broad + local * 0.45);
}

vec3 getGrassColor(float dryness, float elevation)
{
    vec3 lush = vec3(0.235, 0.325, 0.120);
    vec3 dry = vec3(0.370, 0.360, 0.190);
    vec3 golden = vec3(0.47, 0.41, 0.22);      // steppe at its driest
    vec3 alpine = vec3(0.320, 0.310, 0.180);   // short, yellowed meadow high up
    float d = clamp(dryness * 0.6 + uGrassDryness, 0.0, 1.0);
    vec3 color = mix(lush, dry, d);
    color = mix(color, golden, smoothstep(0.75, 1.0, d) * uGrassDryness);
    return mix(color, alpine, smoothstep(110.0, 185.0, elevation));
}
