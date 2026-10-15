uniform vec3 uSunPosition;
uniform sampler2D uAlbedoAtlas;      // views across, variants down
uniform sampler2D uNormalAtlas;
uniform float uVariants;
uniform vec2 uFade;                  // takes over from the near trees between these distances
uniform float uTranslucency;

varying vec2 vUv;
varying float vFrame;
varying float vVariant;
varying float vRotation;
varying float vDistance;
varying vec3 vWorldPosition;
varying vec3 vHaze;
varying float vHazeAmount;
varying float vSunVisibility;

#include ../partials/getTerrainLight.glsl
#include ../partials/toLinear.glsl

float dither(vec2 pixel) { return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715)))); }

vec2 atlasUv(float frame)
{
    return vec2((mod(frame, 8.0) + vUv.x) / 8.0, (vVariant + vUv.y) / uVariants);
}

void main()
{
    if (dither(gl_FragCoord.xy) > smoothstep(uFade.x, uFade.y, vDistance))
        discard;

    // blend the two nearest baked views
    float frameA = floor(vFrame);
    float t = vFrame - frameA;
    vec4 albedoA = texture2D(uAlbedoAtlas, atlasUv(frameA));
    vec4 albedoB = texture2D(uAlbedoAtlas, atlasUv(frameA + 1.0));
    vec4 albedo = mix(albedoA, albedoB, t);
    if (albedo.a < 0.5)
        discard;
    vec3 normal = normalize(mix(texture2D(uNormalAtlas, atlasUv(frameA)).xyz, texture2D(uNormalAtlas, atlasUv(frameA + 1.0)).xyz, t) * 2.0 - 1.0);
    float c = cos(vRotation), s = sin(vRotation);
    normal.xz = mat2(c, - s, s, c) * normal.xz;

    vec3 sunDirection = normalize(uSunPosition);
    vec3 color = toLinear(albedo.rgb);       // the atlas holds display colours
    vec3 lit = color * getTerrainLight(normal, sunDirection, vSunVisibility);
    vec3 toEye = normalize(cameraPosition - vWorldPosition);
    float back = pow(clamp(dot(- toEye, sunDirection), 0.0, 1.0), 4.0);
    lit += color * getSunLight(sunDirection) * vec3(1.0, 1.0, 0.6) * back * uTranslucency * 0.7 * vSunVisibility;
    lit = mix(lit, vHaze, vHazeAmount);
    gl_FragColor = vec4(lit, 1.0);
}
