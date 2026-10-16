// Rebuilds the full cloud picture from this frame's march (one pixel of each 2 x 2 block,
// a different one each frame) and the previous frames, reprojected by direction (the sky is
// at infinity, so only the camera's turn matters). The pixel marched this frame takes its
// fresh value strongly; the other three keep their history, nudged toward the upsampled
// march. History is first clamped to the range of this frame's neighbourhood, so moving
// clouds and turning views don't leave ghost trails.
uniform sampler2D uCurrent;          // half resolution
uniform sampler2D uHistory;
uniform mat4 uInverseViewProjection;
uniform mat4 uPreviousViewProjection;
uniform float uHistoryValid;
uniform vec2 uTexel;                 // of the march
uniform vec2 uMarchOffset;

varying vec2 vUv;

void main()
{
    vec2 pixel = floor(gl_FragCoord.xy);
    bool fresh = all(equal(mod(pixel, 2.0), uMarchOffset));
    vec2 marchUv = (floor(pixel / 2.0) + 0.5) * uTexel;
    vec4 current = fresh ? texture2D(uCurrent, marchUv) : texture2D(uCurrent, vUv);

    vec4 mean = vec4(0.0), square = vec4(0.0);
    for (int y = - 1; y <= 1; y++)
    for (int x = - 1; x <= 1; x++) {
        vec4 s = texture2D(uCurrent, marchUv + vec2(x, y) * uTexel);
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
    vec4 history = clamp(texture2D(uHistory, previousUv), mean - deviation * 2.0 - 0.002, mean + deviation * 2.0 + 0.002);
    gl_FragColor = mix(history, current, fresh ? 0.35 : 0.06);
}
