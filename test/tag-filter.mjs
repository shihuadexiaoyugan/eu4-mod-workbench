/**
 * Tag-linking regression test.
 *
 * Proves the three behaviours the UI relies on:
 *  1. an empty tag keeps the full graph (no filtering, no crash),
 *  2. a selected tag keeps only events whose namespace or trigger names it,
 *  3. province owner/core filters read start-date history, not later changes.
 *
 * Read-only: it never writes a game or mod file. Set EU4_ROOT to point at a
 * non-default install; the test skips when no install is found.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Workbench } from '../lib/engine.js'

const eu4Root = process.env.EU4_ROOT ?? 'D:/SteamLibrary/steamapps/common/Europa Universalis IV'
if (!fs.existsSync(path.join(eu4Root, 'history'))) {
  console.log('skipped: EU4 install not found at ' + eu4Root)
  process.exit(0)
}

const statePath = path.join(os.tmpdir(), 'eu4-workbench-tag-test-' + process.pid + '.json')
const wb = new Workbench({ eu4Root, eu4UserDir: '', statePath }).init()
const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  if (!ok) throw new Error('failed: ' + name + (detail ? ' (' + detail + ')' : ''))
}

// 1. Empty tag: everything stays visible.
wb.setActiveTag('')
const unfiltered = await wb.queryEvents({})
check('empty tag keeps all events', unfiltered.filtered === false && unfiltered.nodes.length === unfiltered.total, `${unfiltered.nodes.length}/${unfiltered.total}`)
check('empty tag has no activeTag', unfiltered.activeTag === null)

// 2. Selected tag: namespace OR trigger match.
wb.setActiveTag('BOH')
const filtered = await wb.queryEvents({ category: 'special', activeTagOnly: true })
check('BOH special events found', filtered.nodes.length > 0, String(filtered.nodes.length))
check('every kept event matches BOH', filtered.nodes.every((n) => n.tagMatch && (n.tagMatch.namespace || n.tagMatch.trigger)))
check('every kept event is special', filtered.nodes.every((n) => n.special === true))
check('edges stay inside the kept set', filtered.edges.every((e) => filtered.nodes.some((n) => n.id === e.from) && filtered.nodes.some((n) => n.id === e.to)))

// 3. Province owner / core filters use the 1444 start state.
const owned = wb.mapQuery({ tag: 'BOH', ownerTag: 'BOH' })
check('BOH owns provinces at start', owned.total > 0, String(owned.total))
check('owner filter is exact', owned.provinces.every((p) => String(p.owner).toUpperCase() === 'BOH'))
const cores = wb.mapQuery({ tag: 'BOH', coresOnly: true })
check('BOH core provinces found', cores.total > 0, String(cores.total))
check('core filter is exact', cores.provinces.every((p) => p.isCore === true))

// 4. Invalid tags are rejected, never written.
const bad = wb.setActiveTag('TOOLONG')
check('invalid tag rejected', bad.ok === false)

const missions = await wb.findMissionsForTag('BOH')
check('mission file resolved', typeof missions.path === 'string' && missions.path.length > 0, String(missions.path))

// 6. Reverse-localisation: parse a real modifier definition's stats.
const modifier = await wb.modifierForm('thriving_arms_industry')
check('modifier stats parsed', Array.isArray(modifier.stats) && modifier.stats.length > 0, JSON.stringify(modifier.stats))

// 5. Cleanup the temporary state file.
try { fs.rmSync(statePath, { force: true }) } catch { /* ignore */ }

console.log(checks.map((c) => `ok  ${c.name}${c.detail ? ' — ' + c.detail : ''}`).join('\n'))
