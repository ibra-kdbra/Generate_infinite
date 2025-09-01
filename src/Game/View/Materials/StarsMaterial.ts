import * as THREE from 'three'

import vertexShader from './shaders/stars/vertex.glsl'
import fragmentShader from './shaders/stars/fragment.glsl'

export default class StarsMaterial extends THREE.ShaderMaterial {
    constructor() {
        super({
            uniforms:
            {
                uSunPosition: { value: new THREE.Vector3() },
                uSize: { value: 0.01 },
                uBrightness: { value: 0.5 },
                uHeightFragments: { value: null }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader
        })
    }
}
