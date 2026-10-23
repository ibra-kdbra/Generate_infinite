// Shaders compiled after the loading screen: each one is a hitch the first time it's needed
// (on a real graphics card tens to hundreds of milliseconds). A tour of the game (looking
// around, every tool of both characters, night, rain and a storm, under water, the free
// camera) logs every program linked, by what it is (its shader's first comment line) and when.
export default async function ({ w, log, wait }) {
    const g = w.game
    const gl = g.view.renderer.instance.getContext()
    const sources = new WeakMap(), attached = new WeakMap()
    let phase = 'loading'
    const linked = []
    const shaderSource = gl.shaderSource.bind(gl), attachShader = gl.attachShader.bind(gl), linkProgram = gl.linkProgram.bind(gl)
    gl.shaderSource = (shader, source) => { sources.set(shader, source); shaderSource(shader, source) }
    gl.attachShader = (program, shader) => { (attached.get(program) ?? attached.set(program, []).get(program)).push(shader); attachShader(program, shader) }
    gl.linkProgram = (program) => {
        const [vertex, fragment] = (attached.get(program) ?? []).map((shader) => sources.get(shader) ?? '')
        const own = (source) => { const lines = (source ?? '').split('\n'); const start = Math.max(0, lines.findIndex((l) => l.startsWith('#define SHADER_NAME'))); return lines.slice(start).find((l) => /^\s*\/\/\s*\S/.test(l))?.trim().replace(/^\/\/\s*/, '').slice(0, 72) }
        const name = (vertex.match(/#define SHADER_NAME (.+)/) ?? [])[1]
        // a built-in material has no comment of ours: its features say what it is
        const features = () => [...new Set((vertex + fragment).match(/#define (USE_[A-Z_]+|[A-Z_]*SKINNING|INSTANCED|DEPTH_PACKING|DISTANCE|FLAT_SHADED|DOUBLE_SIDED)\b/g) ?? [])].map((d) => d.slice(8)).join(' ') || 'no features'
        const label = own(fragment) ?? own(vertex) ?? (name && name !== 'ShaderMaterial' ? name : `built-in (${features()})`)
        const entry = { phase, label: label + (/#define SHADOW\b/.test(fragment) ? ' [shadow pass]' : '') + (/#define DEPTH_PACKING|depth/i.test(name ?? '') ? ' [depth]' : '') }
        linked.push(entry)
        if (phase !== 'loading')
            log(`compiled  ${entry.phase.padEnd(28)} ${entry.label}`)
        linkProgram(program)
    }
    const t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 150000) await wait(200)
    const atLoad = linked.length
    log('loading', g.loading.done ? 'done' : 'NOT done', `· ${atLoad} programs by then`)
    // which materials change after that (a material recompiles when its version moves)
    const versions = new Map()
    const owner = new Map()
    const scan = () => g.view.scene.traverse((object) => { for (const material of [object.material].flat().filter(Boolean)) { if (!versions.has(material)) { versions.set(material, material.version); owner.set(material, object.name || object.type) } } })
    scan()
    const changed = () => {
        const out = []
        for (const [material, version] of versions) if (material.version !== version) { out.push(`${owner.get(material)}/${material.name || material.type} v${version}->${material.version}`); versions.set(material, material.version) }
        return out
    }
    const frames = async (n) => { for (let i = 0; i < n; i++) { w.step(1); if (i % 4 === 3) await wait(20) } }
    const st = g.state, settings = g.view.player.settings, t = g.view.tools, pl = st.player
    const step = async (name, action, n = 30) => {
        phase = name; log(`step ${name}`); await action(); await frames(n)
        const moved = changed(); if (moved.length) log(`  materials changed: ${moved.slice(0, 8).join(', ')}${moved.length > 8 ? ` (+${moved.length - 8})` : ''}`)
        scan()
    }

    await step('the real loop, 8 s', () => wait(8000), 0)
    await step('settle', () => {}, 30)
    await step('looking around', async () => { for (let a = 0; a < 6.3; a += 0.5) { w.tp(a, 1.2, 7, 0.08); await frames(3) } })
    for (const set of (new URLSearchParams(location.search).get('sets') || 'male_ranger').split(',')) {
        if (settings.get('character') !== set)
            await step(`${set}: changing`, async () => { settings.set('character', set); await wait(2500) }, 30)
        for (let slot = Number(new URLSearchParams(location.search).get('from') || 0); slot < 3; slot++) {
            await step(`${set}: tool ${slot + 1} out`, () => t.select(slot), 60)
            await step(`${set}: ${t.equipped} used`, async () => { t.useStart(); await frames(t.equipped === 'bow' ? 60 : 5); t.useEnd() }, 40)
            await step(`${set}: ${t.equipped} away`, () => t.select(slot), 40)
        }
    }
    if (new URLSearchParams(location.search).has('toolsonly')) { log(`after loading: ${linked.length - atLoad} programs`); return }
    await step('night', () => w.tp(1, 1.2, 7, 0.5), 60)
    await step('night with the torch', () => t.select(2), 90)
    await step('day again', () => { t.select(2); w.tp(1, 1.2, 7, 0.08) }, 60)
    await step('rain', () => { settings.set('weather', 'rain'); g.view.weather.rain = 1; g.view.weather.wetness = 1 }, 60)
    await step('storm', () => { settings.set('weather', 'storm'); g.view.weather.storm = 1 }, 80)
    await step('clear', () => { settings.set('weather', 'clear'); g.view.weather.rain = 0; g.view.weather.storm = 0 }, 30)
    await step('under water', () => { const p = pl.position.current; w.shot(p[0], -3, p[2], 0, 0, 0.08) }, 40)
    await step('free camera, far', () => { const p = pl.position.current; w.shot(p[0], 500, p[2], -0.3, 1, 0.08) }, 40)

    log(`after loading: ${linked.length - atLoad} programs`)
}
