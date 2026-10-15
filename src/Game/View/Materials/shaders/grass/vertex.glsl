precision highp float;

uniform float uTime;
uniform vec3 uPlayerPosition;
uniform float uPlayerLift;
uniform float uTerrainSize;
uniform float uTerrainTextureSize;
uniform sampler2D uTerrainATexture;
uniform vec2 uTerrainAOffset;
uniform sampler2D uTerrainBTexture;
uniform vec2 uTerrainBOffset;
uniform sampler2D uTerrainCTexture;
uniform vec2 uTerrainCOffset;
uniform sampler2D uTerrainDTexture;
uniform vec2 uTerrainDOffset;
uniform sampler2D uNoiseTexture;
uniform vec2 uPatchOrigin;
uniform float uPatchSeed;
uniform float uPatchSize;
uniform float uLodWidth;
uniform float uRadius;
uniform float uBladeWidth;
uniform vec2 uHeightRange;
uniform float uFlowers;
uniform sampler2D uTrailTexture;
uniform vec2 uTrailOrigin;
uniform float uTrailSize;

attribute vec2 aCenter;    // blade root inside the patch, 0..1
attribute vec4 aRandom;    // x height, y width / flower, z facing / petal colour, w lean / shade

varying vec3 vColorBase;
varying vec3 vNormal;
varying vec3 vGroundNormal;
varying vec3 vWorldPosition;
varying float vHeight;     // 0 root .. 1 tip
varying vec4 vFlower;      // rgb petal colour, a: 1 on flowering blades
varying float vSunVisibility;

#include ../partials/getGrassColor.glsl
#include ../partials/getClouds.glsl
#include ../partials/getTreeShade.glsl

uniform vec3 uSunPosition;

vec4 bilinear(sampler2D tex, vec2 uv)
{
    vec2 texel = uv * (uTerrainTextureSize - 1.0);
    vec2 grid = floor(texel);
    vec2 f = fract(texel);
    return mix(
        mix(texture2D(tex, (grid + vec2(0.5, 0.5)) / uTerrainTextureSize), texture2D(tex, (grid + vec2(1.5, 0.5)) / uTerrainTextureSize), f.x),
        mix(texture2D(tex, (grid + vec2(0.5, 1.5)) / uTerrainTextureSize), texture2D(tex, (grid + vec2(1.5, 1.5)) / uTerrainTextureSize), f.x),
        f.y
    );
}

bool inside(vec2 uv) { return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0; }

// Sample only the terrain tile that contains the point (4 fetches instead of 16)
vec4 terrainAt(vec2 xz)
{
    vec2 uv = (xz - uTerrainAOffset) / uTerrainSize;
    if (inside(uv)) return bilinear(uTerrainATexture, uv);
    uv = (xz - uTerrainBOffset) / uTerrainSize;
    if (inside(uv)) return bilinear(uTerrainBTexture, uv);
    uv = (xz - uTerrainCOffset) / uTerrainSize;
    if (inside(uv)) return bilinear(uTerrainCTexture, uv);
    uv = (xz - uTerrainDOffset) / uTerrainSize;
    if (inside(uv)) return bilinear(uTerrainDTexture, uv);
    return vec4(0.0);   // no data yet: density 0 hides the blade
}

