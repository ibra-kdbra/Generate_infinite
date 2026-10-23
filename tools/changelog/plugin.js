// The changelog for the game's Changelog page, as a module the build makes: `virtual:changelog`.
// The releases come from CHANGELOG.md (written by hand, a release at a time); the changes since
// the last release from the commits made after the changelog was last edited, so the page is
// up to date with every commit without anyone writing it twice.
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const ID = 'virtual:changelog'
const RESOLVED = '\0' + ID

// a commit's kind (its subject's prefix: feat, fix, ...) → the section it's listed under
const KINDS = { feat: 'Added', fix: 'Fixed', perf: 'Performance', performance: 'Performance', security: 'Security', docs: 'Documentation', build: 'Maintenance', chore: 'Maintenance', refactor: 'Changed', style: 'Changed', test: 'Maintenance' }
const ORDER = ['Added', 'Changed', 'Fixed', 'Performance', 'Security', 'Removed', 'Documentation', 'Maintenance']

/** CHANGELOG.md: `## 2.7.0 — 2026-10-22`, a summary line, `### Section`, `- item` (continued by indented lines). */
export function parse(text) {
    const releases = []
    let release = null, section = null, item = null
    for (const line of text.split('\n')) {
        const heading = line.match(/^## +(\S+)(?: +[—–-] +(\d{4}-\d{2}-\d{2}))? *$/)
        if (heading) {
            release = { version: heading[1], date: heading[2] ?? null, summary: '', sections: [] }
            releases.push(release)
            section = item = null
            continue
        }
        if (!release)
            continue
        const sub = line.match(/^### +(.+?) *$/)
        if (sub) {
            section = { name: sub[1], items: [] }
            release.sections.push(section)
            item = null
        }
        else if (section && /^- /.test(line)) {
            item = line.slice(2).trim()
            section.items.push(item)
        }
        else if (section && item !== null && /^ {2,}\S/.test(line))
            section.items[section.items.length - 1] += ' ' + line.trim()
        else if (!section && line.trim())
            release.summary = (release.summary + ' ' + line.trim()).trim()
        else if (!line.trim())
            item = null
    }
    return releases
}

const git = (command, cwd) => { try { return execSync(`git ${command}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' } }

/** The commits since CHANGELOG.md last changed (none where git or the history isn't there: a shallow clone). */
export function unreleased(root, file) {
    const since = git(`log -1 --format=%H -- ${JSON.stringify(path.relative(root, file))}`, root)
    if (!since)
        return null
    // a shallow clone (a deploy) whose oldest commit stands in for the history before it: that
    // commit "added" every file, so it says nothing about when the changelog last changed
    if (git('rev-parse --is-shallow-repository', root) === 'true' && !git(`rev-list --max-count=1 --parents ${since}`, root).includes(' '))
        return null
    const log = git(`log --no-merges --format=%h%x09%ad%x09%s --date=short ${since}..HEAD`, root)
    const sections = new Map()
    let date = null
    for (const line of log.split('\n').filter(Boolean)) {
        const [hash, day, subject] = line.split('\t')
        date ??= day
        // a known kind is dropped from the text; any other "Word: ..." subject is kept whole
        const match = subject.match(/^(\w+)(?:\([^)]*\))?!?: *(.+)$/)
        const kind = match ? KINDS[match[1].toLowerCase()] : undefined
        const name = kind ?? 'Changed'
        const text = kind ? match[2] : subject
        if (!sections.has(name))
            sections.set(name, [])
        sections.get(name).push(`${text.charAt(0).toUpperCase()}${text.slice(1)} (${hash})`)
    }
    if (!sections.size)
        return null
    return { version: 'Unreleased', date, summary: '', sections: ORDER.filter((name) => sections.has(name)).map((name) => ({ name, items: sections.get(name) })) }
}

export default function changelog({ file = 'CHANGELOG.md' } = {}) {
    let root = process.cwd()
    return {
        name: 'changelog',
        configResolved(config) { root = config.root },
        resolveId(id) { return id === ID ? RESOLVED : null },
        load(id) {
            if (id !== RESOLVED)
                return null
            const source = path.resolve(root, file)
            this.addWatchFile(source)
            const releases = parse(fs.readFileSync(source, 'utf8'))
            const pending = unreleased(root, source)
            const { version } = JSON.parse(fs.readFileSync(path.resolve(root, 'package.json'), 'utf8'))
            return `export default ${JSON.stringify({ version, releases: pending ? [pending, ...releases] : releases })}`
        }
    }
}
