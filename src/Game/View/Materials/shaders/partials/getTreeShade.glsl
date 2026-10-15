// Shadows of trees, bushes and boulders on the ground (View/TreeShade.ts): 0 sunlit .. ~0.75
// under a crown.

uniform sampler2D uTreeShade;
uniform vec2 uTreeShadeOrigin;
uniform float uTreeShadeSize;

float getTreeShade(vec2 position)
{
    vec2 uv = (position - uTreeShadeOrigin) / uTreeShadeSize + 0.5;
    vec2 edge = abs(uv - 0.5);
    if (max(edge.x, edge.y) > 0.5)
        return 0.0;
    return texture2D(uTreeShade, uv).r * (1.0 - smoothstep(0.42, 0.5, max(edge.x, edge.y)));
}