void main()
{
    // The shared patch layout, mirrored / transposed per patch (8 variants) and re-randomised
    vec2 c = aCenter;
    float variant = floor(uPatchSeed * 8.0);
    if (mod(variant, 2.0) >= 1.0) c.x = 1.0 - c.x;
    if (mod(floor(variant * 0.5), 2.0) >= 1.0) c.y = 1.0 - c.y;
    if (variant >= 4.0) c = c.yx;
    vec2 root = uPatchOrigin + c * uPatchSize;
    vec4 random = fract(aRandom + uPatchSeed * vec4(1.0, 1.618, 2.414, 3.142));

    vec4 terrain = terrainAt(root);
    vec3 groundNormal = vec3(terrain.r, sqrt(max(0.0, 1.0 - terrain.r * terrain.r - terrain.g * terrain.g)), terrain.g);
    float density = terrain.b;
    float ground = terrain.a;

    // Fade out toward the edge of the field and on steep ground
    vec2 fromPlayer = root - uPlayerPosition.xz;
    float distanceToPlayer = length(fromPlayer);
    float slope = 1.0 - groundNormal.y;
    float distanceScale = 1.0 - smoothstep(uRadius * 0.55, uRadius, distanceToPlayer);
    float slopeScale = 1.0 - smoothstep(0.3, 0.45, slope);
    float scale = distanceScale * slopeScale * density;
    float canopy = getTreeShade(root);
    scale *= 1.0 - smoothstep(0.15, 0.55, canopy) * 0.75;      // little grass in the shade of trees

    // Lush / dry drifts: the very function (and noise texture) the terrain uses
    float dry = getGrassDryness(root);
    float flower = step(1.0 - uFlowers, random.y);

    float h = position.y;
    float height = mix(uHeightRange.x, uHeightRange.y, random.x)
        * mix(1.0, 0.7, dry)
        * mix(1.0, 0.55, smoothstep(110.0, 185.0, ground))     // alpine meadow is short
        * mix(1.0, 1.2, flower)
        * scale;
    // blades taper to the tip; flowers are a thin stem with a head (the widest row is at 2/3)
    float profile = mix(pow(1.0 - h, 0.7), h > 0.5 ? 0.75 : 0.22, flower);
    float width = uBladeWidth * uLodWidth * (0.7 + random.y * 0.6) * scale * profile;

    // Facing: random, partly turned toward the camera so blades never look paper thin
    float yaw = random.z * 6.28318;
    vec2 facingRandom = vec2(sin(yaw), cos(yaw));
    vec2 toCamera = normalize(cameraPosition.xz - root + 1e-4);
    vec2 facing = normalize(mix(facingRandom, toCamera, 0.45));
    vec2 across = vec2(facing.y, - facing.x);

    // Natural lean + wind (slow sway, rolling gusts)
    vec2 lean = - facing * (0.12 + random.w * 0.35) * height;
    vec2 windA = texture2D(uNoiseTexture, root * 0.01 + uTime * 0.03).xy - 0.5;
    vec2 windB = texture2D(uNoiseTexture, root * 0.05 + uTime * 0.11).xy - 0.5;
    float gust = sin(uTime * 1.4 - dot(root, vec2(0.11, 0.07))) * 0.5 + 0.5;
    vec2 wind = (windA * 1.4 + windB * 0.5) * (0.55 + gust * 0.65);

    // Legs push blades aside, only while the feet are near the ground (a jump releases them)
    float push = (1.0 - smoothstep(0.35, 1.7, distanceToPlayer)) * (1.0 - smoothstep(0.15, 0.9, uPlayerLift));
    vec2 pushDirection = distanceToPlayer > 1e-3 ? fromPlayer / distanceToPlayer : vec2(0.0);

    // Trodden grass lies down the way it was walked through, then slowly stands back up
    vec4 trail = texture2D(uTrailTexture, (root - uTrailOrigin) / uTrailSize + 0.5);
    float trodden = trail.b;
    vec2 treadDirection = trail.rg / max(length(trail.rg), 1e-3);

    float curve = h * h;
    vec2 offset = (lean + wind * height * 0.55 * (1.0 - trodden * 0.7)
        + pushDirection * push * height * 1.2
        + treadDirection * trodden * height * 1.1) * curve;
    float bentAmount = min(length(offset) / max(height, 1e-3), 1.0);

    vec3 world = vec3(root.x, ground, root.y);
    world.xz += across * position.x * width * 0.5 + offset;
    world.y += h * height * (1.0 - 0.38 * bentAmount) * (1.0 - trodden * 0.45);

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

    // Normal: blade face, tilted up near the tip and rounded across the width
    vec3 faceNormal = vec3(facing.x, 0.35 + h * 0.4, facing.y);
    vNormal = normalize(faceNormal + vec3(across.x, 0.0, across.y) * position.x * 0.5);

    // Colour: the terrain's grass colour at this spot; per-blade variation averages to 1 so
    // the field reads as the same green as the ground beyond it
    vec3 base = getGrassColor(dry, ground);
    base *= 0.88 + random.w * 0.24;
    base *= mix(vec3(1.0), vec3(1.06, 1.0, 0.86), random.y * random.y);   // a few warmer blades
    vColorBase = base;
    vGroundNormal = groundNormal;
    vHeight = h;
    vWorldPosition = world;

    // Wildflowers: white, yellow, violet, pink
    float petal = floor(random.z * 4.0);
    vec3 petalColor = petal < 1.0 ? vec3(0.78, 0.78, 0.74) : petal < 2.0 ? vec3(0.82, 0.66, 0.16) : petal < 3.0 ? vec3(0.42, 0.30, 0.62) : vec3(0.76, 0.40, 0.54);
    vFlower = vec4(petalColor, flower);
    vSunVisibility = (1.0 - getCloudShadow(vec3(root.x, ground, root.y), normalize(uSunPosition))) * (1.0 - canopy);
    vColorBase *= 1.0 - canopy * 0.3;     // less sky light under the canopy
}
