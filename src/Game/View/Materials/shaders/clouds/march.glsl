// Volumetric clouds, ray-marched at a fraction of the screen resolution (Clouds.ts) and
// accumulated over frames (resolve.glsl).
// Shape: the weather map says where clouds form and how tall they grow; within that, a
// Perlin-Worley noise volume gives the masses and Worley noise erodes them into billowing
// tops and wispy bases (the approach of Guerrilla's "Nubis" clouds). The layer follows the
// planet's curve, so distant clouds sink toward the horizon.
// Light: sunlight through the cloud toward the sun (Beer's law) with an approximation of
// light scattered many times inside it, a strong forward lobe (silver linings toward the
// sun), dark crevices on the sunny side ("powder"), sky light from above and a little
// light bounced from the ground below. Far clouds dissolve into the sky behind them.

uniform mat4 uInverseViewProjection;   // screen -> view direction (rotation only)
uniform vec3 uCameraPosition;
uniform vec3 uSunPosition;
uniform vec3 uSunLightClouds;           // sunlight at the clouds' height
uniform vec3 uMoonLight;
uniform vec3 uSkyLight;
uniform vec3 uGroundLight;
uniform sampler3D uCloudShape;
uniform sampler3D uCloudDetail;
uniform float uSteps;                   // 0: a single flat layer (low quality)
uniform float uLightSteps;
uniform float uFrame;
uniform float uCloudTime;

varying vec2 vUv;

#include ../partials/getClouds.glsl

#define PLANET 6360e3
#define EXTINCTION 0.03          // per metre at full density
#define SHAPE_SIZE 5200.0        // the shape noise tiles every 5.2 km
#define DETAIL_SIZE 760.0
#define MAX_DISTANCE 42000.0
#define SUN_GAIN 5.0             // in-scattered sunlight (the approximation underestimates it)

float remap(float value, float low, float high, float newLow, float newHigh)
{
    return newLow + (value - low) * (newHigh - newLow) / (high - low);
}

// Interleaved gradient noise: a well-spread jitter per pixel, changing every frame
float jitter(vec2 pixel, float frame)
{
    pixel += frame * vec2(47.0, 17.0) * 0.695;
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

vec2 raySphere(vec3 origin, vec3 direction, float radius)
{
    float b = dot(origin, direction);
    float c = dot(origin, origin) - radius * radius;
    float h = b * b - c;
    if (h < 0.0)
        return vec2(- 1.0);
    h = sqrt(h);
    return vec2(- b - h, - b + h);
}

// Height in the layer (0 base .. 1 top) of a point relative to the camera's ground point
float layerHeight(vec3 local)
{
    return (length(local + vec3(0.0, PLANET, 0.0)) - PLANET - CLOUD_BASE) / CLOUD_THICKNESS;
}

// Density at a point (world xz, height in the layer). Detail erosion only when `detailed`.
float cloudDensity(vec3 world, float h, bool detailed)
{
    vec4 weather = getCloudWeather(world.xz);
    float coverage = getCloudCoverage(weather);
    if (coverage < 0.01)
        return 0.0;
    // flat fair-weather clouds .. towering cumulus; rounded bases, domed tops
    float top = mix(0.3, 1.0, weather.g);
    float profile = smoothstep(0.0, 0.06, h) * (1.0 - smoothstep(top * 0.3, top, h));
    // cumulus are denser up in their bodies than at their flat bases
    profile *= mix(0.65, 1.0, smoothstep(0.0, 0.35, h));
    if (profile <= 0.0)
        return 0.0;
    // the shapes ride the wind a little slower than the weather and rise slowly as they
    // grow, so they change while drifting instead of sliding past like a picture
    vec3 q = vec3(world.x + uCloudOffset.x * 0.92, world.y - uCloudTime * 1.1, world.z + uCloudOffset.y * 0.92);
    vec4 shape = textureLod(uCloudShape, q / SHAPE_SIZE, 0.0);
    float worley = shape.g * 0.625 + shape.b * 0.25 + shape.a * 0.125;
    float base = remap(shape.r, worley - 1.0, 1.0, 0.0, 1.0) * profile;
    base = clamp(remap(base, 1.0 - coverage, 1.0, 0.0, 1.0), 0.0, 1.0) * coverage;
    if (!detailed || base <= 0.0)
        return base;
    // detail: wisps at the base turning to billows toward the top
    vec3 d = textureLod(uCloudDetail, (q + vec3(uCloudTime * 3.0, uCloudTime * 2.0, 0.0)) / DETAIL_SIZE, 0.0).rgb;
    float detail = d.r * 0.625 + d.g * 0.25 + d.b * 0.125;
    detail = mix(detail, 1.0 - detail, clamp(h * 4.0, 0.0, 1.0));
    return clamp(remap(base, detail * 0.42, 1.0, 0.0, 1.0), 0.0, 1.0);
}

float henyeyGreenstein(float mu, float g)
{
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

// Sunlight reaching a point inside the cloud, scattered toward the eye: several octaves of
// ever weaker extinction and wider scattering stand in for light bouncing around inside
float sunScattering(float opticalDepth, float mu)
{
    float sum = 0.0, a = 1.0, b = 1.0, c = 1.0;
    for (int octave = 0; octave < 3; octave++) {
        float phase = mix(henyeyGreenstein(mu, 0.8 * c), henyeyGreenstein(mu, - 0.25 * c), 0.25);
        sum += a * exp(- opticalDepth * b) * phase;
        a *= 0.5;
        b *= 0.4;
        c *= 0.6;
    }
    return sum;
}

// Optical depth toward the light from a point (cheap density, growing steps)
float lightDepth(vec3 world, vec3 local, vec3 light)
{
    float depth = 0.0;
    float t = 0.0;
    float stepLength = 45.0;
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uLightSteps)
            break;
        t += stepLength;
        vec3 offset = light * (t - stepLength * 0.5);
        float h = layerHeight(local + offset);
        if (h > 1.0)
            break;
        depth += cloudDensity(world + offset, h, false) * stepLength;
        stepLength *= 1.8;
    }
    return depth * EXTINCTION;
}

