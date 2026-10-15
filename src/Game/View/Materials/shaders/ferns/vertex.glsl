// Ferns on the forest floor (View/Ferns.ts), instanced: placed, turned and scaled per
// instance; the fronds sway with the wind, more toward their tips.

uniform float uTime;
uniform sampler2D uNoiseTexture;

attribute vec4 aInstance;        // x, y, z, scale
attribute vec2 aInstanceExtra;   // rotation, tint

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vHeight;           // 0 at the root .. 1 at the top of the plant
varying float vTint;

void main()
{
    float scale = aInstance.w;
    float c = cos(aInstanceExtra.x), s = sin(aInstanceExtra.x);
    mat2 turn = mat2(c, - s, s, c);
    vec3 p = position * scale;
    p.xz = turn * p.xz;
    vec3 n = normal;
    n.xz = turn * n.xz;
    vec3 world = p + aInstance.xyz;

    float height = clamp(position.y / 0.45, 0.0, 1.0);
    vec2 wind = texture2D(uNoiseTexture, aInstance.xz * 0.01 + uTime * 0.03).xy - 0.5;
    float flutter = sin(uTime * 2.6 + dot(world.xz, vec2(1.7, 2.3))) * 0.3;
    world.xz += (wind * 1.4 + flutter) * height * height * 0.12 * scale;

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    vUv = uv;
    vNormal = n;
    vWorldPosition = world;
    vHeight = height;
    vTint = aInstanceExtra.y;
}
