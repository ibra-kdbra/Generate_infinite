// Terrain surface, shaded per pixel. Layers by slope and altitude: lake bed, shore sand,
// grass (lush / dry drifts, alpine meadow higher up), soil on slopes, stratified rock and
// snow on the highest peaks, forest floor under the trees. Close up, photo-scanned textures
// (Poly Haven, CC0) add their detail and bumps to each layer while the layer keeps the
// palette's average colour, so the grass blades still match the ground; they fade into the
// plain palette with distance. Lit by the light model the grass also uses; the aerial haze
// comes from the vertex shader.
// Cost matters (every pixel of the ground runs this): detail is skipped where it has faded
// out, and each texture is only read where its layer shows.

uniform vec3 uPlayerPosition;
uniform vec3 uSunPosition;
uniform float uGrassDistance;
uniform float uWaterLevel;
uniform sampler2D uNoiseTexture;   // tiling Perlin, 8 periods per repeat, 3 channels
uniform sampler2D uReliefTexture;  // baked micro relief, one tile = 12 m (relief/fragment.glsl)
uniform sampler2DArray uGroundAlbedo;   // TerrainTextures.ts: 0 grass ground, 1 soil, 2 rock,
uniform sampler2DArray uGroundNormal;   // 3 sand, 4 snow, 5 forest floor
uniform vec3 uGroundMeans[6];
uniform float uGroundReady;
uniform sampler2D uWetMap;          // wet footprints and drips near the player (GroundWetness.ts)
uniform vec2 uWetOrigin;
uniform float uWetSize;
uniform vec2 uForestFade;          // trees are drawn up to here around the player; beyond, the canopy colour
uniform vec3 uGroundDetail;        // fade start, fade end (m), 1 = second texture scale against tiling

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vGrassDensity;
varying float vDepth;
varying vec3 vHaze;
varying float vHazeAmount;
varying float vCloudShadow;
varying float vForest;

#include ../partials/getGrassAttenuation.glsl
#include ../partials/getGrassColor.glsl
#include ../partials/getTerrainLight.glsl
#include ../partials/getTreeShade.glsl
#include ../partials/getSunShadow.glsl
#include ../partials/toLinear.glsl
#include ../partials/getSkyLut.glsl

vec3 noise3(vec2 uv) { return texture2D(uNoiseTexture, uv).rgb - 0.5; }

// A ground texture at two scales, blended by the large-scale variation so its repeat
// doesn't show: rgb relative to the layer's average colour (1 = average), a = ambient
// occlusion (stored as 0.5 + 0.5 × AO, TerrainTextures.ts)
vec4 groundDetail(vec2 uv, float layer, float largeScale)
{
    vec4 a = texture(uGroundAlbedo, vec3(uv, layer));
    if (uGroundDetail.z > 0.5)
        a = mix(a, texture(uGroundAlbedo, vec3(uv * 0.27 + vec2(0.37, 0.71), layer)), largeScale);
    return vec4(a.rgb / uGroundMeans[int(layer)], a.a * 2.0 - 1.0);
}

// xy: the normal map's tilt; z: roughness
vec3 groundBump(vec2 uv, float layer)
{
    vec3 n = texture(uGroundNormal, vec3(uv, layer)).xyz;
    return vec3(n.xy * 2.0 - 1.0, n.z);
}

// Triplanar: the texture projected along x, y and z, blended by how the surface faces, so
// cliffs aren't smeared. Returns detail (relative colour, occlusion), the world-space bump
// and the roughness.
vec4 triplanarDetail(vec3 position, vec3 normal, float scale, float layer, out vec3 bump, out float roughness)
{
    vec3 w = pow(abs(normal), vec3(4.0));
    w /= w.x + w.y + w.z;
    vec4 detail = vec4(0.0);
    bump = vec3(0.0);
    roughness = 0.0;
    if (w.x > 0.02) {
        vec2 uv = position.zy / scale;
        detail += texture(uGroundAlbedo, vec3(uv, layer)) * w.x;
        vec3 b = groundBump(uv, layer);
        bump += vec3(0.0, b.y, b.x) * w.x;
        roughness += b.z * w.x;
    }
    if (w.y > 0.02) {
        vec2 uv = position.xz / scale;
        detail += texture(uGroundAlbedo, vec3(uv, layer)) * w.y;
        vec3 b = groundBump(uv, layer);
        bump += vec3(b.x, 0.0, b.y) * w.y;
        roughness += b.z * w.y;
    }
    if (w.z > 0.02) {
        vec2 uv = position.xy / scale;
        detail += texture(uGroundAlbedo, vec3(uv, layer)) * w.z;
        vec3 b = groundBump(uv, layer);
        bump += vec3(b.x, b.y, 0.0) * w.z;
        roughness += b.z * w.z;
    }
    return vec4(detail.rgb / uGroundMeans[int(layer)], detail.a * 2.0 - 1.0);
}

