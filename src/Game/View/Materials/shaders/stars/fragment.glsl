// Stars: soft round points, only at night and only where the clouds let the sky through
uniform vec3 uSunPosition;
uniform sampler2D uClouds;
uniform vec2 uResolution;
uniform float uBrightness;

varying vec3 vColor;
varying float vFlux;

void main()
{
    float night = smoothstep(0.02, - 0.14, normalize(uSunPosition).y);
    float clear = texture2D(uClouds, gl_FragCoord.xy / uResolution).a;
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float point = exp(- d * d * 4.0);
    gl_FragColor = vec4(vColor * vFlux * 7.0 * uBrightness * night * clear * point, 1.0);
}
