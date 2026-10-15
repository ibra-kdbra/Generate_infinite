uniform sampler2D uTexture;
uniform float uTextureSize;
uniform vec3 uSunPosition;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vGrassDensity;
varying float vDepth;
varying vec3 vHaze;
varying float vHazeAmount;
varying float vCloudShadow;

#include ../partials/getSkyLut.glsl
#include ../partials/getAerialFog.glsl
uniform sampler2D uNoiseTexture;
#include ../partials/getClouds.glsl

void main()
{
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    gl_Position = projectionMatrix * viewPosition;

    // Terrain data: every vertex sits exactly on a texel of its chunk's data texture
    vec2 texel = floor(uv * (uTextureSize - 1.0) + 0.5);
    vec4 terrainData = texture2D(uTexture, (texel + 0.5) / uTextureSize);

    // r, g = horizontal normal (x, z); up is rebuilt (always >= 0 on a heightmap)
    vNormal = vec3(terrainData.r, sqrt(max(0.0, 1.0 - terrainData.r * terrainData.r - terrainData.g * terrainData.g)), terrainData.g);
    vGrassDensity = terrainData.b;
    vWorldPosition = modelPosition.xyz;
    vDepth = - viewPosition.z;

    // Aerial haze changes slowly across the ground: evaluated per vertex (cheaper than per
    // pixel at any real resolution)
    vHazeAmount = getAerialHaze(modelPosition.xyz, vHaze);
    // cloud shadows are hundreds of metres across: per vertex is plenty
    vCloudShadow = getCloudShadow(modelPosition.xyz, normalize(uSunPosition));
}
