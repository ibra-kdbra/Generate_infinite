// EZ-Tree trees and bushes, instanced: bark (default) or leaves (LEAVES). Trunks barely
// move, branch tips and leaves sway and flutter in the wind. BAKE renders one tree at the
// origin for the far-distance billboards (TreeImpostors).

uniform float uTime;
uniform vec3 uSunPosition;
uniform sampler2D uNoiseTexture;
uniform float uSway;

attribute vec4 aInstance;        // x, y, z, scale (height in metres)
attribute vec2 aInstanceExtra;   // rotation, unused
attribute float aSway;           // 0 trunk base .. 1 branch tips (Trees.ts)
attribute float aAo;             // ambient occlusion: dark inside the crown (Trees.ts)

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

void main()
{
    float scale = aInstance.w;
    float c = cos(aInstanceExtra.x), s = sin(aInstanceExtra.x);
    mat2 turn = mat2(c, - s, s, c);

    vec3 local = position;
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
    #endif

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

    vUv = uv;
    vNormal = normalize(n);
    vWorldPosition = world;
    vDistance = distance(cameraPosition.xz, aInstance.xz);
    #ifndef BAKE
        vHazeAmount = getAerialHaze(world, vHaze);
        vSunVisibility = 1.0 - getCloudShadow(world, normalize(uSunPosition));
    #endif
}
