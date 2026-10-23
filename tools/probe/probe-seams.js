// Seams between drawn terrain pieces: along every shared edge, the height on one side against
// the other. Pieces hang a skirt below their edges (Workers/Terrain.ts); a step taller than the
// skirt is a crack you can see through.
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const st = g.state, pl = st.player
    const q = new URLSearchParams(location.search)
    // the numbers need no pictures: the drawing stopped, the world's state stepped alone (ultra
    // in a software renderer would take hours)
    g.update = () => {}
    const step = (n) => { for (let i = 0; i < n; i++) { st.time.update(); st.update() } }
    const measure = () => {
        const list = [...st.terrains.terrains.values()].filter((t) => t.ready && t.visible)
        const steps = []
        for (const a of list) for (const b of list) {
            if (a === b || a.size > b.size) continue
            // b's east/west/north/south edges against a
            const edges = [
                [a.x + a.halfSize, 'x', b.x - b.halfSize], [a.x - a.halfSize, 'x', b.x + b.halfSize],
                [a.z + a.halfSize, 'z', b.z - b.halfSize], [a.z - a.halfSize, 'z', b.z + b.halfSize]]
            for (const [edgeA, axis, edgeB] of edges) {
                if (Math.abs(edgeA - edgeB) > 0.01) continue
                const [lo, hi] = axis === 'x' ? [Math.max(a.z - a.halfSize, b.z - b.halfSize), Math.min(a.z + a.halfSize, b.z + b.halfSize)] : [Math.max(a.x - a.halfSize, b.x - b.halfSize), Math.min(a.x + a.halfSize, b.x + b.halfSize)]
                if (hi - lo < 1) continue
                const inA = Math.sign((axis === 'x' ? a.x : a.z) - edgeA) * 0.01
                for (let s = lo + 0.5; s < hi; s += 2) {
                    const ha = axis === 'x' ? a.getElevationForPosition(edgeA + inA, s) : a.getElevationForPosition(s, edgeA + inA)
                    const hb = axis === 'x' ? b.getElevationForPosition(edgeA - inA, s) : b.getElevationForPosition(s, edgeA - inA)
                    if (typeof ha === 'number' && typeof hb === 'number') steps.push({ d: Math.abs(ha - hb), sizes: `${a.size}|${b.size}`, at: axis === 'x' ? [edgeA, s] : [s, edgeA], dist: Math.hypot((axis === 'x' ? edgeA : s) - pl.position.current[0], (axis === 'x' ? s : edgeA) - pl.position.current[2]) })
                }
            }
        }
        steps.sort((x, y) => y.d - x.d)
        const skirt = st.terrains.skirtDepth()
        const over = steps.filter((s) => s.d > skirt)
        const bySizes = {}
        for (const s of over) bySizes[s.sizes] = (bySizes[s.sizes] ?? 0) + 1
        return { skirt, samples: steps.length, cracks: over.length, overPerSizes: bySizes, worst: steps.slice(0, 4).map((s) => `${s.d.toFixed(1)} m ${s.sizes} at ${Math.round(s.dist)} m`) }
    }
    for (let i = 0; i < 40; i++) { step(2); await wait(50) }
    log('here', JSON.stringify(measure()))
    // a few places: mountains are where it matters
    const start = [...pl.position.current]
    for (let k = 1; k <= Number(q.get('places') || 4); k++) {
        pl.position.current[0] = start[0] + k * 1700
        pl.position.current[2] = start[2] - k * 900
        pl.position.previous.set(pl.position.current)
        for (let i = 0; i < 60; i++) { await wait(60); step(1) }
        log(`place ${k}`, JSON.stringify(measure()))
    }
}