void main()
{
    vec4 farPoint = uInverseViewProjection * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 direction = normalize(farPoint.xyz / farPoint.w);
    vec3 sun = normalize(uSunPosition);
    // by night the moon lights the clouds, from the other side
    bool moonlit = sun.y < - 0.02;
    vec3 light = moonlit ? - sun : sun;
    vec3 lightColor = moonlit ? uMoonLight : uSunLightClouds;

    // where the ray is inside the layer (camera usually below it)
    vec3 origin = vec3(0.0, PLANET + uCameraPosition.y, 0.0);
    vec2 inner = raySphere(origin, direction, PLANET + CLOUD_BASE);
    vec2 outer = raySphere(origin, direction, PLANET + CLOUD_BASE + CLOUD_THICKNESS);
    float cameraHeight = uCameraPosition.y;
    float tStart, tEnd;
    if (cameraHeight < CLOUD_BASE) {
        if (inner.y < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        tStart = inner.y;
        tEnd = outer.y;
    }
    else if (cameraHeight < CLOUD_BASE + CLOUD_THICKNESS) {
        tStart = 0.0;
        tEnd = inner.x > 0.0 ? inner.x : outer.y;
    }
    else {
        if (outer.x < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        tStart = outer.x;
        tEnd = inner.x > 0.0 ? inner.x : outer.y;
    }
    if (tStart > MAX_DISTANCE) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    tEnd = min(tEnd, tStart + 9000.0);

    float mu = dot(direction, light);
    vec3 scattered = vec3(0.0);
    float transmittance = 1.0;
    float distanceSum = 0.0;
    float weightSum = 0.0;

    if (uSteps < 0.5) {
        // low quality: one flat layer
        float t = tStart + (tEnd - tStart) * 0.3;
        vec3 local = direction * t;
        vec3 world = vec3(uCameraPosition.x, 0.0, uCameraPosition.z) + vec3(local.x, CLOUD_BASE + 300.0, local.z);
        float density = cloudDensity(world, 0.25, false);
        float opacity = 1.0 - exp(- density * 9.0);
        float shade = exp(- cloudDensity(world + light * 300.0, 0.4, false) * 3.0);
        vec3 color = lightColor * (0.25 + 0.75 * shade) * mix(0.35, 0.9, mu * 0.5 + 0.5) + uSkyLight * 0.8;
        scattered = color * opacity;
        transmittance = 1.0 - opacity;
        distanceSum = t;
        weightSum = 1.0;
    }
    else {
        float stepLength = (tEnd - tStart) / uSteps;
        float t = tStart + stepLength * jitter(gl_FragCoord.xy, uFrame);
        vec3 ground = vec3(uCameraPosition.x, 0.0, uCameraPosition.z);
        int empty = 0;
        for (int i = 0; i < 192; i++) {
            if (float(i) >= uSteps * 2.0 || t > tEnd || transmittance < 0.02)
                break;
            vec3 local = direction * t;
            local.y += cameraHeight;
            float h = layerHeight(local);
            vec3 world = ground + vec3(local.x, CLOUD_BASE + h * CLOUD_THICKNESS, local.z);
            // through clear air in long strides, inside clouds in short ones
            float density = cloudDensity(world, h, false);
            if (density <= 0.0) {
                empty++;
                t += stepLength * (empty > 2 ? 1.6 : 1.0);
                continue;
            }
            empty = 0;
            density = cloudDensity(world, h, true);
            float ds = stepLength * 0.6;
            if (density > 0.0) {
                float sigma = density * EXTINCTION;
                float depth = lightDepth(world, local, light);
                // dark crevices facing the light; fades looking toward it
                float powder = mix(1.0 - exp(- density * 6.0), 1.0, clamp(mu * 0.5 + 0.5, 0.0, 1.0) * 0.7 + 0.15);
                vec3 sunPart = lightColor * 3.14159265 * sunScattering(depth, mu) * powder * SUN_GAIN;
                vec3 ambient = uSkyLight * mix(0.45, 1.05, h) + uGroundLight * (1.0 - h) * 0.6;
                vec3 source = (sunPart + ambient) * sigma;
                float stepT = exp(- sigma * ds);
                scattered += transmittance * (source - source * stepT) / sigma;
                float before = transmittance;
                transmittance *= stepT;
                distanceSum += t * (before - transmittance);
                weightSum += before - transmittance;
            }
            t += ds;
        }
    }

    // far clouds dissolve into the sky behind them
    float meanDistance = weightSum > 0.0 ? distanceSum / weightSum : tStart;
    float fade = exp(- meanDistance / 26000.0) * smoothstep(0.0, 0.06, direction.y + 0.02);
    scattered *= fade;
    transmittance = 1.0 - (1.0 - transmittance) * fade;
    gl_FragColor = vec4(scattered, transmittance);
}
