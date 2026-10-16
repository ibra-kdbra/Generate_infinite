/**
 * The menu's controls, built in code: titled groups, sliders with their value, switches,
 * choices (a segmented row) and button rows. Each control reads its value through `get` so
 * a page can refresh them all when it opens (values change from elsewhere too).
 */
export type SliderOptions = {
    label: string
    min: number
    max: number
    step: number
    get: () => number
    set: (value: number) => void
    format?: (value: number) => string
    onRelease?: boolean          // apply when let go (expensive changes, like the terrain's shape)
}

export default class Ui {
    private refreshers: (() => void)[] = []

    /** A titled group of controls; returns where to put them. */
    group(parent: HTMLElement, title: string, note?: string) {
        const section = document.createElement('section')
        section.className = 'ctl-group'
        section.innerHTML = `<h3>${title}</h3>`
        const body = document.createElement('div')
        body.className = 'ctl-body'
        section.appendChild(body)
        if (note) {
            const p = document.createElement('p')
            p.className = 'field-note'
            p.textContent = note
            section.appendChild(p)
        }
        parent.appendChild(section)
        return body
    }

    slider(parent: HTMLElement, options: SliderOptions) {
        const format = options.format ?? ((v: number) => String(Number(v.toFixed(4))))
        const row = document.createElement('label')
        row.className = 'ctl-slider'
        row.innerHTML = `<span class="ctl-label">${options.label}</span><output></output><input type="range" min="${options.min}" max="${options.max}" step="${options.step}">`
        const input = row.querySelector('input')!
        const output = row.querySelector('output')!
        const paint = () => {
            const value = Number(input.value)
            output.textContent = format(value)
            input.style.setProperty('--fill', `${((value - options.min) / (options.max - options.min)) * 100}%`)
        }
        input.addEventListener('input', () => {
            paint()
            if (!options.onRelease) options.set(Number(input.value))
        })
        if (options.onRelease)
            input.addEventListener('change', () => options.set(Number(input.value)))
        parent.appendChild(row)
        const refresh = () => { input.value = String(options.get()); paint() }
        this.refreshers.push(refresh)
        refresh()
        return row
    }

    toggle(parent: HTMLElement, label: string, get: () => boolean, set: (on: boolean) => void, hint?: string) {
        const row = document.createElement('label')
        row.className = 'ctl-switch'
        row.innerHTML = `<span class="ctl-text"><span class="ctl-label">${label}</span>${hint ? `<span class="ctl-hint">${hint}</span>` : ''}</span><input type="checkbox" role="switch"><span class="ctl-track" aria-hidden="true"></span>`
        const input = row.querySelector('input')!
        input.addEventListener('change', () => set(input.checked))
        parent.appendChild(row)
        const refresh = () => { input.checked = get() }
        this.refreshers.push(refresh)
        refresh()
        return row
    }

    choice<T extends string>(parent: HTMLElement, options: Record<T, string>, get: () => T, set: (value: T) => void, label?: string, wrap = false) {
        const box = document.createElement('div')
        box.className = 'ctl-choice'
        if (label)
            box.innerHTML = `<span class="ctl-label">${label}</span>`
        const row = document.createElement('div')
        row.className = wrap ? 'choice-wrap' : 'segmented'
        row.setAttribute('role', 'group')
        if (label) row.setAttribute('aria-label', label)
        for (const [value, text] of Object.entries(options) as [T, string][]) {
            const button = document.createElement('button')
            button.textContent = text
            button.dataset.value = value
            button.addEventListener('click', () => { set(value); refresh() })
            row.appendChild(button)
        }
        box.appendChild(row)
        parent.appendChild(box)
        const refresh = () => {
            for (const button of row.querySelectorAll<HTMLButtonElement>('button')) {
                const selected = button.dataset.value === get()
                button.classList.toggle('is-selected', selected)
                button.setAttribute('aria-pressed', String(selected))
            }
        }
        this.refreshers.push(refresh)
        refresh()
        return box
    }

    buttons(parent: HTMLElement, items: [string, () => void][]) {
        const row = document.createElement('div')
        row.className = 'ctl-buttons'
        for (const [label, action] of items) {
            const button = document.createElement('button')
            button.textContent = label
            button.addEventListener('click', action)
            row.appendChild(button)
        }
        parent.appendChild(row)
        return row
    }

    /** A list of label / value rows; returns a setter by key. */
    readouts(parent: HTMLElement, rows: [string, string][]) {
        const list = document.createElement('dl')
        list.className = 'readout'
        const outputs = new Map<string, HTMLElement>()
        for (const [key, label] of rows) {
            const row = document.createElement('div')
            row.innerHTML = `<dt>${label}</dt><dd></dd>`
            list.appendChild(row)
            outputs.set(key, row.querySelector('dd')!)
        }
        parent.appendChild(list)
        return (key: string, text: string) => {
            const output = outputs.get(key)
            if (output && output.textContent !== text) output.textContent = text
        }
    }

    refresh() {
        for (const refresh of this.refreshers)
            refresh()
    }
}
