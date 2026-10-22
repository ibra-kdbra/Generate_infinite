/**
 * The atmosphere on the CPU: the same physical model as the sky shader (atmosphere.glsl),
 * evaluated a few hundred times per frame to give the light everything else is lit by:
 * - sunlight at the ground (the sun's light through the air: white at noon, orange and dim
 *   at sunset, gone once the sun is below the horizon) and at the clouds' height
 * - the sky's light on a surface facing up (blue by day, deep blue at dusk) and the light
 *   bounced up from the ground
 * - the moon's light at night (artistic: much brighter than the real moon)
 * Units: a white surface facing the light shows that light's value (the shaders don't divide
 * by π; the sun outside the atmosphere is SUN_ILLUMINANCE).
 */

const PLANET_RADIUS = 6360e3
const ATMOSPHERE_RADIUS = 6460e3
const RAYLEIGH = [5.802e-6, 13.558e-6, 33.1e-6]
const RAYLEIGH_HEIGHT = 8000
const MIE_EXTINCTION = 4.44e-6
const MIE_SCATTERING = 3.996e-6
const MIE_HEIGHT = 1200
const OZONE = [0.650e-6, 1.881e-6, 0.085e-6]

export const SUN_ILLUMINANCE = 3.3
export const MOON_ILLUMINANCE = 0.12
const SKY_GAIN = 1.6            // matches the sky shader (multiple scattering, roughly)
const GROUND_ALBEDO = [0.14, 0.17, 0.09]

type Vec3 = [number, number, number]

/** Optical depth (Rayleigh, Mie, ozone) from a point at this height toward a direction. */
function opticalDepth(height: number, cosZenith: number, steps = 8): Vec3 {
    // the path to the top of the atmosphere (or the planet in the way)
    const r = PLANET_RADIUS + height
    const b = r * cosZenith
    const discriminant = b * b - r * r + ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS
    const length = - b + Math.sqrt(Math.max(0, discriminant))
    const ds = length / steps
    let rayleigh = 0, mie = 0, ozone = 0
    for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) * ds
        const h = Math.sqrt(r * r + t * t + 2 * r * t * cosZenith) - PLANET_RADIUS
        rayleigh += Math.exp(- h / RAYLEIGH_HEIGHT) * ds
        mie += Math.exp(- h / MIE_HEIGHT) * ds
        ozone += Math.max(0, 1 - Math.abs(h - 25000) / 15000) * ds
    }
    return [rayleigh, mie, ozone]
}

/** Transmittance toward the sun from this height (0 when the planet is in the way, softly). */
function sunTransmittance(height: number, cosZenith: number): Vec3 {
    const r = PLANET_RADIUS + height
    // below the geometric horizon the planet hides the sun (soft over the sun's own size)
    const horizon = - Math.sqrt(Math.max(0, 1 - (PLANET_RADIUS / r) ** 2))
    const visible = smoothstep(horizon - 0.01, horizon + 0.01, cosZenith)
    if (visible <= 0)
        return [0, 0, 0]
    const [dr, dm, doz] = opticalDepth(height, Math.max(cosZenith, horizon))
    return [0, 1, 2].map((c) => Math.exp(- (RAYLEIGH[c] * dr + MIE_EXTINCTION * dm + OZONE[c] * doz)) * visible) as Vec3
}

function smoothstep(a: number, b: number, x: number) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
}

/**
 * Sky radiance in a direction (single scattering plus a rough multiple-scattering term),
 * lit by a light source in direction `light` of strength `illuminance`.
 */