void main()
{
    vec3 normal = normalize(vNormal);
    vec2 p = vWorldPosition.xz;
    float elevation = vWorldPosition.y;
    float height = elevation - uWaterLevel;
    vec3 sunDirection = normalize(uSunPosition);
    vec3 viewDirection = normalize(vWorldPosition - cameraPosition);

    // Fine detail fades with distance (far away it would only shimmer)
    float detailFade = 1.0 - smoothstep(60.0, 260.0, vDepth);
    bool detailed = detailFade > 0.0;

    float slope = 1.0 - normal.y;               // 0 flat .. 1 vertical
    float steep = smoothstep(0.25, 0.5, slope);
    // On steep faces sample detail from the side (x/z against height) so it doesn't smear
    vec2 sideUv = abs(normal.x) > abs(normal.z) ? vec2(vWorldPosition.z, elevation) : vec2(vWorldPosition.x, elevation);

    float breakup = noise3(p * 0.0011).r + noise3(p * 0.0047).g * 0.5;   // large-scale variation
    float speck = 0.0;
    if (detailed)
        speck = (noise3(p * 0.075).g + noise3(p * 0.19).b * 0.5) * mix(0.4, 1.0, detailFade);

    // ── masks ──
    // soil only where it's sloped enough to show (never blotches on flat meadows)
    float soilMask = smoothstep(0.2, 0.33, slope + speck * 0.1);
    // rock on steep ground, a little more of it high up
    float alpine = smoothstep(150.0, 240.0, elevation + breakup * 40.0);
    float rockMask = smoothstep(0.34, 0.47, slope + breakup * 0.12 + speck * 0.06 + alpine * 0.2);
    // snow only on the highest peaks, where it can settle
    float snowLine = 210.0 + breakup * 35.0;
    float snowMask = smoothstep(snowLine, snowLine + 18.0, elevation) * (1.0 - smoothstep(0.38, 0.56, slope));
    // a narrow band of sand and pebbles along the water, wet right at the waterline
    float shoreMask = (1.0 - smoothstep(0.2, 0.7, height + speck * 0.45 + breakup * 0.35)) * (1.0 - steep * 0.7);
    float wet = 1.0 - smoothstep(0.0, 0.35, height);
    // wet footprints and drips
    vec2 wetUv = (p - uWetOrigin) / uWetSize + 0.5;
    float tilled = 0.0;
    if (all(greaterThan(wetUv, vec2(0.0))) && all(lessThan(wetUv, vec2(1.0)))) {
        vec2 marks = texture2D(uWetMap, wetUv).rg;
        wet = max(wet, marks.r);
        tilled = marks.g;
    }

    // ── photo-scanned detail close up ──
    // (low quality has no texture detail: (0, 0), where smoothstep is undefined; a NaN here
    // would spread over the whole frame through the bloom)
    float textured = uGroundDetail.y > uGroundDetail.x ? uGroundReady * (1.0 - smoothstep(uGroundDetail.x, uGroundDetail.y, vDepth)) : 0.0;
    float largeScale = smoothstep(- 0.3, 0.3, breakup) * 0.55;
    float treeShade = getTreeShade(p);
    vec3 bump = vec3(0.0);       // world-space tilt of the normal from the textures
    float occlusion = 1.0;       // the textures' ambient occlusion (crevices between pebbles)
    float roughness = 0.95;

    // ── layers ──
    vec3 color = getGrassColor(getGrassDryness(p), elevation) * (1.0 + speck * 0.16);
    float grassWeight = (1.0 - soilMask) * (1.0 - rockMask) * (1.0 - snowMask) * (1.0 - shoreMask);
    if (textured > 0.0) {
        vec4 detail = groundDetail(p / 5.0, 0.0, largeScale);
        color *= mix(vec3(1.0), detail.rgb, 0.8 * textured);
        vec3 b = groundBump(p / 5.0, 0.0);
        bump += vec3(b.x, 0.0, b.y) * 0.55 * grassWeight;
        occlusion = mix(1.0, detail.a, grassWeight);
        roughness = mix(roughness, b.z, grassWeight);
        // leaf litter under the canopy
        float floorMask = smoothstep(0.12, 0.5, treeShade) * (1.0 - rockMask);
        if (floorMask > 0.0) {
            vec4 litterDetail = groundDetail(p / 3.5, 5.0, largeScale);
            vec3 litter = vec3(0.25, 0.22, 0.13) * litterDetail.rgb;
            color = mix(color, litter, floorMask * 0.65 * textured);
            vec3 f = groundBump(p / 3.5, 5.0);
            bump += vec3(f.x, 0.0, f.y) * 0.6 * floorMask;
            occlusion = mix(occlusion, litterDetail.a, floorMask * 0.65);
            roughness = mix(roughness, f.z, floorMask * 0.65);
        }
    }
    if (soilMask > 0.0) {
        vec3 soil = mix(vec3(0.25, 0.21, 0.16), vec3(0.34, 0.29, 0.22), smoothstep(- 0.3, 0.3, speck));
        if (textured > 0.0) {
            vec4 detail = groundDetail(p / 4.0, 1.0, largeScale);
            soil *= mix(vec3(1.0), detail.rgb, 0.85 * textured);
            vec3 b = groundBump(p / 4.0, 1.0);
            bump += vec3(b.x, 0.0, b.y) * 0.8 * soilMask * (1.0 - rockMask);
            occlusion = mix(occlusion, detail.a, soilMask);
            roughness = mix(roughness, b.z, soilMask);
        }
        color = mix(color, soil, soilMask);
    }
    if (rockMask > 0.0) {
        // stratified rock: bands along the height, wobbled by noise; warm / cool rock masses
        float rockSpeck = speck;
        if (detailed && steep > 0.0)
            rockSpeck = mix(speck, noise3(sideUv * 0.075).g + noise3(sideUv * 0.19).b * 0.5, steep);
        float strata = sin(elevation * 0.32 + noise3(p * 0.006).b * 9.0 + speck * 2.0) * 0.5 + 0.5;
        vec3 rock = mix(vec3(0.29, 0.28, 0.26), vec3(0.49, 0.47, 0.43), clamp(strata * 0.3 + rockSpeck * 0.7 + 0.35, 0.0, 1.0));
        rock *= mix(vec3(1.04, 1.0, 0.95), vec3(0.96, 0.99, 1.03), smoothstep(- 0.3, 0.3, breakup));
        if (textured > 0.0) {
            // the cliff texture's structure, toned to grey stone, projected three ways
            vec3 rockBump;
            float rockRoughness;
            vec4 detail = triplanarDetail(vWorldPosition, normal, 7.0, 2.0, rockBump, rockRoughness);
            float luma = dot(detail.rgb, vec3(0.3, 0.59, 0.11));
            rock *= mix(vec3(1.0), mix(vec3(luma), detail.rgb, 0.3), 0.9 * textured);
            bump += rockBump * 1.3 * rockMask;
            occlusion = mix(occlusion, detail.a, rockMask);
            roughness = mix(roughness, rockRoughness, rockMask);
        }
        color = mix(color, rock, rockMask);
    }
    if (snowMask > 0.0) {
        vec3 snow = vec3(0.90, 0.92, 0.96);
        if (textured > 0.0) {
            vec4 detail = groundDetail(p / 6.0, 4.0, largeScale);
            snow *= mix(vec3(1.0), detail.rgb, 0.6 * textured);
            vec3 b = groundBump(p / 6.0, 4.0);
            bump += vec3(b.x, 0.0, b.y) * 0.5 * snowMask;
            occlusion = mix(occlusion, mix(1.0, detail.a, 0.5), snowMask);
            roughness = mix(roughness, b.z, snowMask);
        }
        color = mix(color, snow, snowMask);
    }
    if (shoreMask > 0.0) {
        vec3 sand = mix(vec3(0.38, 0.35, 0.28), vec3(0.47, 0.43, 0.34), smoothstep(- 0.3, 0.3, speck));
        if (textured > 0.0) {
            vec4 detail = groundDetail(p / 4.0, 3.0, largeScale);
            sand *= mix(vec3(1.0), detail.rgb, 0.85 * textured);
            vec3 b = groundBump(p / 4.0, 3.0);
            bump += vec3(b.x, 0.0, b.y) * 0.7 * shoreMask;
            occlusion = mix(occlusion, detail.a, shoreMask);
            roughness = mix(roughness, b.z, shoreMask);
        }
        color = mix(color, sand, shoreMask);
    }
    // soil turned with the hoe: dark, freshly broken earth in rough furrows
    if (tilled > 0.01) {
        float furrows = sin(dot(p, vec2(0.71, 0.71)) * 18.0 + noise3(p * 0.9).r * 3.0) * 0.5 + 0.5;
        vec3 earth = mix(vec3(0.16, 0.12, 0.08), vec3(0.24, 0.18, 0.12), furrows) * (0.85 + speck * 0.3);
        color = mix(color, earth, smoothstep(0.05, 0.6, tilled));
    }
    color *= mix(1.0, 0.55, wet);

    // ── distant forests: past where trees are drawn, the crowns' colour, clumped ──
    float canopy = vForest * smoothstep(uForestFade.x, uForestFade.y, distance(vWorldPosition.xz, uPlayerPosition.xz));
    if (canopy > 0.0) {
        float crowns = noise3(p * 0.045).r + noise3(p * 0.13).g * 0.6;
        float cover = smoothstep(0.15, 0.55, canopy + crowns * 0.35);
        vec3 leaves = mix(vec3(0.10, 0.15, 0.07), vec3(0.19, 0.25, 0.11), smoothstep(- 0.35, 0.35, crowns));
        leaves = mix(leaves, vec3(0.09, 0.13, 0.09), smoothstep(60.0, 150.0, elevation) * 0.6);     // conifers higher up
        color = mix(color, leaves, cover);
        canopy = cover;
    }

    // Under the grass field the ground is shaded by the blades (fades exactly as they do)
    float grassAttenuation = getGrassAttenuation(p) * (1.0 - rockMask) * (1.0 - snowMask) * vGrassDensity * (1.0 - tilled);
    color *= mix(1.0, 0.72, grassAttenuation);

    // ── micro relief: strong on rock, gentle on grass and snow ──
    vec3 detailNormal = normal;
    float cavity = 0.0;
    if (detailed) {
        // baked relief where the textures have faded (and the rock's cavities)
        vec3 relief = texture2D(uReliefTexture, (steep > 0.5 ? sideUv : p) / 12.0).rgb * 2.0 - 1.0;
        float strength = mix(0.35, 1.8, rockMask) * (1.0 - snowMask * 0.7) * detailFade * (1.0 - textured * 0.8);
        detailNormal = normalize(normal + vec3(relief.x, 0.0, relief.y) * strength * 2.4 + bump * textured);
        cavity = clamp(- relief.z * 1.5, 0.0, 0.5) * 0.35 * detailFade;
    }

    // ── lighting ──
    // shadow maps near by; beyond them, the soft blobs under distant trees
    float treeShadow = treeShade * (uShadowSplits.w > 0.5 ? smoothstep(uShadowSplits.y * 0.8, uShadowSplits.y, vDepth) : 1.0);
    // ground facing away from the sun is in its own shadow: no need to look it up
    float sunShadow = dot(normal, sunDirection) > - 0.05 ? getSunShadow(vWorldPosition, normal, sunDirection) : 0.0;
    float sunVisibility = (1.0 - vCloudShadow) * (1.0 - treeShadow) * sunShadow;
    vec3 albedo = toLinear(color);
    occlusion = mix(1.0, occlusion, textured);
    vec3 lit = albedo * getTerrainLight(detailNormal, sunDirection, sunVisibility) * (1.0 - cavity) * (1.0 - treeShade * 0.3) * mix(1.0, occlusion, 0.8);
    lit *= 1.0 - canopy * 0.3;     // crowns shade each other
    lit += albedo * getTorchLight(vWorldPosition, detailNormal) * (1.0 - cavity);

    // sun highlight (GGX): faint on dry ground, bright where it's wet (water fills the pores)
    // and on rock and snow
    roughness = mix(mix(roughness, 0.95, 1.0 - textured), 0.12, wet);
    vec3 toEye = - viewDirection;
    vec3 halfway = normalize(sunDirection + toEye);
    float nl = max(dot(detailNormal, sunDirection), 0.0);
    if (nl > 0.0 && sunVisibility > 0.0) {
        float nv = max(dot(detailNormal, toEye), 1e-3);
        float nh = max(dot(detailNormal, halfway), 0.0);
        float a = roughness * roughness;
        float a2 = a * a;
        float d = a2 / (3.14159265 * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
        float k = a * 0.5;
        float g = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
        float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(halfway, toEye), 0.0), 5.0);
        float strength = mix(0.35, 1.0, max(wet, max(rockMask, snowMask))) * occlusion;
        lit += uSunLight * 3.14159265 * d * g * fresnel / (4.0 * nv) * sunVisibility * strength;
    }
    // wet ground mirrors the sky a little
    if (wet > 0.0) {
        float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(detailNormal, toEye), 0.0), 5.0);
        lit += getSkyLut(reflect(viewDirection, detailNormal) + vec3(0.0, 0.05, 0.0)) * fresnel * wet * 0.4;
    }

    // ── under water: light absorbed along the water column (the surface adds reflections) ──
    if (height < 0.0) {
        float path = - height * (1.0 + min(3.0, 1.0 / max(0.05, - viewDirection.y)));
        vec3 transmittance = exp(- path * vec3(1.36, 0.66, 0.53));
        vec3 waterBody = vec3(0.0015, 0.0053, 0.0069) * getTerrainLight(vec3(0.0, 1.0, 0.0), sunDirection, sunVisibility);
        lit = lit * transmittance + waterBody * (1.0 - transmittance);
    }

    lit = mix(lit, vHaze, vHazeAmount);

    gl_FragColor = vec4(lit, 1.0);
}
