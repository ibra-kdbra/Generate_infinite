// Light falling on a surface, in linear units: sunlight, the sky's light from above, light
// bounced from the ground below and the moon at night. The values come from the atmosphere
// model every frame (View/Atmosphere.ts): the sun turns orange and fades at sunset, the
// sky's light turns deep blue at dusk. The terrain, grass, trees and rocks all use it, so a
// blade, the ground beside it and the tree over it are lit alike. Albedos are linear too
// (toLinear). sunVisibility: 1 in full sun, lower in cloud and tree shadows.

uniform vec3 uSunLight;      // sunlight at the ground
uniform vec3 uMoonLight;     // from the direction opposite the sun
uniform vec3 uSkyLight;      // the sky's light on a surface facing up
uniform vec3 uGroundLight;   // light bounced from the ground, on a surface facing down

vec3 getSunLight(vec3 sunDirection)
{
    return uSunLight;
}

vec3 getTerrainLight(vec3 normal, vec3 sunDirection, float sunVisibility)
{
    vec3 sun = uSunLight * max(dot(normal, sunDirection), 0.0) * sunVisibility;
    vec3 ambient = mix(uGroundLight, uSkyLight, normal.y * 0.5 + 0.5);
    vec3 moon = uMoonLight * clamp(dot(normal, - sunDirection) * 0.8 + 0.2, 0.0, 1.0);
    return ambient + sun + moon;
}
