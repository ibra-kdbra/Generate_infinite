// Tiling noises for the cloud textures (generated once on the GPU, Clouds.ts): gradient
// (Perlin) noise and cellular (Worley) noise, both periodic so the textures repeat
// seamlessly. Coordinates are in cells; `period` is the number of cells per tile.

vec3 hash33(vec3 p)
{
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
}

float perlin3(vec3 p, float period)
{
    vec3 i = floor(p);
    vec3 f = p - i;
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float result = 0.0;
    for (int z = 0; z < 2; z++)
    for (int y = 0; y < 2; y++)
    for (int x = 0; x < 2; x++) {
        vec3 corner = vec3(x, y, z);
        vec3 gradient = normalize(hash33(mod(i + corner, period)) * 2.0 - 1.0);
        float d = dot(gradient, f - corner);
        vec3 w = mix(1.0 - u, u, corner);
        result += d * w.x * w.y * w.z;
    }
    return result;           // about -0.7 .. 0.7
}

// 1 at the feature points, falling to 0 between them (inverted distance to the nearest)
float worley3(vec3 p, float period)
{
    vec3 i = floor(p);
    vec3 f = p - i;
    float nearest = 1.0;
    for (int z = - 1; z <= 1; z++)
    for (int y = - 1; y <= 1; y++)
    for (int x = - 1; x <= 1; x++) {
        vec3 cell = vec3(x, y, z);
        vec3 point = hash33(mod(i + cell, period));
        nearest = min(nearest, length(cell + point - f));
    }
    return 1.0 - nearest;
}

float perlinFbm(vec3 p, float period, int octaves)
{
    float sum = 0.0, amplitude = 0.5, total = 0.0;
    for (int o = 0; o < 6; o++) {
        if (o >= octaves)
            break;
        sum += perlin3(p, period) * amplitude;
        total += amplitude;
        p *= 2.0;
        period *= 2.0;
        amplitude *= 0.5;
    }
    return sum / total;
}

float worleyFbm(vec3 p, float period)
{
    return worley3(p, period) * 0.625 + worley3(p * 2.0, period * 2.0) * 0.25 + worley3(p * 4.0, period * 4.0) * 0.125;
}

float remap(float value, float low, float high, float newLow, float newHigh)
{
    return newLow + (value - low) * (newHigh - newLow) / (high - low);
}
