// EZ-Tree trees and bushes, instanced: bark (default) or leaves (LEAVES). Trunks barely
// move, branch tips and leaves sway and flutter in the wind. BAKE renders one tree at the
// origin for the far-distance billboards (TreeImpostors).

uniform float uTime;
uniform vec3 uSunPosition;
uniform sampler2D uNoiseTexture;
uniform float uSway;
uniform vec3 uViewPosition;     // the view's camera (in the shadow pass cameraPosition is the light's)
uniform vec4 uTreeHit;          // a tree just struck with the axe: x, z, when (s), strength
uniform vec2 uTreeHitDirection;
uniform vec4 uFelled[4];        // felled trees: x, z, angle from upright, direction of the fall (Trees.ts)

attribute vec4 aInstance;        // x, y, z, scale (height in metres)
attribute vec2 aInstanceExtra;   // rotation, unused
attribute float aSway;           // 0 trunk base .. 1 branch tips (Trees.ts)
attribute float aAo;             // ambient occlusion: dark inside the crown (Trees.ts)
#ifdef LEAVES
    // level of detail: the leaf cards in a random order (aLeafRank 0..1); farther away the
    // later ones shrink away and the rest grow to keep the crown as full
    attribute vec3 aLeafCenter;
    attribute float aLeafRank;
    uniform vec3 uLeafLod;       // start, end (m from uLodCenter), share of the cards kept from the end on
    uniform vec3 uLodCenter;
    uniform float uShadowCascade;
#endif

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vObjectNormal;
varying vec3 vWorldPosition;
varying float vAo;
varying float vDistance;
#ifndef BAKE
varying vec3 vHaze;
varying float vHazeAmount;
varying float vSunVisibility;
#include ../partials/getSkyLut.glsl
#include ../partials/getAerialFog.glsl
#include ../partials/getClouds.glsl
#endif

vec3 rotateAbout(vec3 v, vec3 axis, float angle)
{
    float c = cos(angle), s = sin(angle);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

void main()
{
    float scale = aInstance.w;
    float c = cos(aInstanceExtra.x), s = sin(aInstanceExtra.x);
    mat2 turn = mat2(c, - s, s, c);

    vec3 local = position;
    #ifdef LEAVES
        float lod = uLeafLod.y > uLeafLod.x ? smoothstep(uLeafLod.x, uLeafLod.y, distance(uLodCenter.xz, aInstance.xz)) : 1.0;
        #ifdef SHADOW
            if (uShadowCascade > 0.5)
                lod = 1.0;          // the wider shadow cascades: the reduced crown
        #endif
        float keep = mix(1.0, uLeafLod.z, lod);
        float grow = (keep > 0.999 ? 1.0 : clamp((keep - aLeafRank) * 25.0, 0.0, 1.0)) * mix(1.0, inversesqrt(uLeafLod.z), lod);
        local = aLeafCenter + (position - aLeafCenter) * grow;
    #endif
    vec3 n = normal;       // leaves: already leaning out of the crown (soft canopy lighting)
    vAo = aAo;
    vObjectNormal = n;

    vec3 p = local * scale;
    p.xz = turn * p.xz;
    n.xz = turn * n.xz;
    vec3 world = p + aInstance.xyz;

    #ifndef BAKE
        vec2 wind = texture2D(uNoiseTexture, aInstance.xz * 0.004 + uTime * 0.02).xy - 0.5;
        float gust = sin(uTime * 1.1 + aInstance.x * 0.05 + aInstance.z * 0.03) * 0.5 + 0.5;
        vec2 sway = (wind * 1.2 + vec2(0.35, 0.15) * gust) * aSway * aSway * uSway * scale;
        #ifdef LEAVES
            sway += sin(uTime * 4.3 + dot(world, vec3(1.7, 2.3, 1.1))) * 0.025 * aSway;
        #endif
        world.xz += sway;
        // struck: the crown shudders, dying away over a couple of seconds
        float hitAge = uTime - uTreeHit.z;
        if (hitAge > 0.0 && hitAge < 3.0 && distance(aInstance.xz, uTreeHit.xy) < 0.6)
            world.xz += uTreeHitDirection * sin(hitAge * 13.0) * exp(- hitAge * 2.2) * uTreeHit.w * aSway * scale * 0.035;
        // felled: the whole tree turns about its foot, toward the way it falls
        for (int i = 0; i < 4; i++) {
            vec4 felled = uFelled[i];
            if (felled.z > 0.0 && distance(aInstance.xz, felled.xy) < 0.05) {
                vec3 axis = vec3(sin(felled.w), 0.0, - cos(felled.w));
                world = aInstance.xyz + rotateAbout(world - aInstance.xyz, axis, felled.z);
                n = rotateAbout(n, axis, felled.z);
            }
        }
    #endif

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

    vUv = uv;
    vNormal = normalize(n);
    vWorldPosition = world;
    vDistance = distance(uViewPosition.xz, aInstance.xz);
    #if !defined(BAKE) && !defined(SHADOW)
        vHazeAmount = getAerialHaze(world, vHaze);
        vSunVisibility = 1.0 - getCloudShadow(world, normalize(uSunPosition));
    #endif
}
