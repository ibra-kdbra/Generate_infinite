// Ferns: the scan's colour (cut out by its alpha) and normal map, lit like the grass around
// them (sun, sky, bounce, shadows), glowing a little when the sun shines through.

uniform vec3 uSunPosition;
uniform sampler2D uMap;
uniform sampler2D uNormalMap;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vHeight;
varying float vTint;

#include ../partials/getTerrainLight.glsl
#include ../partials/toLinear.glsl
#include ../partials/getSunShadow.glsl
#include ../partials/getClouds.glsl

#include ../partials/perturbNormal.glsl

void main()
{
    vec4 color = texture2D(uMap, vUv);
    if (color.a < 0.5)
        discard;
    vec3 sunDirection = normalize(uSunPosition);
    vec3 toEye = normalize(cameraPosition - vWorldPosition);

    vec3 geometric = normalize(vNormal) * (gl_FrontFacing ? 1.0 : - 1.0);
    vec2 xy = vec2(texture2D(uNormalMap, vUv).x, 1.0 - texture2D(uNormalMap, vUv).y) * 2.0 - 1.0;
    vec3 normal = perturb(geometric, vWorldPosition, vUv, vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy)))));
    // fronds lean outward: light them partly like the ground beneath (soft, like the grass)
    normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), 0.35));

    vec3 albedo = toLinear(color.rgb) * mix(0.8, 1.15, vTint);
    float sunVisibility = (1.0 - getCloudShadow(vWorldPosition, sunDirection)) * getSunShadow(vWorldPosition, geometric, sunDirection);
    float shade = mix(0.45, 1.05, vHeight);          // the plant's own shade near its root
    vec3 lit = albedo * shade * (getTerrainLight(normal, sunDirection, sunVisibility) + getTorchLight(vWorldPosition, normal));
    // sunlight through the fronds
    float back = pow(clamp(dot(- toEye, sunDirection), 0.0, 1.0), 3.0);
    lit += albedo * uSunLight * vec3(1.0, 1.0, 0.55) * back * 0.4 * sunVisibility;
    gl_FragColor = vec4(lit, 1.0);
}
