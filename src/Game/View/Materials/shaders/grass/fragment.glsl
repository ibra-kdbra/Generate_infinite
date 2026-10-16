precision highp float;

uniform vec3 uSunPosition;

varying vec3 vColorBase;
varying vec3 vNormal;
varying vec3 vGroundNormal;
varying vec3 vWorldPosition;
varying float vHeight;
varying vec4 vFlower;
varying float vSunVisibility;

#include ../partials/getTerrainLight.glsl
#include ../partials/toLinear.glsl

void main()
{
    vec3 sunDirection = normalize(uSunPosition);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float day = clamp(sunDirection.y * 2.0 + 0.4, 0.0, 1.0);

    // Lit like the ground under it (same light model, mostly the ground normal) so the field
    // and the terrain beyond it match; the blade's own facing adds a little modelling
    vec3 bladeNormal = normalize(vNormal);
    bladeNormal *= sign(dot(bladeNormal, viewDirection) + 1e-4);    // two-sided
    vec3 normal = normalize(mix(vGroundNormal, bladeNormal, 0.35));

    // Roots in the shade of the other blades, tips in the sun
    float shade = mix(0.36, 1.25, smoothstep(0.0, 0.85, vHeight));
    vec3 base = toLinear(vColorBase);
    // flowering blades: petals at the tip
    float petals = vFlower.a * smoothstep(0.4, 0.55, vHeight);
    vec3 albedo = mix(base, toLinear(vFlower.rgb), petals);
    vec3 lit = albedo * shade * (getTerrainLight(normal, sunDirection, vSunVisibility) + getTorchLight(vWorldPosition, normal));
    vec3 sunLight = getSunLight(sunDirection) * vSunVisibility;

    // Sunlight through the blades when looking toward the sun
    float backlight = pow(clamp(dot(- viewDirection, sunDirection), 0.0, 1.0), 3.0);
    lit += base * sunLight * vec3(1.0, 1.0, 0.6) * backlight * vHeight * 0.4;

    // Soft sheen along the upper blade
    vec3 reflected = reflect(- sunDirection, bladeNormal);
    float sheen = pow(max(dot(reflected, viewDirection), 0.0), 10.0);
    lit += sunLight * sheen * 0.02 * vHeight;

    gl_FragColor = vec4(lit, 1.0);
}
