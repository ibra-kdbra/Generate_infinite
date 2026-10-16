import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type ToolName = 'sword' | 'bow' | 'torch' | 'axe' | 'hoe' | 'sickle'

/**
 * The hand tools, modelled in code: every model has its grip at the origin and its working
 * end along +Y (the blade, the axe head, the flame); edges face +Z. Wood, leather and steel
 * share a few materials; the steel reflects a soft sky so it reads as metal.
 */
export function createToolMaterials() {
    // a tiny gradient environment (sky above, ground below) for the steel to reflect
    const size = 64
    const data = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
            const t = y / (size - 1)
            const sky = [170, 195, 225], ground = [70, 66, 52]
            const c = t > 0.5 ? sky : ground
            const k = Math.abs(t - 0.5) * 2
            const i = (y * size + x) * 4
            for (let ch = 0; ch < 3; ch++)
                data[i + ch] = Math.round(c[ch] * (0.55 + 0.45 * k))
            data[i + 3] = 255
        }
    const environment = new THREE.DataTexture(data, size, size)
    environment.mapping = THREE.EquirectangularReflectionMapping
    environment.colorSpace = THREE.SRGBColorSpace
    environment.needsUpdate = true

    return {
        wood: new THREE.MeshStandardMaterial({ color: '#7a5636', roughness: 0.78 }),
        darkWood: new THREE.MeshStandardMaterial({ color: '#4e3522', roughness: 0.8 }),
        leather: new THREE.MeshStandardMaterial({ color: '#3a2618', roughness: 0.9 }),
        cloth: new THREE.MeshStandardMaterial({ color: '#2b2118', roughness: 1 }),
        steel: new THREE.MeshStandardMaterial({ color: '#c3c7cc', roughness: 0.3, metalness: 0.85, envMap: environment, envMapIntensity: 0.9 }),
        darkSteel: new THREE.MeshStandardMaterial({ color: '#6d7176', roughness: 0.45, metalness: 0.8, envMap: environment, envMapIntensity: 0.7 }),
        string: new THREE.LineBasicMaterial({ color: '#d9d2c0' }),
        fletching: new THREE.MeshStandardMaterial({ color: '#b8492f', roughness: 0.9, side: THREE.DoubleSide }),
        environment
    }
}
export type ToolMaterials = ReturnType<typeof createToolMaterials>

function cylinder(radiusTop: number, radiusBottom: number, length: number, from: number, material: THREE.Material, segments = 10) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, length, segments), material)
    mesh.position.y = from + length / 2
    return mesh
}

/** A flat blade from a 2D outline (x across, y along), `thickness` thick, centred in z. */
function blade(points: [number, number][], thickness: number, material: THREE.Material) {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.4, bevelSize: 0.004, bevelSegments: 1 })
    geometry.translate(0, 0, - thickness / 2)
    return new THREE.Mesh(geometry, material)
}

