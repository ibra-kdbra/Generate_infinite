precision mediump float;

#define M_PI 3.1415926535897932384626433832795

uniform float uTime;
uniform float uGrassDistance;
uniform vec3 uPlayerPosition;
uniform float uTerrainSize;
uniform float uTerrainTextureSize;
uniform sampler2D uTerrainATexture;
uniform vec2 uTerrainAOffset;
uniform sampler2D uTerrainBTexture;
uniform vec2 uTerrainBOffset;
uniform sampler2D uTerrainCTexture;
uniform vec2 uTerrainCOffset;
uniform sampler2D uTerrainDTexture;
uniform vec2 uTerrainDOffset;
uniform sampler2D uNoiseTexture;
uniform float uFresnelOffset;
uniform float uFresnelScale;
uniform float uFresnelPower;
uniform vec3 uSunPosition;

attribute vec2 center;
// attribute float tipness;

varying vec3 vColor;

#include ../partials/inverseLerp.glsl
#include ../partials/remap.glsl
#include ../partials/getSunShade.glsl;
#include ../partials/getSunShadeColor.glsl;
#include ../partials/getSunReflection.glsl;
#include ../partials/getSunReflectionColor.glsl;
#include ../partials/getGrassAttenuation.glsl;
#include ../partials/getRotatePivot2d.glsl;

