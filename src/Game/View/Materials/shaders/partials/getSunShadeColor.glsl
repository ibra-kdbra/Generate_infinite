vec3 getSunShadeColor(vec3 baseColor, float sunShade)
{
    // Warmer and lighter shadow to match stylized grass look
    vec3 shadeColor = baseColor * vec3(0.6, 0.7, 0.6);
    return mix(baseColor, shadeColor, sunShade);
}
