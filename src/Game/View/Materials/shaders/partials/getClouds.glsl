// The cloud layer's weather: a tiling map (Clouds.ts) drifting with the wind, its coverage
// rising and falling with the cloud cover. The sky ray-marches the clouds through it
// (clouds/march.glsl); the terrain, grass, trees and water use it for the cloud shadows
// sweeping over the land.

uniform sampler2D uCloudWeather;   // r coverage noise, g cloud height, b variation
uniform vec2 uCloudOffset;         // how far the wind has carried the clouds (m)
uniform float uCloudCover;         // 0 clear .. 1 overcast

#define CLOUD_BASE 1500.0
#define CLOUD_THICKNESS 2000.0     // the tallest cumulus; most clouds are much flatter
#define WEATHER_SIZE 36000.0       // the weather map tiles every 36 km

vec4 getCloudWeather(vec2 position)
{
    return texture(uCloudWeather, (position + uCloudOffset) / WEATHER_SIZE);
}

// How much of the column is cloud here (0 clear .. 1 the core of a cloud mass)
float getCloudCoverage(vec4 weather)
{
    float threshold = 1.0 - uCloudCover;
    return smoothstep(threshold - 0.08, threshold + 0.3, weather.r);
}

// How much the clouds dim direct sunlight at this point (0 none .. 0.8 under a thick cloud)
float getCloudShadow(vec3 worldPosition, vec3 sunDirection)
{
    if (sunDirection.y < 0.03)
        return 0.0;
    vec2 onLayer = worldPosition.xz + sunDirection.xz / sunDirection.y * (CLOUD_BASE + 500.0 - worldPosition.y);
    vec4 weather = getCloudWeather(onLayer);
    return smoothstep(0.08, 0.55, getCloudCoverage(weather) * (0.6 + 0.4 * weather.g)) * 0.8;
}