void main()
{
    // Recalculate center and keep around player
    vec2 newCenter = center;
    newCenter -= uPlayerPosition.xz;
    float halfSize = uGrassDistance * 0.5;
    newCenter.x = mod(newCenter.x + halfSize, uGrassDistance) - halfSize;
    newCenter.y = mod(newCenter.y + halfSize, uGrassDistance) - halfSize; // Y considered as Z
    vec4 modelCenter = modelMatrix * vec4(newCenter.x, 0.0, newCenter.y, 1.0);

    // Move grass to center
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    modelPosition.xz += newCenter; // Y considered as Z

    // Rotate blade to face camera
    float angleToCamera = atan(modelCenter.x - cameraPosition.x, modelCenter.z - cameraPosition.z);
    modelPosition.xz = getRotatePivot2d(modelPosition.xz, angleToCamera, modelCenter.xz);

    // Terrains data (Manual bilinear filtering)
    vec2 terrainAUv = (modelPosition.xz - uTerrainAOffset.xy) / uTerrainSize;
    vec2 terrainBUv = (modelPosition.xz - uTerrainBOffset.xy) / uTerrainSize;
    vec2 terrainCUv = (modelPosition.xz - uTerrainCOffset.xy) / uTerrainSize;
    vec2 terrainDUv = (modelPosition.xz - uTerrainDOffset.xy) / uTerrainSize;

    vec4 terrainAData = vec4(0);
    vec2 texelAUv = terrainAUv * (uTerrainTextureSize - 1.0);
    vec2 gridAUv = floor(texelAUv);
    vec2 lerpAUv = fract(texelAUv);
    terrainAData = mix(
        mix(texture2D(uTerrainATexture, (gridAUv + vec2(0.5, 0.5)) / uTerrainTextureSize), texture2D(uTerrainATexture, (gridAUv + vec2(1.5, 0.5)) / uTerrainTextureSize), lerpAUv.x),
        mix(texture2D(uTerrainATexture, (gridAUv + vec2(0.5, 1.5)) / uTerrainTextureSize), texture2D(uTerrainATexture, (gridAUv + vec2(1.5, 1.5)) / uTerrainTextureSize), lerpAUv.x),
        lerpAUv.y
    );

    vec4 terrainBData = vec4(0);
    vec2 texelBUv = terrainBUv * (uTerrainTextureSize - 1.0);
    vec2 gridBUv = floor(texelBUv);
    vec2 lerpBUv = fract(texelBUv);
    terrainBData = mix(
        mix(texture2D(uTerrainBTexture, (gridBUv + vec2(0.5, 0.5)) / uTerrainTextureSize), texture2D(uTerrainBTexture, (gridBUv + vec2(1.5, 0.5)) / uTerrainTextureSize), lerpBUv.x),
        mix(texture2D(uTerrainBTexture, (gridBUv + vec2(0.5, 1.5)) / uTerrainTextureSize), texture2D(uTerrainBTexture, (gridBUv + vec2(1.5, 1.5)) / uTerrainTextureSize), lerpBUv.x),
        lerpBUv.y
    );

    vec4 terrainCData = vec4(0);
    vec2 texelCUv = terrainCUv * (uTerrainTextureSize - 1.0);
    vec2 gridCUv = floor(texelCUv);
    vec2 lerpCUv = fract(texelCUv);
    terrainCData = mix(
        mix(texture2D(uTerrainCTexture, (gridCUv + vec2(0.5, 0.5)) / uTerrainTextureSize), texture2D(uTerrainCTexture, (gridCUv + vec2(1.5, 0.5)) / uTerrainTextureSize), lerpCUv.x),
        mix(texture2D(uTerrainCTexture, (gridCUv + vec2(0.5, 1.5)) / uTerrainTextureSize), texture2D(uTerrainCTexture, (gridCUv + vec2(1.5, 1.5)) / uTerrainTextureSize), lerpCUv.x),
        lerpCUv.y
    );

    vec4 terrainDData = vec4(0);
    vec2 texelDUv = terrainDUv * (uTerrainTextureSize - 1.0);
    vec2 gridDUv = floor(texelDUv);
    vec2 lerpDUv = fract(texelDUv);
    terrainDData = mix(
        mix(texture2D(uTerrainDTexture, (gridDUv + vec2(0.5, 0.5)) / uTerrainTextureSize), texture2D(uTerrainDTexture, (gridDUv + vec2(1.5, 0.5)) / uTerrainTextureSize), lerpDUv.x),
        mix(texture2D(uTerrainDTexture, (gridDUv + vec2(0.5, 1.5)) / uTerrainTextureSize), texture2D(uTerrainDTexture, (gridDUv + vec2(1.5, 1.5)) / uTerrainTextureSize), lerpDUv.x),
        lerpDUv.y
    );

    float weightA = step(-0.01, terrainAUv.x) * step(terrainAUv.x, 1.01) * step(-0.01, terrainAUv.y) * step(terrainAUv.y, 1.01);
    float weightB = step(-0.01, terrainBUv.x) * step(terrainBUv.x, 1.01) * step(-0.01, terrainBUv.y) * step(terrainBUv.y, 1.01);
    float weightC = step(-0.01, terrainCUv.x) * step(terrainCUv.x, 1.01) * step(-0.01, terrainCUv.y) * step(terrainCUv.y, 1.01);
    float weightD = step(-0.01, terrainDUv.x) * step(terrainDUv.x, 1.01) * step(-0.01, terrainDUv.y) * step(terrainDUv.y, 1.01);

    vec4 terrainData = (terrainAData * weightA + terrainBData * weightB + terrainCData * weightC + terrainDData * weightD) / max(1.0, weightA + weightB + weightC + weightD);

    vec3 normal = vec3(terrainData.r, terrainData.g, sqrt(max(0.0, 1.0 - terrainData.r * terrainData.r - terrainData.g * terrainData.g)));
    float grassDensity = terrainData.b;
    float elevation = terrainData.a;

    modelPosition.y += elevation;
    modelCenter.y += elevation;

    // Slope
    float slope = 1.0 - abs(dot(vec3(0.0, 1.0, 0.0), normal));

    // Attenuation
    float distanceScale = getGrassAttenuation(modelCenter.xz);
    // Relax slope constraint (0.4/0.5 -> 0.6/0.7) to allow grass on steeper hills
    float slopeScale = smoothstep(remap(slope, 0.6, 0.7, 1.0, 0.0), 0.0, 1.0);
    float scale = distanceScale * slopeScale * grassDensity; // Apply grass density from noise
    modelPosition.xyz = mix(modelCenter.xyz, modelPosition.xyz, scale);

    // Tipness
    float tipness = step(2.0, mod(float(gl_VertexID) + 1.0, 3.0));

    // Wind
    vec2 noiseUvA = modelPosition.xz * 0.01 + uTime * 0.03;
    vec2 noiseUvB = modelPosition.xz * 0.05 + uTime * 0.1;
    vec4 noiseColorA = texture2D(uNoiseTexture, noiseUvA);
    vec4 noiseColorB = texture2D(uNoiseTexture, noiseUvB);
    
    float windX = (noiseColorA.x - 0.5) + (noiseColorB.x - 0.5) * 0.3;
    float windZ = (noiseColorA.y - 0.5) + (noiseColorB.y - 0.5) * 0.3;
    
    modelPosition.x += windX * tipness * scale;
    modelPosition.z += windZ * tipness * scale;

    // Final position
    vec4 viewPosition = viewMatrix * modelPosition;
    gl_Position = projectionMatrix * viewPosition;
    
    vec3 viewDirection = normalize(modelPosition.xyz - cameraPosition);
    // vec3 normal = vec3(0.0, 1.0, 0.0);
    vec3 worldNormal = normalize(mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz) * normal);
    vec3 viewNormal = normalize(normalMatrix * normal);

    // Grass color
    // Noise for color variation
    float colorNoise = texture2D(uNoiseTexture, modelPosition.xz * 0.01).r;
    vec3 uGrassDefaultColor = vec3(0.52, 0.65, 0.26);
    vec3 uGrassVariantColor = vec3(0.52 + 0.1, 0.65 + 0.05, 0.26 - 0.1); // Slightly yellower
    uGrassDefaultColor = mix(uGrassDefaultColor, uGrassVariantColor, colorNoise);

    vec3 uGrassShadedColor = uGrassDefaultColor / 1.3;
    
    vec3 lowColor = mix(uGrassShadedColor, uGrassDefaultColor, 1.0 - scale); // Match the terrain
    vec3 color = mix(lowColor, uGrassDefaultColor, tipness);

    // Sun shade
    float sunShade = getSunShade(normal);
    color = getSunShadeColor(color, sunShade);

    // Sun reflection
    float sunReflection = getSunReflection(viewDirection, worldNormal, viewNormal);
    color = getSunReflectionColor(color, sunReflection);

    // Translucency (fake backlight)
    float backlight = max(0.0, dot(viewDirection, -uSunPosition));
    color += uGrassDefaultColor * backlight * 0.4 * tipness * sunShade;

    vColor = color;
    // vColor = vec3(slope);
}
