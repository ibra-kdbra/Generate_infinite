// Photo-scanned boulders: the scan's colour and normal map (roughness in its blue channel),
// lit like the land (sun, sky, bounce, shadows) with a glossy sun highlight where the stone
// is smooth, darker where it meets the soil.

uniform vec3 uSunPosition;
uniform sampler2D uMap;
uniform sampler2D uNormalMap;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vBase;
varying float vTint;
varying vec3 vHaze;
varying float vHazeAmount;
varying float vSunVisibility;

#include ../partials/getTerrainLight.glsl
#include ../partials/toLinear.glsl
#include ../partials/getSunShadow.glsl

// Normal map without stored tangents (cotangent frame from screen derivatives)
vec3 perturb(vec3 normal, vec3 position, vec2 uv, vec3 mapped)
{
    vec3 dp1 = dFdx(position), dp2 = dFdy(position);
    vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
    vec3 dp2perp = cross(dp2, normal), dp1perp = cross(normal, dp1);
    vec3 t = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 b = dp2perp * duv1.y + dp1perp * duv2.y;
    float invmax = inversesqrt(max(dot(t, t), dot(b, b)));
    return normalize(mat3(t * invmax, b * invmax, normal) * mapped);
}

void main()
{
    #ifdef SHADOW
        gl_FragColor = vec4(1.0);       // depth only (Shadows.ts)
        return;
    #endif

    vec3 sunDirection = normalize(uSunPosition);
    vec3 toEye = normalize(cameraPosition - vWorldPosition);

    vec3 albedo = toLinear(texture2D(uMap, vUv).rgb) * mix(0.82, 1.12, vTint);
    vec4 packed = texture2D(uNormalMap, vUv);
    // OpenGL-style normal map, sampled with glTF's downward v: green flips
    vec2 xy = vec2(packed.x, 1.0 - packed.y) * 2.0 - 1.0;
    vec3 geometric = normalize(vNormal);
    vec3 normal = perturb(geometric, vWorldPosition, vUv, vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy)))));
    float roughness = clamp(packed.b, 0.25, 1.0);

    float sunVisibility = vSunVisibility * getSunShadow(vWorldPosition, geometric, sunDirection);
    // where the stone meets the ground: soil and shade
    float contact = smoothstep(0.0, 0.3, vBase);
    vec3 lit = albedo * getTerrainLight(normal, sunDirection, sunVisibility) * mix(0.5, 1.0, contact);

    // sun highlight (GGX)
    vec3 halfway = normalize(sunDirection + toEye);
    float nl = max(dot(normal, sunDirection), 0.0);
    float nv = max(dot(normal, toEye), 1e-3);
    float nh = max(dot(normal, halfway), 0.0);
    float a = roughness * roughness;
    float a2 = a * a;
    float d = a2 / (3.14159265 * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
    float k = a * 0.5;
    float g = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
    float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(halfway, toEye), 0.0), 5.0);
    lit += uSunLight * 3.14159265 * d * g * fresnel / (4.0 * nv) * sunVisibility;

    lit = mix(lit, vHaze, vHazeAmount);
    gl_FragColor = vec4(lit, 1.0);
}
