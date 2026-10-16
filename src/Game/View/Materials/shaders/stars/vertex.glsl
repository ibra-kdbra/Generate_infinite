// Stars: one point each, sized and brightened by magnitude, dimmed and twinkling more near
// the horizon (through more air), hidden below it
uniform float uTime;
uniform float uPixelRatio;

attribute float aMagnitude;
attribute vec3 aColor;
attribute float aPhase;

varying vec3 vColor;
varying float vFlux;

void main()
{
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    vec3 direction = normalize(world.xyz - modelMatrix[3].xyz);
    float airmass = 1.0 / max(direction.y + 0.05, 0.05);
    float twinkle = 1.0 + sin(uTime * (2.0 + aPhase * 6.0) + aPhase * 60.0) * min(0.45, 0.06 * airmass);
    float flux = pow(10.0, - 0.4 * aMagnitude) * twinkle * exp(- 0.1 * airmass);
    vFlux = flux;
    vColor = aColor;
    gl_PointSize = clamp((1.3 + sqrt(flux) * 3.2) * uPixelRatio, 1.0, 7.0 * uPixelRatio);
    if (direction.y < - 0.03)
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
