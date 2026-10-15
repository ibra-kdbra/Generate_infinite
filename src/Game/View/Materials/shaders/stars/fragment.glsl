// Stars: soft points, only at night and only where the clouds let the sky through
uniform vec3 uSunPosition;
uniform sampler2D uClouds;
uniform vec2 uResolution;

varying vec3 vColor;

#include ../partials/toLinear.glsl

void main()
{
    float night = smoothstep(0.02, - 0.14, normalize(uSunPosition).y);
    float clear = texture2D(uClouds, gl_FragCoord.xy / uResolution).a;
    float point = 1.0 - smoothstep(0.15, 0.5, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(toLinear(vColor) * 0.22 * night * clear * point, 1.0);
}
