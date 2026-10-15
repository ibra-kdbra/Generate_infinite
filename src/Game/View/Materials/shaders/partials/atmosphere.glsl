// The atmosphere, physically: sunlight scattered by air molecules (Rayleigh: the blue sky and
// the red sunset) and by haze (Mie: the bright glow around the sun), absorbed by ozone (the
// deep blue of twilight), in a spherical shell 100 km thick around the planet, so the sun
// sets behind the planet and the upper air stays lit after sunset. Single scattering with a
// rough isotropic term for light scattered more than once. The CPU side (Atmosphere.ts) is
// the same model: it gives the sun, sky and ground light the world is lit by.
// Linear radiance in the scene's units (a white surface facing the sun shows SUN_ILLUMINANCE).

#define PLANET_RADIUS 6360e3
#define ATMOSPHERE_RADIUS 6460e3
#define RAYLEIGH_HEIGHT 8000.0
#define MIE_HEIGHT 1200.0
#define MIE_G 0.8
#define SKY_GAIN 1.6

const vec3 RAYLEIGH = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float MIE_SCATTERING = 3.996e-6;
const float MIE_EXTINCTION = 4.44e-6;
const vec3 OZONE = vec3(0.650e-6, 1.881e-6, 0.085e-6);

vec3 atmosphereDensity(float height)
{
    return vec3(exp(- height / RAYLEIGH_HEIGHT), exp(- height / MIE_HEIGHT), max(0.0, 1.0 - abs(height - 25000.0) / 15000.0));
}

// Distance from a point inside the sphere to its surface along a direction
float atmosphereExit(float r, float cosZenith)
{
    float b = r * cosZenith;
    return - b + sqrt(max(0.0, b * b - r * r + ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS));
}

// Transmittance toward the light from a height (0 once the planet hides it)
vec3 atmosphereTransmittance(float height, float cosZenith)
{
    float r = PLANET_RADIUS + height;
    float horizon = - sqrt(max(0.0, 1.0 - (PLANET_RADIUS / r) * (PLANET_RADIUS / r)));
    float visible = smoothstep(horizon - 0.01, horizon + 0.01, cosZenith);
    if (visible <= 0.0)
        return vec3(0.0);
    cosZenith = max(cosZenith, horizon);
    float ds = atmosphereExit(r, cosZenith) / 6.0;
    vec3 depth = vec3(0.0);
    for (int i = 0; i < 6; i++) {
        float t = (float(i) + 0.5) * ds;
        float h = sqrt(r * r + t * t + 2.0 * r * t * cosZenith) - PLANET_RADIUS;
        depth += atmosphereDensity(h) * ds;
    }
    return exp(- (RAYLEIGH * depth.x + MIE_EXTINCTION * depth.y + OZONE * depth.z)) * visible;
}

// Sky radiance in a direction, seen from near the ground, lit from `light` with this
// illuminance (the sun, or the moon at night)
vec3 atmosphereRadiance(vec3 direction, vec3 light, float illuminance)
{
    float r = PLANET_RADIUS + 200.0;
    float rayLength = atmosphereExit(r, direction.y);
    float mu = dot(direction, light);
    float phaseRayleigh = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
    float g2 = MIE_G * MIE_G;
    float phaseMie = 3.0 / (8.0 * 3.14159265) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * mu, 1.5));

    vec3 sum = vec3(0.0);
    vec3 transmittance = vec3(1.0);
    float previous = 0.0;
    const int STEPS = 20;
    for (int i = 0; i < STEPS; i++) {
        // denser near the eye, where the air is thick
        float x = float(i + 1) / float(STEPS);
        float t1 = rayLength * x * x;
        float ds = t1 - previous;
        float t = (previous + t1) * 0.5;
        previous = t1;
        vec3 p = vec3(0.0, r, 0.0) + direction * t;
        float pr = length(p);
        float h = pr - PLANET_RADIUS;
        vec3 density = atmosphereDensity(h);
        vec3 lightT = atmosphereTransmittance(h, dot(p, light) / pr);
        vec3 extinction = RAYLEIGH * density.x + MIE_EXTINCTION * density.y + OZONE * density.z;
        vec3 stepT = exp(- extinction * ds);
        vec3 integral = (1.0 - stepT) / max(extinction, vec3(1e-12));
        vec3 scattering = RAYLEIGH * density.x * (phaseRayleigh + 0.08) + MIE_SCATTERING * density.y * (phaseMie + 0.08);
        sum += transmittance * lightT * scattering * integral;
        transmittance *= stepT;
    }
    return sum * illuminance * 3.14159265 * SKY_GAIN;
}
