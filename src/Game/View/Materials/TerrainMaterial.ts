import * as THREE from 'three'

import vertexShader from './shaders/terrain/vertex.glsl'
import fragmentShader from './shaders/terrain/fragment.glsl'

export default class TerrainMaterial extends THREE.ShaderMaterial {
    constructor() {
        super({
            uniforms:
            {
                uPlayerPosition: { value: null },
                uSunPosition: { value: null },
                uNoiseTexture: { value: null },
                uGrassDistance: { value: null },
                uWaterLevel: { value: 0 },
                uGrassDryness: { value: 0 },
                uSkyLut: { value: null },
                uReliefTexture: { value: null },
                uTreeShade: { value: null },
                uWetMap: { value: null },
                uWetOrigin: { value: new THREE.Vector2(1e9, 1e9) },
                uWetSize: { value: 64 },
                uGroundAlbedo: { value: null },
                uGroundNormal: { value: null },
                uGroundMeans: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0.5, 0.5, 0.5)) },
                uGroundReady: { value: 0 },
                uGroundDetail: { value: new THREE.Vector3(70, 210, 1) },
                uTreeShadeOrigin: { value: new THREE.Vector2(1e9, 1e9) },
                uTreeShadeSize: { value: 384 },
                uTexture: { value: null },
                uTextureSize: { value: null }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            side: THREE.DoubleSide
        })
    }
}
