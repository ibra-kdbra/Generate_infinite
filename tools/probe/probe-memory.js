// Resources over a long walk: the player is carried 60 m at a time across ~10 km; every 1.5 km
// the script heap, the GPU's geometries, textures and shader programs, the chunks and terrains
// kept. Anything that keeps growing is a leak.
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const st = g.state, pl = st.player, info = g.view.renderer.instance.info
    const q = new URLSearchParams(location.search)
    const sample = (label) => {
        const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : '-'
        log(label, `heap ${heap} MB · geometries ${info.memory.geometries} · textures ${info.memory.textures} · programs ${info.programs?.length} · chunks ${st.chunks.allChunks.size} · terrains ${st.terrains.terrains.size} · scene objects ${g.view.scene.children.length}`)
    }
    for (let i = 0; i < 40; i++) { w.step(2); await wait(50) }
    sample('start')
    const start = [...pl.position.current]
    const legs = Number(q.get('legs') || 170)
    for (let k = 1; k <= legs; k++) {
        pl.position.current[0] = start[0] + k * 60
        pl.position.current[2] = start[2] + Math.sin(k * 0.05) * 400
        pl.position.current[1] = (st.chunks.getElevationForPosition(pl.position.current[0], pl.position.current[2]) || 0) + 2
        pl.position.previous.set(pl.position.current)
        await wait(Number(q.get('gap') || 40)); w.step(1)
        if (k % 25 === 0) { if (w.gc) w.gc(); sample(`${(k * 0.06).toFixed(1)} km`) }
    }
}
