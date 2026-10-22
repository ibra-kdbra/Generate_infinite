// The far terrain: drawn pieces that overlap (two levels of detail at once) or leave holes, as the
// player travels; then pictures of mountains and lakes from high above.
let holeLogs = 0
export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const st = g.state, pl = st.player
    const q = new URLSearchParams(location.search)
    const drawn = () => [...st.terrains.terrains.values()].filter((t) => t.renderInstance?.mesh?.parent && t.renderInstance.mesh.visible)
    const check = () => {
        const list = drawn()
        let overlaps = 0, area = 0; const pairs = []
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j]
            const ox = Math.min(a.x + a.halfSize, b.x + b.halfSize) - Math.max(a.x - a.halfSize, b.x - b.halfSize)
            const oz = Math.min(a.z + a.halfSize, b.z + b.halfSize) - Math.max(a.z - a.halfSize, b.z - b.halfSize)
            if (ox > 0.5 && oz > 0.5) { overlaps++; area += ox * oz; if (pairs.length < 6) pairs.push(`${a.size}@${a.x},${a.z}#${a.id} & ${b.size}@${b.x},${b.z}#${b.id}`) }
        }
        // holes: sample a grid around the player for a drawn piece
        let holes = 0
        const reach = st.chunks.reach - 600
        for (let x = - reach; x <= reach; x += 200) for (let z = - reach; z <= reach; z += 200) {
            const px = pl.position.current[0] + x, pz = pl.position.current[2] + z
            if (!list.some((t) => Math.abs(px - t.x) < t.halfSize && Math.abs(pz - t.z) < t.halfSize)) {
                holes++
                if (holeLogs++ < 4) {
                    const path = []
                    let c = st.chunks.getChildChunkForPosition(px, pz)
                    while (c) {
                        path.push(`d${c.depth} s${c.size} f${+c.final} sp${+c.splitted} spl${+c.splitting} un${+c.unsplitting} r${+c.ready} t${c.terrain ? (c.terrain.ready ? 'R' : 'w') + (c.terrain.visible ? 'V' : 'h') : '-'} n${c.neighbours.size} x${+c.destroyed}`)
                        c = c.splitted || c.unsplitting ? [...c.children.values()].find((k) => k.isInside(px, pz)) : null
                    }
                    log('hole', Math.round(x), Math.round(z), path.join(' > '))
                }
            }
        }
        if (pairs.length) log('overlap', pairs.join(' | '))
        return { pieces: list.length, overlaps, area, holes }
    }
    // settle
    for (let i = 0; i < 60; i++) { w.step(2); await wait(50) }
    log('start', JSON.stringify(check()))
    // travel: 60 m a step, in waves (the workers answer between steps)
    let worst = { overlaps: 0, holes: 0 }, frames = 0, badFrames = 0, holeFrames = 0
    const start = [...pl.position.current]
    const legs = Number(q.get('legs') || 80)
    for (let k = 0; k < legs; k++) {
        const a = k * 0.07
        pl.position.current[0] = start[0] + Math.cos(a) * k * 60
        pl.position.current[2] = start[2] + Math.sin(a) * k * 60
        pl.position.current[1] = 400
        pl.position.previous.set(pl.position.current)
        for (let f = 0; f < 6; f++) {
            await wait(Number(q.get('gap') || 30)); w.step(1)
            const c = check(); frames++
            if (c.overlaps) badFrames++
            if (c.holes) holeFrames++
            if (c.overlaps > worst.overlaps) worst = { ...c, k }
            if (c.holes > worst.holes) worst.holes = c.holes
        }
    }
    for (let i = 0; i < 80; i++) { w.step(1); await wait(50) }
    log('chunks kept', st.chunks.allChunks.size, 'terrains', st.terrains.terrains.size, 'meshes in scene', g.view.scene.children.filter((m) => m.material?.uniforms?.uTexture && m.geometry?.attributes?.aForest).length)
    log('after travel', JSON.stringify(check()), `| frames ${frames}, with overlaps ${badFrames}, with holes ${holeFrames}, worst`, JSON.stringify(worst))
    if (q.has('noshots')) return
    const p = pl.position.current
    for (const [i, [h, rx, ry]] of [[600, -0.35, 0], [900, -0.5, 2], [400, -0.2, 4], [1500, -0.7, 1]].entries()) {
        w.shot(p[0], (st.chunks.getElevationForPosition(p[0], p[2]) || 0) + h, p[2], rx, ry, 0.2)
        for (let f = 0; f < 4; f++) { w.step(1); await wait(100) }
        shot(`far-${i}`)
    }
}
