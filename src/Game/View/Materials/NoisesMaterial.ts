import * as THREE from 'three'

import vertexShader from './shaders/noises/vertex.glsl'
import fragmentShader from './shaders/noises/fragment.glsl'

export default class NoisesMaterial extends THREE.ShaderMaterial {
    constructor() {
        super({
            uniforms:
            {
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader
        })
    }
}
