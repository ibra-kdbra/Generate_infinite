// Sky colour (linear) in a direction of the upper hemisphere, from the per-frame sky texture
// (View/SkyLut.ts): one fetch instead of ray-marching the atmosphere.

uniform sampler2D uSkyLut;

vec3 getSkyLut(vec3 direction)
{
    direction = normalize(direction);
    float azimuth = atan(direction.x, direction.z);
    float elevation = asin(clamp(direction.y, 0.0, 1.0));
    return texture2D(uSkyLut, vec2(azimuth / 6.28318531 + 0.5, sqrt(elevation / 1.57079633))).rgb;
}
