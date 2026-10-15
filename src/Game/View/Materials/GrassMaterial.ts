import * as THREE from 'three'

import vertexShader from './shaders/grass/vertex.glsl'
import fragmentShader from './shaders/grass/fragment.glsl'

export default class GrassMaterial extends THREE.ShaderMaterial {
    constructor() {
        super({
            uniforms:
            {
                uTime: { value: null },
                uPlayerPosition: { value: null },
                uPlayerLift: { value: 0 },             // player height above the ground
                uTerrainSize: { value: null },
                uTerrainTextureSize: { value: null },
                uTerrainATexture: { value: null },
                uTerrainAOffset: { value: null },
                uTerrainBTexture: { value: null },
                uTerrainBOffset: { value: null },
                uTerrainCTexture: { value: null },
                uTerrainCOffset: { value: null },
                uTerrainDTexture: { value: null },
                uTerrainDOffset: { value: null },
                uNoiseTexture: { value: null },
                uSunPosition: { value: null },
                uPatchOrigin: { value: null },         // per patch (set before each draw)
                uPatchSeed: { value: 0 },
                uPatchSize: { value: 8 },
                uLodWidth: { value: 1 },
                uRadius: { value: 32 },
                uBladeWidth: { value: 0.13 },
                uHeightRange: { value: null },
                uGrassDryness: { value: 0 },
                uFlowers: { value: 0 },
                uTrailTexture: { value: null },
                uTrailOrigin: { value: null },
                uTrailSize: { value: 64 },
                uTreeShade: { value: null },
                uTreeShadeOrigin: { value: new THREE.Vector2(1e9, 1e9) },
                uTreeShadeSize: { value: 384 }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader
        })
    }
}
