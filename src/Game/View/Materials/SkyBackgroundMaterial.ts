import * as THREE from 'three'

import vertexShader from './shaders/skyBackground/vertex.glsl'
import fragmentShader from './shaders/skyBackground/fragment.glsl'

export default class SkyBackgroundMaterial extends THREE.ShaderMaterial {
    constructor() {
        super({
            uniforms:
            {
                uTexture: { value: null }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader
        })
    }
}
