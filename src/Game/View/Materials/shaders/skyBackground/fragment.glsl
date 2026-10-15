// The sky behind everything, at full resolution: the atmosphere (the per-frame sky texture,
// atmosphere.glsl), the sun's disc (very bright: it blooms, reddened through the air at
// sunset), the moon opposite it at night, and the clouds in front (Clouds.ts: their light
// and how much of the sky they let through).
uniform sampler2D uClouds;
uniform mat4 uInverseViewProjection;
uniform vec3 uSunPosition;
uniform vec3 uSunLight;
uniform sampler2D uNoiseTexture;

varying vec2 vUv;

#include ../partials/getSkyLut.glsl

void main()
{
    vec4 farPoint = uInverseViewProjection * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 direction = normalize(farPoint.xyz / farPoint.w);
    vec3 sun = normalize(uSunPosition);

    // below the horizon (seldom seen past the terrain) the horizon's colour, darkening
    vec3 color = getSkyLut(vec3(direction.x, max(direction.y, 0.0), direction.z)) * (1.0 - smoothstep(0.0, - 0.25, direction.y) * 0.6);

    // the sun: a disc (drawn a little larger than the real half degree, which would be a dot
    // on screen), darker toward its rim
    float sunAngle = acos(clamp(dot(direction, sun), - 1.0, 1.0));
    float sunDisc = 1.0 - smoothstep(0.0085, 0.0095, sunAngle);
    if (sunDisc > 0.0) {
        float r = clamp(sunAngle / 0.0095, 0.0, 1.0);
        color += uSunLight * 30.0 * sunDisc * (1.0 - 0.55 * (1.0 - sqrt(1.0 - r * r)));
    }
    // the moon, opposite the sun: pale, with darker seas
    vec3 moon = - sun;
    float moonAngle = acos(clamp(dot(direction, moon), - 1.0, 1.0));
    float moonDisc = (1.0 - smoothstep(0.0075, 0.0085, moonAngle)) * smoothstep(- 0.02, 0.04, moon.y);
    if (moonDisc > 0.0) {
        vec3 tangent = normalize(cross(moon, vec3(0.0, 1.0, 0.0)));
        vec2 onDisc = vec2(dot(direction - moon, tangent), dot(direction - moon, cross(tangent, moon))) / 0.0085;
        float seas = texture2D(uNoiseTexture, onDisc * 0.18 + 0.3).r;
        color += vec3(0.85, 0.88, 0.95) * 0.9 * mix(0.6, 1.0, smoothstep(0.35, 0.65, seas)) * moonDisc;
    }

    vec4 clouds = texture2D(uClouds, vUv);
    gl_FragColor = vec4(color * clouds.a + clouds.rgb, 1.0);
}
