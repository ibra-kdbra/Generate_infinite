// Aerial perspective: distant ground fades into the colour of the horizon sky in its
// direction (the atmosphere: bluish by day, warm toward a low sun). The air's haze is thin
// (about a tenth over a kilometre) and thinner higher up; near where the terrain ends
// (uHazeRange, the chunk rings around the player) it thickens so the edge never shows.
// Needs getSkyLut.

uniform float uHazeRange;

// How much haze lies between the camera and this point (0..1), and its colour
float getAerialHaze(vec3 worldPosition, out vec3 haze)
{
    vec3 toPoint = worldPosition - cameraPosition;
    float dist = length(toPoint);
    vec3 direction = toPoint / max(dist, 1e-4);

    float edge = smoothstep(uHazeRange * 0.5, uHazeRange * 0.97, length(toPoint.xz));
    // the air's own colour: the sky low over the horizon; toward the edge, exactly the sky
    // behind the point (skyBackground), so the end of the terrain is never seen against it
    float up = max(direction.y, 0.0);
    haze = getSkyLut(vec3(direction.x, mix(up * 0.25 + 0.012, up, edge), direction.z));

    float meanHeight = max(0.0, (worldPosition.y + cameraPosition.y) * 0.5);
    float air = 1.0 - exp(- 0.00012 * exp(- meanHeight / 1400.0) * dist);
    return 1.0 - (1.0 - air) * (1.0 - edge);
}

vec3 getAerialFog(vec3 color, vec3 worldPosition)
{
    vec3 haze;
    float amount = getAerialHaze(worldPosition, haze);
    return mix(color, haze, amount);
}
