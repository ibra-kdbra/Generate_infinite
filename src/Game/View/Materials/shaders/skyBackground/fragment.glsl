// The sky behind everything, at full resolution: the atmosphere (the per-frame sky texture,
// atmosphere.glsl); a high veil of wispy cirrus streaked along the wind, lit by the sun
// (glowing at sunset); the sun's disc with a soft glow (very bright: it blooms); the moon
// opposite it at night; the Milky Way turning with the stars; then the cumulus clouds in
// front (Clouds.ts: their light and how much of the sky they let through).
uniform sampler2D uClouds;
uniform mat4 uInverseViewProjection;
uniform vec3 uSunPosition;
uniform vec3 uSunLight;
uniform vec3 uMoonLight;
uniform vec3 uSkyLight;
uniform sampler2D uNoiseTexture;
uniform vec3 uCameraPosition;
uniform vec2 uCloudOffset;
uniform vec2 uWindDirection;
uniform float uCirrus;
uniform float uSunSize;
uniform float uMilkyWay;
uniform mat3 uStarRotation;         // world -> the turning star sphere
uniform float uTime;

varying vec2 vUv;

#include ../partials/getSkyLut.glsl

float noise(vec2 p) { return texture2D(uNoiseTexture, p).r; }
float fbm(vec2 p)
{
    return noise(p) * 0.5 + noise(p * 2.03 + 0.17) * 0.25 + noise(p * 4.07 + 0.41) * 0.15 + noise(p * 8.13 + 0.73) * 0.1;
}
// noise on the unit sphere without a seam: three projections blended by the direction
float sphereNoise(vec3 d, float scale)
{
    vec3 w = abs(d);
    w /= w.x + w.y + w.z;
    return fbm(d.yz * scale) * w.x + fbm(d.xz * scale + 0.37) * w.y + fbm(d.xy * scale + 0.71) * w.z;
}

// Cirrus: a thin layer 8 km up, colour and opacity
vec4 cirrus(vec3 direction, vec3 sun)
{
    if (uCirrus < 0.01 || direction.y < 0.0)
        return vec4(0.0);
    float t = 8000.0 / (direction.y + 0.04);
    vec2 p = (uCameraPosition.xz + direction.xz * t + uCloudOffset * 1.8) / 16000.0;
    // streaks: stretched along the wind
    vec2 across = vec2(- uWindDirection.y, uWindDirection.x);
    vec2 q = vec2(dot(p, uWindDirection) * 0.32, dot(p, across) * 1.15);
    float n = fbm(q) * 0.75 + fbm(q * 3.1 + vec2(uTime * 0.0004, 0.0)) * 0.35;
    float density = smoothstep(0.92 - uCirrus * 0.42, 1.12 - uCirrus * 0.3, n) * smoothstep(0.0, 0.12, direction.y) * exp(- t / 120000.0);
    float mu = dot(direction, sun);
    vec3 light = uSunLight * (0.35 + 1.6 * pow(max(mu, 0.0), 6.0)) * 0.55 + uSkyLight * 0.9 + uMoonLight * 0.25;
    return vec4(light, density * 0.6);
}

void main()
{
    vec4 farPoint = uInverseViewProjection * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 direction = normalize(farPoint.xyz / farPoint.w);
    vec3 sun = normalize(uSunPosition);
    float night = smoothstep(0.02, - 0.16, sun.y);

    // below the horizon: seen only past the end of the terrain (from high up), where the
    // ground has faded into the horizon's colour (getAerialFog): the same colour, so the edge
    // never shows
    vec3 color = getSkyLut(vec3(direction.x, max(direction.y, 0.0), direction.z));

    // the Milky Way: a band about the galactic plane, clumpy, split by dark dust lanes
    if (night > 0.0 && uMilkyWay > 0.0 && direction.y > - 0.05) {
        vec3 s = uStarRotation * direction;
        float latitude = dot(s, normalize(vec3(0.3, 0.2, 0.93)));
        float band = exp(- latitude * latitude / 0.018);
        float clumps = sphereNoise(s, 1.4);
        float lanes = smoothstep(0.42, 0.62, sphereNoise(s, 3.2)) * exp(- latitude * latitude / 0.004);
        float glow = band * (0.35 + clumps * 1.1) * (1.0 - lanes * 0.75) + exp(- latitude * latitude / 0.08) * 0.15;
        float horizon = smoothstep(- 0.02, 0.25, direction.y);
        color += vec3(0.72, 0.78, 1.0) * glow * night * horizon * uMilkyWay * 0.022;
    }

    // high cirrus
    vec4 veil = cirrus(direction, sun);
    color = mix(color, veil.rgb, veil.a);

    // the sun: a disc (drawn a little larger than the real half degree, which would be a dot
    // on screen), darker toward its rim, in a soft glow
    float radius = 0.0095 * uSunSize;
    float sunAngle = acos(clamp(dot(direction, sun), - 1.0, 1.0));
    float sunDisc = 1.0 - smoothstep(radius * 0.9, radius, sunAngle);
    if (sunDisc > 0.0) {
        float r = clamp(sunAngle / radius, 0.0, 1.0);
        color += uSunLight * 30.0 * sunDisc * (1.0 - 0.55 * (1.0 - sqrt(1.0 - r * r))) * (1.0 - veil.a * 0.5);
    }
    float mu = max(dot(direction, sun), 0.0);
    color += uSunLight * (pow(mu, 2200.0 / uSunSize) * 1.6 + pow(mu, 120.0) * 0.06);

    // the moon, opposite the sun: pale, with darker seas and craters, darker at its rim
    vec3 moon = - sun;
    float moonAngle = acos(clamp(dot(direction, moon), - 1.0, 1.0));
    float moonVisible = smoothstep(- 0.02, 0.04, moon.y);
    float moonDisc = (1.0 - smoothstep(0.0076, 0.0085, moonAngle)) * moonVisible;
    if (moonDisc > 0.0) {
        vec3 tangent = normalize(cross(moon, vec3(0.0, 1.0, 0.0)));
        vec2 onDisc = vec2(dot(direction - moon, tangent), dot(direction - moon, cross(tangent, moon))) / 0.0085;
        float seas = smoothstep(0.38, 0.62, fbm(onDisc * 0.2 + 0.3));
        float craters = smoothstep(0.55, 0.7, noise(onDisc * 0.9 + 0.11)) * 0.25;
        float rim = sqrt(max(0.0, 1.0 - dot(onDisc, onDisc)));
        color += vec3(0.86, 0.88, 0.94) * 0.95 * mix(0.55, 1.0, seas) * (1.0 - craters) * mix(0.7, 1.0, rim) * moonDisc;
    }
    color += vec3(0.6, 0.66, 0.82) * pow(max(dot(direction, moon), 0.0), 900.0) * 0.06 * moonVisible * night;

    vec4 clouds = texture2D(uClouds, vUv);
    gl_FragColor = vec4(color * clouds.a + clouds.rgb, 1.0);
}
