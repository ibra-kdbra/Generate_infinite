// Temporal accumulation of the clouds: each frame's ray-march (jittered, noisy) blends into
// the history, reprojected by direction (the sky is at infinity, so only the camera's turn
// matters). The history is first clamped to the range of this frame's neighbourhood, so
// moving clouds and turning views don't leave ghost trails.
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform mat4 uInverseViewProjection;
uniform mat4 uPreviousViewProjection;
uniform float uHistoryValid;
uniform vec2 uTexel;

varying vec2 vUv;

void main()
{
    vec4 current = texture2D(uCurrent, vUv);
    vec4 mean = vec4(0.0), square = vec4(0.0);
    for (int y = - 1; y <= 1; y++)
    for (int x = - 1; x <= 1; x++) {
        vec4 s = texture2D(uCurrent, vUv + vec2(x, y) * uTexel);
        mean += s;
        square += s * s;
    }
    mean /= 9.0;
    vec4 deviation = sqrt(max(square / 9.0 - mean * mean, 0.0));

    vec4 farPoint = uInverseViewProjection * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 direction = normalize(farPoint.xyz / farPoint.w);
    vec4 previous = uPreviousViewProjection * vec4(direction, 1.0);
    vec2 previousUv = previous.xy / previous.w * 0.5 + 0.5;
    bool valid = uHistoryValid > 0.5 && previous.w > 0.0 && all(greaterThanEqual(previousUv, vec2(0.0))) && all(lessThanEqual(previousUv, vec2(1.0)));
    if (!valid) {
        gl_FragColor = current;
        return;
    }
    vec4 history = clamp(texture2D(uHistory, previousUv), mean - deviation * 1.5, mean + deviation * 1.5);
    gl_FragColor = mix(history, current, 0.1);
}
