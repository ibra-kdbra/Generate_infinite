export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const css = await (await fetch('/src/style.css?direct')).text()
    const W = innerWidth, H = innerHeight
    const ui = async (name) => {
        w.step(1, 1 / 60)
        const frame = new Image(); frame.src = g.view.renderer.instance.domElement.toDataURL('image/png')
        await frame.decode()
        const html = new XMLSerializer().serializeToString(document.querySelector('.ui'))
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" class="game" style="position:relative;width:${W}px;height:${H}px"><style>${css}</style>${html}</div></foreignObject></svg>`
        const overlay = new Image(); overlay.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
        try { await overlay.decode() } catch (e) { log('overlay failed', String(e)) }
        const c = document.createElement('canvas'); c.width = W; c.height = H
        const x = c.getContext('2d'); x.drawImage(frame, 0, 0, W, H); x.drawImage(overlay, 0, 0)
        console.log('SHOT ' + name + ' ' + c.toDataURL('image/jpeg', 0.9))
    }
    w.tp(0.6, 1.3, 6, 0.08); w.step(30)
    const tabs = (new URLSearchParams(location.search).get('tabs') || 'game,graphics,sound,controls').split(',')
    for (const tab of tabs) {
        g.menu.show(tab); await wait(450); await ui('ui-' + tab)
        const body = document.querySelector('.drawer-body')
        if (body.scrollHeight > body.clientHeight + 40) { body.scrollTop = body.scrollHeight; await wait(100); await ui('ui-' + tab + '-end') }
        log(tab, 'scroll', body.scrollHeight, 'view', body.clientHeight)
    }
    g.view.player.settings.set('character', 'male_ranger'); await wait(2500); g.menu.show('game'); await wait(400); await ui('ui-game-ranger')
    // the gear button
    g.menu.hide(); await wait(400)
    document.querySelector('.hud-corner [data-open]:last-child').click(); await wait(450)
    log('gear opens tab', g.menu.currentTab, 'visible panels', [...document.querySelectorAll('[role=tabpanel]')].filter(p => !p.hidden).map(p => p.id).join())
    await ui('ui-gear')
}
