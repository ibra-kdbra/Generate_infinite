type Release = { version: string, date: string | null, summary: string, sections: { name: string, items: string[] }[] }

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/**
 * The Changelog page (Settings → About): every release, newest first, from CHANGELOG.md, with
 * the changes since the last release from the commits (tools/changelog/plugin.js). A page of
 * its own over the game, opened from the menu and closed back to it (Back or Esc). Its text
 * is loaded the first time it's opened, not with the game.
 */
export default class Changelog {
    element: HTMLElement
    private list: HTMLElement
    private loaded = false
    private returnTo: HTMLElement | null = null

    constructor(parent: Element) {
        this.element = document.createElement('div')
        this.element.className = 'changelog'
        this.element.hidden = true
        this.element.setAttribute('role', 'dialog')
        this.element.setAttribute('aria-modal', 'true')
        this.element.setAttribute('aria-labelledby', 'changelog-title')
        this.element.innerHTML = `
            <div class="changelog-bar">
                <button class="changelog-back" data-back><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Back</button>
                <span class="changelog-build">Build ${__BUILD__}</span>
            </div>
            <div class="changelog-scroll">
                <article class="changelog-page">
                    <header class="changelog-head">
                        <p class="drawer-eyebrow">Generate Infinite</p>
                        <h1 id="changelog-title">Changelog</h1>
                        <p class="changelog-intro">Every release, newest first.</p>
                    </header>
                    <div data-releases><p class="changelog-intro">Loading…</p></div>
                </article>
            </div>`
        this.list = this.element.querySelector('[data-releases]')!
        this.element.querySelector('[data-back]')!.addEventListener('click', () => this.close())
        parent.appendChild(this.element)
    }

    get isOpen() {
        return !this.element.hidden
    }

    open() {
        this.returnTo = document.activeElement as HTMLElement | null
        this.element.hidden = false
        this.element.querySelector<HTMLElement>('[data-back]')!.focus({ preventScroll: true })
        if (!this.loaded) {
            this.loaded = true
            import('virtual:changelog')
                .then(({ default: changelog }) => this.render(changelog.version, changelog.releases))
                .catch(() => { this.list.innerHTML = '<p class="changelog-intro">The changelog couldn\'t be loaded.</p>' })
        }
    }

    close() {
        if (!this.isOpen)
            return
        this.element.hidden = true
        this.returnTo?.focus?.({ preventScroll: true })
    }

    private render(version: string, releases: Release[]) {
        this.element.querySelector('.changelog-build')!.textContent = `Version ${version} · build ${__BUILD__}`
        this.list.innerHTML = releases.map((release) => {
            const pending = release.version === 'Unreleased'
            const date = release.date ? `<time datetime="${release.date}">${DATE.format(new Date(release.date))}</time>` : ''
            return `
                <section class="release${pending ? ' is-pending' : ''}" aria-labelledby="release-${slug(release.version)}">
                    <div class="release-meta">
                        <h2 id="release-${slug(release.version)}">${escape(release.version)}</h2>
                        ${date}
                    </div>
                    <div class="release-body">
                        ${release.summary ? `<p class="release-summary">${inline(release.summary)}</p>` : ''}
                        ${pending ? '<p class="release-summary is-quiet">Changes since the last release, from the commits.</p>' : ''}
                        ${release.sections.map((section) => `
                            <h3>${escape(section.name)}</h3>
                            <ul>${section.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`).join('')}
                    </div>
                </section>`
        }).join('')
    }
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-')

function escape(text: string) {
    return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!))
}

/** An item's text: `code` set as code, a trailing commit hash set apart. */
function inline(text: string) {
    return escape(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/ \(([0-9a-f]{7,})\)$/, ' <span class="release-hash">$1</span>')
}
