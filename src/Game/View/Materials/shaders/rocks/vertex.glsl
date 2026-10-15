// Photo-scanned boulders (View/Vegetation.ts, tools/nature/build.mjs), instanced: placed,
// turned and scaled per instance; hazed and cloud-shadowed like the ground around them.

uniform vec3 uSunPosition;

attribute vec4 aInstance;        // x, y, z, scale (metres across)
attribute vec2 aInstanceExtra;   // rotation, tint

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vBase;             // height above the rock's base (m)
varying float vTint;
varying vec3 vHaze;
varying float vHazeAmount;
varying float vSunVisibility;

#include ../partials/getSkyLut.glsl
#include ../partials/getAerialFog.glsl
#include ../partials/getClouds.glsl

void main()
{
    float scale = aInstance.w;
    float c = cos(aInstanceExtra.x), s = sin(aInstanceExtra.x);
    mat2 turn = mat2(c, - s, s, c);
    vec3 p = position * scale;
    p.xz = turn * p.xz;
    vec3 n = normal;
    n.xz = turn * n.xz;
    vec3 world = p + aInstance.xyz;

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

    vUv = uv;
    vNormal = n;
    vWorldPosition = world;
    vBase = p.y;
    vTint = aInstanceExtra.y;
    #ifndef SHADOW
        vHazeAmount = getAerialHaze(world, vHaze);
        vSunVisibility = 1.0 - getCloudShadow(world, normalize(uSunPosition));
    #endif
}
