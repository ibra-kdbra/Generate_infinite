// Normal map without stored tangents: a cotangent frame from screen-space derivatives of
// the position and texture coordinates. Where the coordinates don't change across the
// pixel (degenerate UVs, tiny triangles) the frame is undefined: keep the surface normal.
// (Unguarded, that's inversesqrt(0) times zero: a NaN, which NVIDIA keeps and the bloom
// then spread over the whole frame.)
vec3 perturb(vec3 normal, vec3 position, vec2 uv, vec3 mapped)
{
    vec3 dp1 = dFdx(position), dp2 = dFdy(position);
    vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
    vec3 dp2perp = cross(dp2, normal), dp1perp = cross(normal, dp1);
    vec3 t = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 b = dp2perp * duv1.y + dp1perp * duv2.y;
    float scale = max(dot(t, t), dot(b, b));
    if (scale < 1e-24)
        return normal;
    vec3 n = mat3(t, b, normal * sqrt(scale)) * mapped;
    float length2 = dot(n, n);
    return length2 > 1e-24 ? n * inversesqrt(length2) : normal;
}