export function createTool(name: ToolName, m: ToolMaterials): THREE.Group {
    const group = new THREE.Group()
    group.name = name
    switch (name) {
        case 'sword': {
            group.add(cylinder(0.017, 0.019, 0.17, - 0.085, m.leather))
            const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.027, 12, 8), m.darkSteel)
            pommel.position.y = - 0.1
            group.add(pommel)
            const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.024, 0.034), m.darkSteel)
            guard.position.y = 0.097
            group.add(guard)
            const edge = blade([[- 0.024, 0], [0.024, 0], [0.02, 0.68], [0, 0.78], [- 0.02, 0.68]], 0.006, m.steel)
            edge.rotation.y = Math.PI / 2          // edges toward +-Z
            edge.position.y = 0.108
            group.add(edge)
            break
        }
        case 'bow': {
            // limbs bow back toward the archer (-Z); the string joins the tips
            const points: THREE.Vector3[] = []
            for (let i = 0; i <= 16; i++) {
                const t = i / 16 * 2 - 1
                points.push(new THREE.Vector3(0, t * 0.72, - 0.13 * t * t + 0.02 * (1 - t * t)))
            }
            const limbs = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.013, 6), m.darkWood)
            group.add(limbs)
            group.add(cylinder(0.02, 0.02, 0.13, - 0.065, m.leather))
            const string = new THREE.Line(new THREE.BufferGeometry().setFromPoints([points[0], new THREE.Vector3(0, 0, - 0.13), points[16]]), m.string)
            string.name = 'string'
            group.add(string)
            break
        }
        case 'torch': {
            group.add(cylinder(0.02, 0.026, 0.56, - 0.16, m.wood))
            group.add(cylinder(0.036, 0.031, 0.11, 0.38, m.cloth))
            break
        }
        case 'axe': {
            group.add(cylinder(0.017, 0.022, 0.74, - 0.28, m.wood))
            const head = blade([[- 0.03, 0.04], [0.045, 0.05], [0.15, 0.12], [0.165, 0.035], [0.15, - 0.07], [0.045, - 0.03], [- 0.03, - 0.025]], 0.022, m.steel)
            head.rotation.y = Math.PI / 2          // the edge toward +Z
            head.position.y = 0.42
            group.add(head)
            break
        }
        case 'hoe': {
            group.add(cylinder(0.017, 0.019, 1.36, - 0.36, m.wood))
            const plate = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.13, 0.008), m.darkSteel)
            plate.position.set(0, 0.95, 0.075)
            plate.rotation.x = - 0.25
            group.add(plate)
            const socket = cylinder(0.024, 0.024, 0.07, 0.97, m.darkSteel)
            group.add(socket)
            break
        }
        case 'sickle': {
            group.add(cylinder(0.02, 0.023, 0.15, - 0.075, m.wood))
            // a crescent: the outer arc minus an offset inner arc
            const shape = new THREE.Shape()
            shape.absarc(0, 0.17, 0.17, - Math.PI * 0.5, Math.PI * 0.75, false)
            shape.absarc(- 0.02, 0.16, 0.135, Math.PI * 0.72, - Math.PI * 0.47, true)
            const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false, curveSegments: 24 })
            geometry.translate(0, 0, - 0.002)
            const crescent = new THREE.Mesh(geometry, m.steel)
            crescent.rotation.y = Math.PI / 2
            crescent.position.y = 0.075
            group.add(crescent)
            break
        }
    }
    group.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh)
            mesh.castShadow = false
    })
    return group
}

/**
 * A climbing axe (an ice axe's shape): a short handle with a grip, a curved pick reaching
 * forward (+Z) and drooping to a point, a small adze behind. Grip at the origin, head up +Y.
 */
export function createClimbingAxe(m: ToolMaterials): THREE.Group {
    const group = new THREE.Group()
    group.name = 'climbing-axe'
    group.add(cylinder(0.014, 0.016, 0.5, - 0.08, m.darkWood))
    group.add(cylinder(0.019, 0.019, 0.12, - 0.06, m.leather))
    // the pick: a curved blade forward and down, its edge on the underside
    const shape = new THREE.Shape()
    shape.moveTo(0, - 0.012)
    shape.quadraticCurveTo(0.12, - 0.01, 0.2, - 0.075)
    shape.lineTo(0.205, - 0.06)
    shape.quadraticCurveTo(0.12, 0.012, 0, 0.022)
    shape.lineTo(- 0.05, 0.02)
    shape.lineTo(- 0.07, - 0.01)       // the adze behind
    shape.lineTo(- 0.05, - 0.012)
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false, curveSegments: 12 })
    geometry.translate(0, 0, - 0.004)
    const head = new THREE.Mesh(geometry, m.darkSteel)
    head.rotation.y = - Math.PI / 2        // the shape's x along +Z
    head.position.y = 0.42
    group.add(head)
    group.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh) mesh.castShadow = false })
    return group
}

/** One arrow as a single geometry (shaft, steel head, three vanes), pointing +Y, centred. */
export function createArrowGeometry() {
    const parts: THREE.BufferGeometry[] = []
    const color = (geometry: THREE.BufferGeometry, hex: string) => {
        const c = new THREE.Color(hex)
        const colors = new Float32Array(geometry.getAttribute('position').count * 3)
        for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i)
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        return geometry.index ? geometry.toNonIndexed() : geometry
    }
    const shaft = new THREE.CylinderGeometry(0.0045, 0.0045, 0.72, 6)
    parts.push(color(shaft, '#a07a4c'))
    const head = new THREE.ConeGeometry(0.011, 0.05, 6)
    head.translate(0, 0.385, 0)
    parts.push(color(head, '#8f9398'))
    for (let i = 0; i < 3; i++) {
        const vane = new THREE.PlaneGeometry(0.018, 0.075)
        vane.translate(0.011, - 0.31, 0)
        vane.rotateY(i * Math.PI * 2 / 3)
        parts.push(color(vane, '#b8492f'))
    }
    return mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g }))!
}
