// Where a worn tool's origin and ends are, in a bone's frame (body axes: x left, y up, z forward).
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const st = g.view.player.settings, t = g.view.tools, vp = g.view.player
    st.set('character', q.get('char') || 'male_peasant'); await wait(2500)
    g.view.renderer.update = () => {}
    for (let i = 0; i < 30; i++) { w.tp(0, 1.4, 5, 0.06); w.step(1) }
    const tool = q.get('tool') || 'hoe', bone = q.get('bone') || 'spine_03'
    const f = vp.boneFrame(bone), inv = f.quaternion.clone().invert()
    const V = vp.model.position.constructor
    const local = (p) => p.clone().sub(f.position).applyQuaternion(inv).toArray().map((v) => v.toFixed(3)).join(',')
    const m = t.models.get(tool); m.updateMatrixWorld(true)
    log(tool, 'origin', local(m.getWorldPosition(new V())), 'y-0.3', local(new V(0, -0.3, 0).applyMatrix4(m.matrixWorld)), 'y+0.9', local(new V(0, 0.9, 0).applyMatrix4(m.matrixWorld)))
    for (const b of ['spine_03', 'spine_02', 'pelvis', 'neck_01', 'Head', 'clavicle_l', 'clavicle_r']) log(b, local(vp.bone(b).getWorldPosition(new V())))
    // skin points behind the chest: the farthest back skin vertex near the spine
    let back = 0
    vp.model.traverse((mesh) => { if (!mesh.isSkinnedMesh || !mesh.visible) return; const p = new V(); for (let i = 0; i < mesh.geometry.attributes.position.count; i += 3) { mesh.getVertexPosition(i, p); p.applyMatrix4(mesh.matrixWorld); const l = p.clone().sub(f.position).applyQuaternion(inv); if (Math.abs(l.x) < 0.06 && Math.abs(l.y) < 0.08) back = Math.min(back, l.z) } })
    log('the back of the body at the bone, z', back.toFixed(3))
}
