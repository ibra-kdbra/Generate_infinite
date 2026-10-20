// The world remembered: fell a tree, walk 150 m away (its log is cleared) and back (its stump
// stands, the tree isn't drawn standing again), save, reload the page; after the reload the
// player is back where he was and the stump is there.
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const pl = g.state.player, veg = g.state.vegetation, trees = g.view.trees
    g.view.renderer.update = () => {}
    const step = (n) => { for (let i = 0; i < n; i++) { w.tp(0, 1.4, 5, 0.06); w.step(1) } }
    const move = (x, z) => { const p = pl.position.current; p[0] = x; p[2] = z; p[1] = pl.groundAt(x, z) + 0.5; pl.position.previous.set(p); pl.velocity.fill(0) }
    const nearestTree = () => { let best = null, d = Infinity; const p = pl.position.current; for (const c of veg.cells.values()) for (const pt of c.plants) if ((pt.kind === 0 || pt.kind === 1) && !pt.felled) { const k = Math.hypot(pt.x - p[0], pt.z - p[2]); if (k < d) { d = k; best = pt } } return best }
    if (w.localStorage.getItem('probe-save-phase') !== '2') {
        step(60); await wait(3000); step(30)
        const tree = nearestTree()
        log('felling the tree at', tree.x.toFixed(1), tree.z.toFixed(1))
        move(tree.x + 3, tree.z); step(30)
        trees.fell(tree, 1, 0, 0.8); step(400)
        log('lying:', trees.felled.length, 'stump', tree.stump)
        move(tree.x + 150, tree.z); for (let i = 0; i < 8; i++) { step(20); await wait(400) }
        log('after walking away: felled lying', trees.felled.length)
        move(tree.x + 3, tree.z); for (let i = 0; i < 8; i++) { step(20); await wait(400) }
        const again = [...veg.cells.values()].flatMap((c) => c.plants).find((pt) => Math.abs(pt.x - tree.x) < 0.01 && Math.abs(pt.z - tree.z) < 0.01)
        log('back: the plant there is felled', again && again.felled, 'stump', again && again.stump, 'stump models near', trees.stumps.size)
        step(30); g.state.save.save()
        const saved = JSON.parse(w.localStorage.getItem(`generate-infinite:world:${g.seed}`))
        log('saved: player', saved.player.x.toFixed(1), saved.player.z.toFixed(1), 'stumps', saved.stumps.length, 'removed', saved.removed.length)
        w.localStorage.setItem('probe-save-phase', '2')
        w.localStorage.setItem('probe-save-tree', JSON.stringify([tree.x, tree.z, saved.player.x, saved.player.z]))
        w.location.reload()
        await wait(600000)
    }
    else {
        w.localStorage.removeItem('probe-save-phase')
        const [tx, tz, px, pz] = JSON.parse(w.localStorage.getItem('probe-save-tree'))
        const p = pl.position.current
        log('after the reload: player at', p[0].toFixed(1), p[2].toFixed(1), 'saved at', px.toFixed(1), pz.toFixed(1))
        step(60); await wait(3000); step(30)
        const there = [...veg.cells.values()].flatMap((c) => c.plants).find((pt) => Math.abs(pt.x - tx) < 0.01 && Math.abs(pt.z - tz) < 0.01)
        log('the tree there is felled', there && there.felled, 'stump', there && there.stump, 'stump models', trees.stumps.size)
    }
}
