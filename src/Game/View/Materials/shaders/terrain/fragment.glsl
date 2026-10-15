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
uniform vec3 uGroundDetail;        // fade start, fade end (m), 1 = second texture scale against tiling

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vGrassDensity;
varying float vDepth;
varying vec3 vHaze;
varying float vHazeAmount;
varying float vCloudShadow;

#include ../partials/getGrassAttenuation.glsl
#include ../partials/getGrassColor.glsl
#include ../partials/getTerrainLight.glsl
#include ../partials/getTreeShade.glsl
#include ../partials/toLinear.glsl

vec3 noise3(vec2 uv) { return texture2D(uNoiseTexture, uv).rgb - 0.5; }

// A ground texture at two scales, blended by the large-scale variation so its repeat
// doesn't show; returned relative to the layer's average colour (1 = average)
vec3 groundDetail(vec2 uv, float layer, float largeScale)
{
    vec3 a = texture(uGroundAlbedo, vec3(uv, layer)).rgb;
    if (uGroundDetail.z > 0.5)
        a = mix(a, texture(uGroundAlbedo, vec3(uv * 0.27 + vec2(0.37, 0.71), layer)).rgb, largeScale);
    return a / uGroundMeans[int(layer)];
}

vec2 groundBump(vec2 uv, float layer)
{
    return texture(uGroundNormal, vec3(uv, layer)).xy * 2.0 - 1.0;
}

// Triplanar: the texture projected along x, y and z, blended by how the surface faces, so
// cliffs aren't smeared. Returns detail (relative colour) and the world-space bump.
vec3 triplanarDetail(vec3 position, vec3 normal, float scale, float layer, out vec3 bump)
{
    vec3 w = pow(abs(normal), vec3(4.0));
    w /= w.x + w.y + w.z;
    vec3 detail = vec3(0.0);
    bump = vec3(0.0);
    if (w.x > 0.02) {
        vec2 uv = position.zy / scale;
        detail += texture(uGroundAlbedo, vec3(uv, layer)).rgb * w.x;
        vec2 b = groundBump(uv, layer);
        bump += vec3(0.0, b.y, b.x) * w.x;
    }
    if (w.y > 0.02) {
        vec2 uv = position.xz / scale;
        detail += texture(uGroundAlbedo, vec3(uv, layer)).rgb * w.y;
        vec2 b = groundBump(uv, layer);
        bump += vec3(b.x, 0.0, b.y) * w.y;
    }
    if (w.z > 0.02) {
        vec2 uv = position.xy / scale;
        detail += texture(uGroundAlbedo, vec3(uv, layer)).rgb * w.z;
        vec2 b = groundBump(uv, layer);
        bump += vec3(b.x, b.y, 0.0) * w.z;
    }
    return detail / uGroundMeans[int(layer)];
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
    if (all(greaterThan(wetUv, vec2(0.0))) && all(lessThan(wetUv, vec2(1.0))))
        wet = max(wet, texture2D(uWetMap, wetUv).r);

    // ── photo-scanned detail close up ──
    float textured = uGroundReady * (1.0 - smoothstep(uGroundDetail.x, uGroundDetail.y, vDepth));
    float largeScale = smoothstep(- 0.3, 0.3, breakup) * 0.55;
    float treeShade = getTreeShade(p);
    vec3 bump = vec3(0.0);       // world-space tilt of the normal from the textures

    // ── layers ──
    vec3 color = getGrassColor(getGrassDryness(p), elevation) * (1.0 + speck * 0.16);
    float grassWeight = (1.0 - soilMask) * (1.0 - rockMask) * (1.0 - snowMask) * (1.0 - shoreMask);
    if (textured > 0.0) {
        color *= mix(vec3(1.0), groundDetail(p / 5.0, 0.0, largeScale), 0.8 * textured);
        vec2 b = groundBump(p / 5.0, 0.0);
        bump += vec3(b.x, 0.0, b.y) * 0.55 * grassWeight;
        // leaf litter under the canopy
        float floorMask = smoothstep(0.12, 0.5, treeShade) * (1.0 - rockMask);
        if (floorMask > 0.0) {
            vec3 litter = vec3(0.25, 0.22, 0.13) * groundDetail(p / 3.5, 5.0, largeScale);
            color = mix(color, litter, floorMask * 0.65 * textured);
            vec2 f = groundBump(p / 3.5, 5.0);
            bump += vec3(f.x, 0.0, f.y) * 0.6 * floorMask;
        }
    }
    if (soilMask > 0.0) {
        vec3 soil = mix(vec3(0.25, 0.21, 0.16), vec3(0.34, 0.29, 0.22), smoothstep(- 0.3, 0.3, speck));
        if (textured > 0.0) {
            soil *= mix(vec3(1.0), groundDetail(p / 4.0, 1.0, largeScale), 0.85 * textured);
            vec2 b = groundBump(p / 4.0, 1.0);
            bump += vec3(b.x, 0.0, b.y) * 0.8 * soilMask * (1.0 - rockMask);
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
            vec3 detail = triplanarDetail(vWorldPosition, normal, 7.0, 2.0, rockBump);
            float luma = dot(detail, vec3(0.3, 0.59, 0.11));
            rock *= mix(vec3(1.0), mix(vec3(luma), detail, 0.3), 0.9 * textured);
            bump += rockBump * 1.3 * rockMask;
        }
        color = mix(color, rock, rockMask);
    }
    if (snowMask > 0.0) {
        vec3 snow = vec3(0.90, 0.92, 0.96);
        if (textured > 0.0) {
            snow *= mix(vec3(1.0), groundDetail(p / 6.0, 4.0, largeScale), 0.6 * textured);
            vec2 b = groundBump(p / 6.0, 4.0);
            bump += vec3(b.x, 0.0, b.y) * 0.5 * snowMask;
        }
        color = mix(color, snow, snowMask);
    }
    if (shoreMask > 0.0) {
        vec3 sand = mix(vec3(0.38, 0.35, 0.28), vec3(0.47, 0.43, 0.34), smoothstep(- 0.3, 0.3, speck));
        if (textured > 0.0) {
            sand *= mix(vec3(1.0), groundDetail(p / 4.0, 3.0, largeScale), 0.85 * textured);
            vec2 b = groundBump(p / 4.0, 3.0);
            bump += vec3(b.x, 0.0, b.y) * 0.7 * shoreMask;
        }
        color = mix(color, sand, shoreMask);
    }
    color *= mix(1.0, 0.55, wet);

    // Under the grass field the ground is shaded by the blades (fades exactly as they do)
    float grassAttenuation = getGrassAttenuation(p) * (1.0 - rockMask) * (1.0 - snowMask) * vGrassDensity;
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
    float sunVisibility = (1.0 - vCloudShadow) * (1.0 - treeShade);
    vec3 albedo = toLinear(color);
    vec3 lit = albedo * getTerrainLight(detailNormal, sunDirection, sunVisibility) * (1.0 - cavity) * (1.0 - treeShade * 0.3);
    // glint on snow and wet sand
    if (snowMask + wet > 0.0) {
        float glint = pow(max(dot(reflect(viewDirection, detailNormal), sunDirection), 0.0), 24.0);
        lit += getSunLight(sunDirection) * glint * (snowMask * 0.12 + wet * 0.2) * sunVisibility;
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
