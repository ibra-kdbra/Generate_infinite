uniform vec3 uSunPosition;
uniform sampler2D uNoiseTexture;
uniform vec3 uColorA;          // tint 0 .. 1
uniform vec3 uColorB;
uniform vec3 uBark;
uniform float uRock;
uniform float uTranslucency;
uniform sampler2DArray uGroundAlbedo;   // the terrain's photo-scanned textures (rock = layer 2)
uniform vec3 uGroundMeans[6];
uniform float uGroundReady;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vShape;
varying float vTint;
varying vec3 vHaze;
varying float vHazeAmount;
varying float vSunVisibility;

#include ../partials/getTerrainLight.glsl
#include ../partials/toLinear.glsl
#include ../partials/getSunShadow.glsl

void main()
{
    #ifdef SHADOW
        gl_FragColor = vec4(1.0);       // depth only (Shadows.ts)
        return;
    #endif
    vec3 normal = normalize(vNormal);
    vec3 sunDirection = normalize(uSunPosition);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float day = clamp(sunDirection.y * 2.0 + 0.4, 0.0, 1.0);

    vec3 albedo = mix(uColorA, uColorB, vTint);
    // leafy / grainy breakup so masses don't look like smooth plastic
    float grain = texture2D(uNoiseTexture, vWorldPosition.xz * 0.37 + vWorldPosition.y * 0.21).r;
    albedo *= 0.82 + grain * 0.36;
    if (uRock > 0.5) {
        // the cliffs' stone, projected three ways, toned grey, faded out with distance
        float textured = uGroundReady * (1.0 - smoothstep(60.0, 160.0, distance(cameraPosition, vWorldPosition)));
        if (textured > 0.0) {
            vec3 w = pow(abs(normal), vec3(4.0));
            w /= w.x + w.y + w.z;
            vec3 stone = texture(uGroundAlbedo, vec3(vWorldPosition.zy / 3.0, 2.0)).rgb * w.x
                       + texture(uGroundAlbedo, vec3(vWorldPosition.xz / 3.0, 2.0)).rgb * w.y
                       + texture(uGroundAlbedo, vec3(vWorldPosition.xy / 3.0, 2.0)).rgb * w.z;
            stone /= uGroundMeans[2];
            float luma = dot(stone, vec3(0.3, 0.59, 0.11));
            albedo *= mix(vec3(1.0), mix(vec3(luma), stone, 0.3), 0.9 * textured);
        }
        albedo = mix(albedo, vec3(0.2, 0.26, 0.12), smoothstep(0.55, 0.9, normal.y) * 0.55 * vTint);   // moss on top
    }
    albedo = mix(albedo, uBark, vShape.y);

    albedo = toLinear(albedo);
    float sunVisibility = vSunVisibility * getSunShadow(vWorldPosition, normal, sunDirection);
    vec3 lit = albedo * vShape.x * getTerrainLight(normal, sunDirection, sunVisibility);

    // sunlight through the leaves when looking toward the sun
    float back = pow(clamp(dot(- viewDirection, sunDirection), 0.0, 1.0), 4.0) * uTranslucency * (1.0 - vShape.y);
    lit += albedo * getSunLight(sunDirection) * vec3(1.0, 1.0, 0.55) * back * 0.4 * sunVisibility;

    lit = mix(lit, vHaze, vHazeAmount);
    gl_FragColor = vec4(lit, 1.0);
}
