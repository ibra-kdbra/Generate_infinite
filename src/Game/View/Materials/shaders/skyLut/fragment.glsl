// The sky (atmosphere.glsl) over the upper hemisphere, baked every frame into a small
// texture: u = azimuth, v = sqrt(elevation / 90°) (denser near the horizon, where the colour
// changes fastest). The sky backdrop, the terrain haze and the water reflections read it.
// Lit by the sun and, much more faintly, by the moon opposite it; plus a faint glow of
// starlight and airglow so the night sky is never black.

uniform vec3 uSunPosition;
uniform float uSunIlluminance;
uniform float uMoonIlluminance;

varying vec2 vUv;

#include ../partials/atmosphere.glsl

void main()
{
    float azimuth = (vUv.x - 0.5) * 6.28318531;
    float elevation = max(vUv.y * vUv.y * 1.57079633, 0.002);
    vec3 direction = vec3(cos(elevation) * sin(azimuth), sin(elevation), cos(elevation) * cos(azimuth));
    vec3 sun = normalize(uSunPosition);
    vec3 color = atmosphereRadiance(direction, sun, uSunIlluminance);
    if (sun.y < 0.2)
        color += atmosphereRadiance(direction, - sun, uMoonIlluminance) * vec3(0.55, 0.7, 1.0);
    color += vec3(0.008, 0.013, 0.03) * (1.0 - 0.5 * direction.y);
    gl_FragColor = vec4(color, 1.0);
}
