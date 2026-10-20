// How the worn and held tools sit on the body: for each, the smallest gap between its surface
// and the skin (cm; negative: sunk into it) and the nearest bone, from the skinned mesh as
// posed this frame. Standing still, with nothing in hand, then with each tool in hand.
//   EXTRA='probe=/tools/probe/probe-contact.js&char=male_ranger' run-chromium.mjs 300
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const st = g.view.player.settings, t = g.view.tools, pl = g.state.player, vp = g.view.player, keys = g.state.controls.keys.down
    st.set('character', q.get('char') || 'male_ranger'); await wait(2500); w.step(20)
    const r = g.view.renderer
    r.update = () => {}
    const V = vp.model.position.constructor
    const hold = () => w.tp(0, 1.4, 5, 0.06)
    const step = (n) => { for (let i = 0; i < n; i++) { hold(); w.step(1) } }
    step(40)
    const skin = () => {
        // the posed skin: positions and normals in the world, hashed into 4 cm cells
        const points = [], normals = [], bones = [], grid = new Map()
        vp.model.updateMatrixWorld(true)
        vp.model.traverse((m) => {
            if (!m.isSkinnedMesh || !m.visible) return
            const position = m.geometry.attributes.position, normal = m.geometry.attributes.normal
            const skinIndex = m.geometry.attributes.skinIndex, skinWeight = m.geometry.attributes.skinWeight
            const v = new V(), n = new V()
            for (let i = 0; i < position.count; i++) {
                m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld)
                // the normal turned by the bone that moves this vertex most
                let best = 0, bone = 0
                for (let k = 0; k < 4; k++) if (skinWeight.getComponent(i, k) > best) { best = skinWeight.getComponent(i, k); bone = skinIndex.getComponent(i, k) }
                const b = m.skeleton.bones[bone]
                n.fromBufferAttribute(normal, i).transformDirection(new w.game.view.player.model.matrixWorld.constructor().multiplyMatrices(b.matrixWorld, m.skeleton.boneInverses[bone]))
                const id = points.length
                points.push(v.clone()); normals.push(n.clone()); bones.push(b.name)
                const key = `${Math.floor(v.x / 0.04)},${Math.floor(v.y / 0.04)},${Math.floor(v.z / 0.04)}`
                if (!grid.has(key)) grid.set(key, [])
                grid.get(key).push(id)
            }
        })
        return { points, normals, bones, grid }
    }
    const nearest = (body, p, reach = 6) => {
        const cx = Math.floor(p.x / 0.04), cy = Math.floor(p.y / 0.04), cz = Math.floor(p.z / 0.04)
        let best = Infinity, id = -1
        for (let x = - reach; x <= reach; x++) for (let y = - reach; y <= reach; y++) for (let z = - reach; z <= reach; z++) {
            for (const i of body.grid.get(`${cx + x},${cy + y},${cz + z}`) ?? []) { const d = body.points[i].distanceToSquared(p); if (d < best) { best = d; id = i } }
        }
        return id < 0 ? null : { id, d: Math.sqrt(best) }
    }
    const measure = (object, only = null) => {
        const body = skin()
        if (only) { const keep = new Set(body.bones.map((b, i) => only.test(b) ? i : -1).filter((i) => i >= 0)); body.grid = new Map([...body.grid].map(([k, ids]) => [k, ids.filter((i) => keep.has(i))]).filter(([, ids]) => ids.length)) }
        let gap = Infinity, deepest = 0, at = null, sunk = 0, count = 0
        object.updateMatrixWorld(true)
        object.traverse((m) => {
            if (!m.isMesh || !m.visible) return
            const position = m.geometry.attributes.position, v = new V()
            for (let i = 0; i < position.count; i += 1) {
                v.fromBufferAttribute(position, i).applyMatrix4(m.matrixWorld)
                const hit = nearest(body, v)
                if (!hit) continue
                count++
                const side = v.clone().sub(body.points[hit.id]).dot(body.normals[hit.id])
                // inside only where the skin is near (its normal says nothing far away)
                const inside = side < 0 && hit.d < 0.04
                const signed = inside ? - hit.d : hit.d
                if (signed < gap) { gap = signed; at = body.bones[hit.id] }
                if (inside && hit.d > 0.005) { sunk++; deepest = Math.max(deepest, hit.d) }
            }
        })
        return gap === Infinity ? 'far from the body' : `gap ${(gap * 100).toFixed(1)} cm at ${at}, ${sunk}/${count} points inside (deepest ${(deepest * 100).toFixed(1)} cm)`
    }
    const worn = () => {
        for (const tool of t.set) if (!t.inHand.has(tool)) log('worn', tool, measure(t.models.get(tool)), '| its cover:', t.covers.get(tool)?.visible ? measure(t.covers.get(tool)) : 'none')
        t.gear[st.get('character').includes('peasant') ? 'peasant' : 'ranger'].forEach((item, i) => log('gear', i, measure(item)))
    }
    worn()
    if (q.has('worn')) return
    t.set.forEach((tool, slot) => {
        t.select(slot); let n = 0; while ((t.transition || !t.inHand.has(tool)) && n++ < 400) step(1)
        step(30)
        // the held tool against the hand that holds it: the gap at the grip
        const hand = vp.bone(tool === 'bow' ? 'hand_l' : 'hand_r')
        const side = tool === 'bow' ? 'l' : 'r'
        log('held', tool, 'against the hand:', measure(t.models.get(tool), new RegExp(`^(hand|thumb|index|middle|ring|pinky)\\w*_${side}$`)), '| the body:', measure(t.models.get(tool)))
        t.select(slot); n = 0; while ((t.transition || t.inHand.size) && n++ < 400) step(1)
        step(20)
    })
}
