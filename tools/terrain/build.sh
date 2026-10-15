#!/bin/sh
# Builds the terrain's ground textures from Poly Haven's CC0 2K downloads (diff, nor_gl,
# rough, ao JPEGs of each material in one directory) into public/textures/terrain/:
#   <name>_albedo.webp   colour; alpha = ambient occlusion, stored as 0.5 + 0.5 × AO (a canvas
#                        premultiplies alpha: dark AO would wipe the colour beneath it)
#   <name>_normal.webp   OpenGL normal map xy; blue = roughness
#
#   sh tools/terrain/build.sh <directory with the JPEGs>
#
# Needs ImageMagick (`magick`).
set -e
source="$1"
[ -d "$source" ] || { echo "usage: sh tools/terrain/build.sh <directory with the Poly Haven JPEGs>"; exit 1; }
out="$(dirname "$0")/../../public/textures/terrain"
mkdir -p "$out"
for name in rocky_terrain_02 forrest_ground_01 cliff_side coast_sand_01 snow_02 leafy_grass; do
    magick "$source/${name}_diff.jpg" \
        \( "$source/${name}_ao.jpg" -colorspace gray -evaluate multiply 0.5 -evaluate add 50% \) \
        -alpha off -compose CopyOpacity -composite -define webp:alpha-quality=50 -quality 80 "$out/${name}_albedo.webp"
    magick "$source/${name}_nor_gl.jpg" \( "$source/${name}_rough.jpg" -colorspace gray \) \
        -compose CopyBlue -composite -quality 82 "$out/${name}_normal.webp"
    echo "$name"
done
