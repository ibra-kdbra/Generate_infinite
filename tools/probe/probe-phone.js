export default async function ({ log, wait }) {
    const W = 390, H = 844
    const frame = document.createElement('iframe')
    frame.src = '/'; frame.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;border:0;transform:scale(0.75);transform-origin:0 0;z-index:9`
    document.body.appendChild(frame)
    await new Promise((r) => frame.addEventListener('load', r))
    const fw = frame.contentWindow
    const t0 = performance.now(); while (!(fw.game && fw.game.loading && fw.game.loading.done) && performance.now() - t0 < 90000) await wait(300)
    log('inner', fw.innerWidth, fw.innerHeight)
    const css = await (await fetch('/src/style.css?direct')).text()
    const g = fw.game
    const ui = async (name) => {
        fw.step(1, 1 / 60)
        const img = new Image(); img.src = g.view.renderer.instance.domElement.toDataURL('image/png'); await img.decode()
        const html = new XMLSerializer().serializeToString(fw.document.querySelector('.ui'))
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" class="game" style="position:relative;width:${W}px;height:${H}px"><style>${css.replace(/@media \(max-width: 640px\)/, '@media all')}</style>${html}</div></foreignObject></svg>`
        const overlay = new Image(); overlay.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
        try { await overlay.decode() } catch (e) { log('overlay failed', String(e)) }
        const c = document.createElement('canvas'); c.width = W; c.height = H
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H); x.drawImage(overlay, 0, 0)
        console.log('SHOT ' + name + ' ' + c.toDataURL('image/jpeg', 0.9))
    }
    fw.tp(0.6, 1.3, 6, 0.08); fw.step(20)
    await ui('phone-hud')
    for (const tab of ['game', 'graphics', 'sound', 'controls']) {
        g.menu.show(tab); await wait(450)
        const body = fw.document.querySelector('.drawer-body')
        log(tab, 'scroll', body.scrollHeight, 'view', body.clientHeight, 'overflowX', fw.document.documentElement.scrollWidth > W)
        await ui('phone-' + tab)
    }
}
