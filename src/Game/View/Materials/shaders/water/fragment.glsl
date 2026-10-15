// Lake surface: the sky reflected with Fresnel (glassy from above, mirror-like at grazing
// angles), sun glitter on small ripples. The terrain under it is already tinted by the water
// depth (terrain fragment shader), so the surface only adds reflected light: it is drawn
// premultiplied, colour = reflection, alpha = Fresnel (how much of the bed it hides).

uniform vec3 uSunPosition;
uniform float uTime;
uniform sampler2D uNoiseTexture;
uniform vec4 uRipples[RIPPLE_COUNT];   // x, z, start time, strength (0 = unused)

varying vec3 vWorldPosition;

#include ../partials/getSkyLut.glsl
#include ../partials/getAerialFog.glsl
#include ../partials/getClouds.glsl
#include ../partials/toLinear.glsl
#include ../partials/getTerrainLight.glsl

void main()
{
    vec2 p = vWorldPosition.xz;
    vec3 toCamera = cameraPosition - vWorldPosition;
    float dist = length(toCamera);
    vec3 viewDirection = toCamera / dist;

    // Ripples: two noise layers drifting in different directions, calmer in the distance
    float rippleFade = 1.0 - smoothstep(25.0, 260.0, dist);
    vec2 n1 = texture2D(uNoiseTexture, p * 0.031 + uTime * vec2(0.011, 0.006)).rg - 0.5;
    vec2 n2 = texture2D(uNoiseTexture, p * 0.097 - uTime * vec2(0.008, 0.015)).gb - 0.5;
    vec2 slope = (n1 * 0.6 + n2 * 0.4) * mix(0.06, 0.32, rippleFade);

    // Rings spreading from the swimmer (strokes, wading, splashes): a short wave train
    // travelling outward, weakening as it spreads; a little foam where they start
    float foam = 0.0;
    for (int i = 0; i < RIPPLE_COUNT; i++) {
        vec4 ripple = uRipples[i];
        float age = uTime - ripple.z;
        if (ripple.w <= 0.0 || age < 0.0 || age > 4.0)
            continue;
        vec2 away = p - ripple.xy;
        float d = length(away) + 1e-4;
        float radius = 0.25 + age * 1.5;
        float x = d - radius;
        float envelope = exp(- x * x * 2.2) * exp(- age * 0.9) / (1.0 + radius * 0.8);
        slope += away / d * cos(x * 9.0) * envelope * ripple.w * 0.55;
        foam += exp(- age * 2.5) * exp(- d * d * 1.8) * ripple.w;
    }
    vec3 normal = normalize(vec3(slope.x, 1.0, slope.y));

    float cosTheta = clamp(dot(normal, viewDirection), 0.0, 1.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);

    vec3 reflected = reflect(- viewDirection, normal);
    reflected.y = abs(reflected.y);
    vec3 sky = getSkyLut(reflected);

    vec3 sunDirection = normalize(uSunPosition);
    float day = clamp(sunDirection.y * 2.0 + 0.4, 0.0, 1.0);
    float sunAlignment = max(dot(reflected, sunDirection), 0.0);
    // the sun's reflection: a tight, very bright core (it blooms) and a softer sheen around it
    float glitter = pow(sunAlignment, 900.0) * 60.0 + pow(sunAlignment, 60.0) * 0.6;

    vec3 reflection = sky * fresnel + getSunLight(sunDirection) * glitter * max(0.0, 1.0 - getCloudShadow(vWorldPosition, sunDirection) * 1.5);
    foam = clamp(foam * 0.5, 0.0, 0.6);
    reflection = mix(reflection, vec3(0.7, 0.78, 0.82) * getTerrainLight(vec3(0.0, 1.0, 0.0), sunDirection, 1.0) * 0.6, foam);
    fresnel = max(fresnel, foam);

    // Aerial haze. The bed behind is already hazed, so for out = src + bed * (1 - alpha) to
    // equal haze(reflection + bed * (1 - fresnel)), src = reflection * (1 - a) + haze * a * fresnel
    vec3 haze;
    float amount = getAerialHaze(vWorldPosition, haze);
    gl_FragColor = vec4(reflection * (1.0 - amount) + haze * amount * fresnel, fresnel);
}
