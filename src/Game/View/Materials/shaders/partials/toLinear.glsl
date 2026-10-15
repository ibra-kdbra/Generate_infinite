// The scene renders in linear light into a floating-point buffer; post-processing (Renderer.ts)
// adds ambient occlusion and bloom, tone-maps and encodes for the display. Colours picked in
// display (sRGB) terms (palettes, textures, the sky model) are converted with this first.
vec3 toLinear(vec3 color)
{
    color = max(color, vec3(0.0));
    return mix(color / 12.92, pow((color + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), color));
}
