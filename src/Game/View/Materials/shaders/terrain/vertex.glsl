uniform vec3 uPlayerPosition;
uniform float uLightnessSmoothness;
uniform float uFresnelOffset;
uniform float uFresnelScale;
uniform float uFresnelPower;
uniform vec3 uSunPosition;
uniform float uGrassDistance;
uniform sampler2D uTexture;
uniform float uTextureSize;
uniform sampler2D uGradientTexture;
uniform float uElevationMin;
uniform float uElevationMax;
uniform sampler2D uFogTexture;

varying vec3 vColor;

#include ../partials/inverseLerp.glsl
#include ../partials/remap.glsl
#include ../partials/getSunShade.glsl;
#include ../partials/getSunShadeColor.glsl;
#include ../partials/getSunReflection.glsl;
#include ../partials/getSunReflectionColor.glsl;
#include ../partials/getFogColor.glsl;
#include ../partials/getGrassAttenuation.glsl;

void main()
{
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    float depth = - viewPosition.z;
    gl_Position = projectionMatrix * viewPosition;

    // Terrain data (Manual bilinear filtering)
    // Align to grid points (0 to size-1)
    vec2 texelUv = uv * (uTextureSize - 1.0);
    vec2 gridUv = floor(texelUv);
    vec2 lerpUv = fract(texelUv);

    // Sample at pixel centers (+0.5)
    vec4 terrainData00 = texture2D(uTexture, (gridUv + vec2(0.5, 0.5)) / uTextureSize);
    vec4 terrainData10 = texture2D(uTexture, (gridUv + vec2(1.5, 0.5)) / uTextureSize);
    vec4 terrainData01 = texture2D(uTexture, (gridUv + vec2(0.5, 1.5)) / uTextureSize);
    vec4 terrainData11 = texture2D(uTexture, (gridUv + vec2(1.5, 1.5)) / uTextureSize);

    vec4 terrainData = mix(
        mix(terrainData00, terrainData10, lerpUv.x),
        mix(terrainData01, terrainData11, lerpUv.x),
        lerpUv.y
    );

    vec3 normal = vec3(terrainData.r, terrainData.g, sqrt(max(0.0, 1.0 - terrainData.r * terrainData.r - terrainData.g * terrainData.g)));
    float elevation = terrainData.a;

    // Slope
    float slope = 1.0 - abs(dot(vec3(0.0, 1.0, 0.0), normal));

    vec3 viewDirection = normalize(modelPosition.xyz - cameraPosition);
    vec3 worldNormal = normalize(mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz) * normal);
    vec3 viewNormal = normalize(normalMatrix * normal);

    // Color
    float elevationRatio = remap(elevation, uElevationMin, uElevationMax, 0.0, 1.0);
    vec3 gradientColor = texture2D(uGradientTexture, vec2(0.5, elevationRatio)).rgb;

    vec3 uGrassDefaultColor = vec3(0.52, 0.65, 0.26);
    vec3 uGrassShadedColor = vec3(0.52 / 1.3, 0.65 / 1.3, 0.26 / 1.3);
    
    // Grass distance attenuation
    // Terrain must match the bottom of the grass which is darker
    float grassDistanceAttenuation = getGrassAttenuation(modelPosition.xz);
    float grassSlopeAttenuation = smoothstep(remap(slope, 0.4, 0.5, 1.0, 0.0), 0.0, 1.0);
    float grassAttenuation = grassDistanceAttenuation * grassSlopeAttenuation;
    vec3 grassColor = mix(uGrassShadedColor, uGrassDefaultColor, 1.0 - grassAttenuation);

    vec3 color = mix(gradientColor, grassColor, grassAttenuation);

    // Sun shade
    float sunShade = getSunShade(normal);
    color = getSunShadeColor(color, sunShade);

    // Sun reflection
    float sunReflection = getSunReflection(viewDirection, worldNormal, viewNormal);
    color = getSunReflectionColor(color, sunReflection);

    // Fog
    vec2 screenUv = (gl_Position.xy / gl_Position.w * 0.5) + 0.5;
    color = getFogColor(color, depth, screenUv);

    // vec3 dirtColor = vec3(0.3, 0.2, 0.1);
    // vec3 color = mix(dirtColor, grassColor, terrainData.g);

    // Varyings
    vColor = color;
}
