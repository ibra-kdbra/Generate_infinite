// Tools against the body while moving: each worn and held tool's clearance to the body's capsules
// (bones joined as limbs), through its strokes and on the run.
export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const st = g.view.player.settings, t = g.view.tools, pl = g.state.player, keys = g.state.controls.keys.down, vp = g.view.player
    const q = new URLSearchParams(location.search), set = q.get('set') || 'ranger'
    st.set('character', set === 'peasant' ? 'male_peasant' : 'male_ranger'); await wait(2500); w.step(20)
    const V = vp.model.position.constructor
    // flat ground near the start
    const p0 = [...pl.position.current]
    let flat = null
    for (let r = 0; r < 200 && !flat; r += 3) for (let a = 0; a < 6.28; a += 0.3) {
        const x = p0[0] + Math.cos(a) * r, z = p0[2] + Math.sin(a) * r, n = new Float32Array(3)
        pl.sampleGroundNormal(x, z, n, 1.5)
        if (n[1] > 0.985 && pl.groundAt(x, z) > 1 && !g.state.vegetation.nearest(x, z, 3, [0, 1, 2, 3, 4, 5])) { flat = [x, z]; break }
    }
    const place = (x, z, rot) => { w.tp(rot, 1.3, 4, 0.06); const p = pl.position.current; p[0] = x; p[2] = z; p[1] = pl.groundAt(x, z); pl.position.previous.set(p); pl.velocity.fill(0); pl.rotation = rot }
    place(flat[0], flat[1], 0); w.step(30)
    // body capsules from the bones (world)
    const bone = (n) => vp.model.getObjectByName(n)
    const P = (n) => bone(n).getWorldPosition(new V())
    const segDist = (p, a, b) => { const ab = b.clone().sub(a), t2 = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(a.clone().addScaledVector(ab, t2)) }
    const toolBounds = new Map()
    const bounds = (tool) => {
        if (toolBounds.has(tool)) return toolBounds.get(tool)
        const m = t.models.get(tool); m.updateMatrixWorld(true)
        const inv = m.matrixWorld.clone().invert(); let lo = 1e9, hi = - 1e9
        m.traverse((o) => { if (o.isMesh) { const pos = o.geometry.attributes.position; for (let i = 0; i < pos.count; i += 3) { const v = new V().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y) } } })
        toolBounds.set(tool, [lo, hi]); return [lo, hi]
    }
    const clip = (tool) => {
        const m = t.models.get(tool); if (!m.visible) return null
        m.updateMatrixWorld(true)
        const [lo, hi] = bounds(tool)
        const hands = ['hand_l', 'hand_r'].map(P)
        const caps = [
            ['torso', P('pelvis'), P('spine_03'), 0.15], ['chest', P('spine_03'), P('neck_01'), 0.14], ['head', P('Head'), P('Head').add(new V(0, 0.12, 0)), 0.11],
            ['thigh_l', P('thigh_l'), P('calf_l'), 0.085], ['thigh_r', P('thigh_r'), P('calf_r'), 0.085], ['shin_l', P('calf_l'), P('foot_l'), 0.06], ['shin_r', P('calf_r'), P('foot_r'), 0.06],
            ['uarm_l', P('upperarm_l'), P('lowerarm_l'), 0.055], ['uarm_r', P('upperarm_r'), P('lowerarm_r'), 0.055]]
        let worst = null; let margin = 9
        for (let y = lo; y <= hi; y += 0.03) {
            const pt = new V(0, y, 0).applyMatrix4(m.matrixWorld)
            if (t.inHand.has(tool) && hands.some((h) => h.distanceTo(pt) < 0.13)) continue
            for (const [name, a, b, r] of caps) {
                const d = r - segDist(pt, a, b)
                margin = Math.min(margin, - d)
                if (d > 0.015 && (!worst || d > worst.d)) worst = { d, name, y }
            }
        }
        clip.margin = Math.min(clip.margin, margin)
        return worst
    }
    clip.margin = 9
    const report = (label, frames) => {
        label += ` [closest ${(clip.margin * 100).toFixed(0)}cm]`; clip.margin = 9
        const bad = frames.filter((f) => f.c)
        log(label, bad.length ? `CLIPS ${bad.length}/${frames.length}: ` + bad.slice(0, 6).map((f) => `${f.time.toFixed(2)}s ${f.c.name} ${(f.c.d * 100).toFixed(0)}cm @y${f.c.y.toFixed(2)}`).join(', ') : `clean (${frames.length})`)
    }
    if (q.has('holster')) {
        for (const tool of t.set) {
            for (const [label, boost, crouch] of [['walk', false, false], ['run', true, false], ['crouch', false, true]]) {
                place(flat[0], flat[1], 0); w.step(10)
                keys.forward = true; keys.boost = boost; keys.crouch = crouch; w.step(20); const f = []
                for (let i = 0; i < 90; i++) { w.step(1); f.push({ time: i / 60, c: clip(tool) }) }
                keys.forward = false; keys.boost = false; keys.crouch = false; w.step(20)
                report(`holstered ${tool} ${label}`, f)
            }
        }
        return
    }
    const names = set === 'peasant' ? { axe: ['chop'], hoe: ['dig'], sickle: ['reap'] } : { sword: Object.keys(t.constructor.SWINGS_DEBUG || {}) }
    for (let slot = 0; slot < 3; slot++) {
        t.select(slot); w.step(140)
        const tool = t.equipped
        if (q.get('tool') && q.get('tool') !== tool) { t.select(slot); w.step(120); continue }
        // carrying, still and walking / running
        const frames = []
        for (let i = 0; i < 20; i++) { w.step(1); frames.push({ time: i / 60, c: clip(tool) }) }
        report(`${tool} carry still`, frames)
        for (const boost of [false, true]) {
            keys.forward = true; keys.boost = boost; w.step(20); const f2 = []
            for (let i = 0; i < 90; i++) { w.step(1); f2.push({ time: i / 60, c: clip(tool) }) }
            keys.forward = false; keys.boost = false; w.step(30); place(flat[0], flat[1], 0); w.step(10)
            report(`${tool} carry ${boost ? 'run' : 'walk'}`, f2)
        }
        if (tool === 'bow') {
            if (tool === 'bow') { t.useStart(); const f3 = []; for (let i = 0; i < 60; i++) { w.step(1); f3.push({ time: i / 60, c: clip(tool) }) } t.useEnd(); w.step(30); report('bow draw', f3) }
            t.select(slot); w.step(120); continue
        }
        if (q.has('func')) { t.select(slot); w.step(120); continue }
        const only = (q.get('moves') || '').split(',').filter(Boolean)
        let moves = { sword: ['forehand', 'backhand', 'level', 'thrust', 'rising', 'reverse', 'lowCut', 'risingLeft', 'doubleCut', 'thrustHigh', 'pommel', 'overhead', 'running', 'sweep', 'retreat', 'sideLeft', 'sideRight', 'spin', 'leap', 'uppercut'], axe: ['chop', 'diagonal', 'backhand', 'low', 'overhead', 'quick', 'wide', 'roots', 'mighty'], hoe: ['dig', 'pull', 'chop', 'side', 'scrape', 'pry', 'break'], sickle: ['reap', 'back', 'low', 'hook', 'flick', 'gather', 'whirl'], torch: ['jab', 'wave'] }[tool]
        if (only.length) moves = moves.filter((m) => only.includes(m))
        for (const name of moves) {
            place(flat[0], flat[1], 0); w.step(5)
            t.startSwing(tool, name)
            const f4 = []
            let prevTip = null, maxV = 0, at = 0
            for (let i = 0; i < 90 && t.swing; i++) {
                w.step(1); const m = t.models.get(tool); m.updateMatrixWorld(true)
                const tip = new V(0, bounds(tool)[1], 0).applyMatrix4(m.matrixWorld).sub(vp.group.getWorldPosition(new V()))
                if (prevTip) { const v = tip.distanceTo(prevTip) * 60; if (v > maxV) { maxV = v; at = t.swing ? t.swing.time : 0 } }
                prevTip = tip
                f4.push({ time: t.swing ? t.swing.time : 0, c: clip(tool) })
            }
            report(`${tool} ${name} tip max ${maxV.toFixed(1)} m/s @${at.toFixed(2)}`, f4); w.step(30)
        }
        t.select(slot); w.step(120)
    }
    if (set === 'peasant') {
        // functional: fell a tree, dig, reap
        let tree = null, bd = 1e9; for (const cell of g.state.vegetation.cells.values()) for (const pp of cell.plants) if ((pp.kind === 0 || pp.kind === 1) && pp.scale < 12) { const d = Math.hypot(pp.x - flat[0], pp.z - flat[1]); if (d < bd) { bd = d; tree = pp } }
        log('tree', tree && tree.kind, tree && tree.scale.toFixed(1))
        let calls = { till: 0, cut: 0, fell: 0, strike: 0 }
        const spy = (o, k, c) => { const f = o[k].bind(o); o[k] = (...a) => { calls[c]++; return f(...a) } }
        spy(g.view.groundWetness, 'till', 'till'); spy(g.view.grass.trail, 'cut', 'cut'); spy(g.view.trees, 'fell', 'fell'); spy(g.view.trees, 'strike', 'strike')
        for (const d of [0.7, 0.95, 1.2]) {
            const a = 0.4 + d, x = tree.x + Math.cos(a) * d, z = tree.z + Math.sin(a) * d
            t.select(0); w.step(140); calls.strike = 0
            for (let k = 0; k < 3; k++) { place(x, z, Math.atan2(x - tree.x, z - tree.z)); w.step(2); t.useStart(); t.useEnd(); let hmin = 9; for (let i = 0; i < 70; i++) { w.step(1) } }
            log('axe at', d, 'm: strikes', calls.strike, 'of 3, felled', calls.fell)
            t.select(0); w.step(120)
        }
        { const d = 0.9, a = 2, x = tree.x + Math.cos(a) * d, z = tree.z + Math.sin(a) * d; t.select(0); w.step(140)
          let presses = 0, strikes0 = calls.strike
          for (let k = 0; k < 30 && !calls.fell; k++) { place(x, z, Math.atan2(x - tree.x, z - tree.z)); w.step(2); t.useStart(); t.useEnd(); presses++; w.step(80) }
          log('needed', Math.round(Math.min(20, Math.max(5, 5 + (0.3793 - 0.25) / 0.31 * 15))), 'felled', calls.fell, 'after presses', presses, 'strikes', calls.strike - strikes0, 'notch', t.notches.size); t.select(0); w.step(120) }
        place(flat[0], flat[1], 0); w.step(10)
        t.select(1); w.step(140); for (let k = 0; k < 4; k++) { t.useStart(); t.useEnd(); w.step(80) } t.useStart(); t.useEnd()
        for (let i = 0; i < 60 && t.swing; i++) {
            w.step(1); if (!t.swing) break
            const m = t.models.get('hoe'); m.updateMatrixWorld(true)
            const pts = [[0, 0.95, 0.12], [0, 1.0, 0.08]].map(v => new V(...v).applyMatrix4(m.matrixWorld))
            if (t.swing.time > 0.3 && t.swing.time < 0.62) log('hoe t', t.swing.time.toFixed(2), 'recoil', t.swing.recoil, pts.map(p => `h${(p.y - pl.groundAt(p.x, p.z)).toFixed(3)} fwd${Math.hypot(p.x - pl.position.current[0], p.z - pl.position.current[2]).toFixed(2)}`).join(' '))
        }
        t.select(1); w.step(120)
        place(flat[0], flat[1], 0); w.step(10)
        t.select(1); w.step(140); for (let k = 0; k < 4; k++) { t.useStart(); t.useEnd(); w.step(80) } t.useStart(); t.useEnd(); w.step(70); log('hoe: till calls', calls.till); t.select(1); w.step(120)
        t.select(2); w.step(140); const c0 = calls.cut; t.useStart(); t.useEnd(); w.step(60); log('sickle: grass cut calls', calls.cut - c0)
    }
}
