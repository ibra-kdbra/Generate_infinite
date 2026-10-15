// Instanced trees, bushes and rocks: placed, turned and scaled per instance, swaying in the
// wind with their tips, hazed and cloud-shadowed like the ground around them.

uniform float uTime;
uniform vec3 uSunPosition;
uniform sampler2D uNoiseTexture;
uniform float uSway;
uniform float uRock;

attribute vec3 aShape;           // ambient occlusion, bark, sway weight (VegetationModels.ts)
attribute vec4 aInstance;        // x, y, z, scale
attribute vec2 aInstanceExtra;   // rotation, tint

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vShape;
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
    float rotation = aInstanceExtra.x;
    float tint = aInstanceExtra.y;

    // rocks: every boulder a different shape from the one mesh
    vec3 stretch = uRock > 0.5 ? vec3(1.0 + tint * 0.5, 0.7 + fract(tint * 7.13) * 0.55, 1.0 - tint * 0.25) : vec3(1.0);
    vec3 p = position * stretch * scale;
    float c = cos(rotation), s = sin(rotation);
    mat2 turn = mat2(c, - s, s, c);
    p.xz = turn * p.xz;
    vec3 n = normal / stretch;
    n.xz = turn * n.xz;

    vec3 world = p + aInstance.xyz;

    // wind: a slow sway that differs from tree to tree, plus rolling gusts
    vec2 wind = texture2D(uNoiseTexture, aInstance.xz * 0.004 + uTime * 0.02).xy - 0.5;
    float gust = sin(uTime * 1.1 + aInstance.x * 0.05 + aInstance.z * 0.03) * 0.5 + 0.5;
    float flutter = sin(uTime * 3.7 + dot(world, vec3(1.3, 2.1, 1.7))) * 0.15;
    world.xz += (wind * 1.2 + vec2(0.35, 0.15) * gust + flutter) * aShape.z * aShape.z * uSway * scale;

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

    vNormal = normalize(n);
    vWorldPosition = world;
    vShape = aShape;
    vTint = tint;
    vHazeAmount = getAerialHaze(world, vHaze);
    vSunVisibility = 1.0 - getCloudShadow(world, normalize(uSunPosition));
}