function skyRadiance(direction: Vec3, light: Vec3, illuminance: number, steps = 10): Vec3 {
    const height = 200
    const r = PLANET_RADIUS + height
    const cosZenith = direction[1]
    const b = r * cosZenith
    const length = - b + Math.sqrt(Math.max(0, b * b - r * r + ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS))
    const mu = direction[0] * light[0] + direction[1] * light[1] + direction[2] * light[2]
    const phaseRayleigh = 3 / (16 * Math.PI) * (1 + mu * mu)
    const g = 0.8
    const phaseMie = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5))
    const result: Vec3 = [0, 0, 0]
    const transmittance: Vec3 = [1, 1, 1]
    let previous = 0
    for (let i = 0; i < steps; i++) {
        const x = (i + 1) / steps
        const t1 = length * x * x
        const ds = t1 - previous
        const t = (previous + t1) * 0.5
        previous = t1
        // point on the ray: its height and the sun's zenith angle there
        const px = direction[0] * t, py = r + direction[1] * t, pz = direction[2] * t
        const pr = Math.hypot(px, py, pz)
        const h = pr - PLANET_RADIUS
        const sunCos = (px * light[0] + py * light[1] + pz * light[2]) / pr
        const sunT = sunTransmittance(h, sunCos)
        const rayleigh = Math.exp(- h / RAYLEIGH_HEIGHT)
        const mie = Math.exp(- h / MIE_HEIGHT)
        const ozone = Math.max(0, 1 - Math.abs(h - 25000) / 15000)
        for (let c = 0; c < 3; c++) {
            const extinction = RAYLEIGH[c] * rayleigh + MIE_EXTINCTION * mie + OZONE[c] * ozone
            const stepT = Math.exp(- extinction * ds)
            const integral = (1 - stepT) / Math.max(extinction, 1e-12)
            const scattering = RAYLEIGH[c] * rayleigh * (phaseRayleigh + 0.08) + MIE_SCATTERING * mie * (phaseMie + 0.08)
            result[c] += transmittance[c] * sunT[c] * scattering * integral
            transmittance[c] *= stepT
        }
    }
    const gain = illuminance * Math.PI * SKY_GAIN
    return [result[0] * gain, result[1] * gain, result[2] * gain]
}

/** The sky's light on a surface facing up (cosine-weighted over the hemisphere, ÷ π). */
function skyIrradiance(light: Vec3, illuminance: number): Vec3 {
    const result: Vec3 = [0, 0, 0]
    const rings = 5, segments = 8
    let weight = 0
    for (let ring = 0; ring < rings; ring++) {
        // equal-area rings in cos²: uniform in projected solid angle
        const cosTheta = Math.sqrt(1 - (ring + 0.5) / rings)
        const sinTheta = Math.sqrt(1 - cosTheta * cosTheta)
        for (let segment = 0; segment < segments; segment++) {
            const phi = (segment + 0.5) / segments * Math.PI * 2
            const direction: Vec3 = [sinTheta * Math.cos(phi), Math.max(cosTheta, 0.02), sinTheta * Math.sin(phi)]
            const radiance = skyRadiance(direction, light, illuminance, 8)
            result[0] += radiance[0]
            result[1] += radiance[1]
            result[2] += radiance[2]
            weight++
        }
    }
    // mean radiance over projected solid angle = irradiance / π, which is what the shaders use
    return [result[0] / weight, result[1] / weight, result[2] / weight]
}

export type AtmosphereLight = {
    sun: Vec3           // sunlight at the ground
    sunClouds: Vec3     // sunlight at the clouds' height
    moon: Vec3
    sky: Vec3           // the sky's light on a surface facing up
    ground: Vec3        // light bounced from the ground, on a surface facing down
}

export function computeLight(sunDirection: Vec3): AtmosphereLight {
    const moonDirection: Vec3 = [- sunDirection[0], - sunDirection[1], - sunDirection[2]]
    const sunT = sunTransmittance(0, sunDirection[1])
    const sunCloudsT = sunTransmittance(2200, sunDirection[1])
    const sun = sunT.map((t) => t * SUN_ILLUMINANCE) as Vec3
    const sunClouds = sunCloudsT.map((t) => t * SUN_ILLUMINANCE) as Vec3
    const moonT = sunTransmittance(0, moonDirection[1])
    const moon = moonT.map((t, c) => t * MOON_ILLUMINANCE * [0.55, 0.7, 1][c]) as Vec3

    const sky = skyIrradiance(sunDirection, SUN_ILLUMINANCE)
    const nightSky = skyIrradiance(moonDirection, MOON_ILLUMINANCE)
    // starlight and airglow: the darkest it gets
    const floor = [0.008, 0.013, 0.03]
    for (let c = 0; c < 3; c++)
        sky[c] += nightSky[c] + floor[c]
    // real skies are hazier than clean air: their light is less saturated
    const luminance = sky[0] * 0.2126 + sky[1] * 0.7152 + sky[2] * 0.0722
    for (let c = 0; c < 3; c++)
        sky[c] = luminance + (sky[c] - luminance) * 0.75

    const up = Math.max(0, sunDirection[1])
    const moonUp = Math.max(0, moonDirection[1])
    const ground = [0, 1, 2].map((c) => GROUND_ALBEDO[c] * (sun[c] * up + moon[c] * moonUp + sky[c])) as Vec3
    return { sun, sunClouds, moon, sky, ground }
}
