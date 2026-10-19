uniform vec3 uSunPosition;
uniform sampler2D uMap;          // bark colour / leaf colour + alpha
uniform sampler2D uNormalMap;    // bark only
uniform vec3 uTint;
uniform vec2 uFade;              // hand over to the billboards between these distances
uniform float uTranslucency;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vObjectNormal;
varying vec3 vWorldPosition;
varying float vAo;
varying float vFellCut;
varying float vDistance;
#ifndef BAKE
varying vec3 vHaze;
varying float vHazeAmount;
varying float vSunVisibility;
#include ../partials/getTerrainLight.glsl
#include ../partials/toLinear.glsl
#include ../partials/getSunShadow.glsl
#endif

float dither(vec2 pixel) { return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715)))); }

#include ../partials/perturbNormal.glsl

void main()
{
    // a felled tree: below the cut is the stump
    if (vFellCut < 0.0)
        discard;

    #ifdef SHADOW
        // depth only (Shadows.ts): the near trees cast up to the middle of the hand-over band,
        // the billboards beyond it
        if (vDistance > (uFade.x + uFade.y) * 0.5)
            discard;
        #ifdef LEAVES
            if (texture2D(uMap, vUv).a < 0.5)
                discard;
        #endif
        gl_FragColor = vec4(1.0);
        return;
    #endif
    #if !defined(BAKE)
        // dithered hand-over to the billboard version farther away
        if (dither(gl_FragCoord.xy) < smoothstep(uFade.x, uFade.y, vDistance))
            discard;
    #endif

    vec4 color = texture2D(uMap, vUv);
    #ifdef LEAVES
        if (color.a < 0.5)
            discard;
    #endif
    vec3 albedo = color.rgb * uTint * vAo;

    vec3 normal = normalize(vNormal);
    #ifndef LEAVES
        normal = perturb(normal, vWorldPosition, vUv, texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0);
    #endif

    #ifdef BAKE_ALBEDO
        gl_FragColor = vec4(albedo, 1.0);
    #elif defined(BAKE_NORMAL)
        gl_FragColor = vec4(normalize(vObjectNormal) * 0.5 + 0.5, 1.0);
    #else
        vec3 sunDirection = normalize(uSunPosition);
        albedo = toLinear(albedo);
        // in the leaves' shade (and the crown's own: dark inside, lit at the edges)
        float sunVisibility = vSunVisibility * getSunShadow(vWorldPosition, normal, sunDirection);
        vec3 lit = albedo * (getTerrainLight(normal, sunDirection, sunVisibility) + getTorchLight(vWorldPosition, normal));
        #ifdef LEAVES
            // sunlight through the leaves (lit leaves glow, shaded ones less so)
            vec3 toEye = normalize(cameraPosition - vWorldPosition);
            float back = pow(clamp(dot(- toEye, sunDirection), 0.0, 1.0), 4.0);
            lit += albedo * getSunLight(sunDirection) * vec3(1.0, 1.0, 0.6) * back * uTranslucency * 0.7 * mix(0.25, 1.0, sunVisibility) * vSunVisibility;
        #endif
        lit = mix(lit, vHaze, vHazeAmount);
        gl_FragColor = vec4(lit, 1.0);
    #endif
}
