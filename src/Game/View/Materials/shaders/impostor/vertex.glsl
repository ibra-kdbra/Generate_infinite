// Far trees: a camera-facing card showing the tree as it was rendered from the nearest of
// eight directions around it (TreeImpostors bakes them), lit with the baked normals.

uniform vec3 uSunPosition;
uniform float uRadius[VARIANTS];     // half width of each variant (tree height = 1)
uniform float uTime;
uniform sampler2D uNoiseTexture;
uniform vec3 uViewPosition;

attribute vec4 aInstance;            // x, y, z, scale
attribute vec2 aInstanceExtra;       // rotation, variant

varying vec2 vUv;
varying float vFrame;
varying float vVariant;
varying float vRotation;
varying float vDistance;
varying vec3 vWorldPosition;
varying vec3 vHaze;
varying float vHazeAmount;
varying float vSunVisibility;

#include ../partials/getSkyLut.glsl
#include ../partials/getAerialFog.glsl
#include ../partials/getClouds.glsl

void main()
{
    float scale = aInstance.w;
    float variant = aInstanceExtra.y;
    float rotation = aInstanceExtra.x;
    float radius = uRadius[int(variant + 0.5)];

    vec3 base = aInstance.xyz;
    vec2 toCamera = normalize(cameraPosition.xz - base.xz + 1e-4);
    vec3 right = vec3(toCamera.y, 0.0, - toCamera.x);
    vec3 world = base + right * position.x * radius * 1.05 * scale + vec3(0.0, mix(- 0.02, 1.03, position.y) * scale, 0.0);
    // the crown sways a little, like the near trees
    vec2 wind = texture2D(uNoiseTexture, base.xz * 0.004 + uTime * 0.02).xy - 0.5;
    world.xz += wind * position.y * position.y * 0.012 * scale;

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

    // the camera's direction in the tree's own (unrotated) frame picks the baked view
    float c = cos(rotation), s = sin(rotation);
    vec2 local = mat2(c, s, - s, c) * toCamera;
    float angle = atan(local.x, local.y);
    vFrame = fract(angle / 6.28318531) * 8.0;

    vUv = vec2(position.x * 0.5 + 0.5, position.y);
    vVariant = variant;
    vRotation = rotation;
    // (in the shadow pass the card faces the sun and shows the tree as seen from it)
    vDistance = distance(uViewPosition.xz, base.xz);
    vWorldPosition = world;
    #ifndef SHADOW
        vHazeAmount = getAerialHaze(world, vHaze);
        vSunVisibility = 1.0 - getCloudShadow(world, normalize(uSunPosition));
    #endif
}
